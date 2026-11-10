/**
 * Minimal PayPal REST client. Credentials are per organization AND per
 * environment, encrypted at rest in organizations/{orgId}/private/paypal_{env}
 * (a path Firestore rules deny to every client).
 */
import { HttpsError } from "firebase-functions/v2/https";
import type { PayPalEnvironment } from "../../../shared/types";
import { orgCol } from "../lib/admin";
import { decrypt } from "../lib/crypto";
import { PAYPAL_LIVE_ENABLED } from "../lib/params";

export const PAYPAL_BASE: Record<PayPalEnvironment, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

export interface StoredCredentials {
  clientId: string;
  secretEnc: string;
  webhookId?: string;
  environment: PayPalEnvironment;
}

export function assertEnvironmentAllowed(env: PayPalEnvironment) {
  if (env === "live" && !PAYPAL_LIVE_ENABLED.value()) {
    throw new HttpsError("failed-precondition", "PayPal Live is turned off on this server. An administrator can enable it by setting PAYPAL_LIVE_ENABLED=true.");
  }
}

export const privateRef = (orgId: string, env: PayPalEnvironment) => orgCol(orgId, "private").doc(`paypal_${env}`);
export const connectionRef = (orgId: string, env: PayPalEnvironment) => orgCol(orgId, "paypalConnections").doc(env);

export async function loadCredentials(orgId: string, env: PayPalEnvironment): Promise<StoredCredentials> {
  const s = await privateRef(orgId, env).get();
  if (!s.exists) throw new HttpsError("failed-precondition", `PayPal ${env} is not connected for this organization.`);
  return s.data() as StoredCredentials;
}

/** Which environment an organization is actively connected to (live preferred when enabled). */
export async function activeEnvironment(orgId: string): Promise<PayPalEnvironment | null> {
  const [live, sandbox] = await Promise.all([connectionRef(orgId, "live").get(), connectionRef(orgId, "sandbox").get()]);
  if (live.exists && live.data()!.status === "connected" && PAYPAL_LIVE_ENABLED.value()) return "live";
  if (sandbox.exists && sandbox.data()!.status === "connected") return "sandbox";
  return null;
}

const tokenCache = new Map<string, { token: string; exp: number }>();

export async function fetchToken(env: PayPalEnvironment, clientId: string, secret: string): Promise<{ access_token: string; expires_in: number; app_id?: string; scope?: string }> {
  const res = await fetch(`${PAYPAL_BASE[env]}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw new HttpsError("invalid-argument", `PayPal rejected these ${env} credentials.`);
  if (!res.ok) throw new HttpsError("unavailable", `PayPal authentication failed (${res.status}).`);
  return (await res.json()) as { access_token: string; expires_in: number; scope?: string };
}

async function token(orgId: string, env: PayPalEnvironment): Promise<string> {
  const key = `${orgId}:${env}`;
  const c = tokenCache.get(key);
  if (c && c.exp > Date.now() + 60_000) return c.token;
  const cred = await loadCredentials(orgId, env);
  const t = await fetchToken(env, cred.clientId, await decrypt(cred.secretEnc));
  tokenCache.set(key, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

export class PayPalApiError extends Error {
  constructor(public status: number, public body: any) {
    super(`PayPal API ${status}: ${body?.name ?? ""} ${body?.message ?? ""}`.trim());
  }
  get issue(): string | undefined {
    return this.body?.details?.[0]?.issue ?? this.body?.name;
  }
}

/** Authenticated request with retry on 429/5xx and idempotency for POSTs. */
export async function paypal<T = any>(orgId: string, env: PayPalEnvironment, path: string, init: { method?: string; body?: unknown; requestId?: string; query?: Record<string, string | number> } = {}): Promise<T> {
  assertEnvironmentAllowed(env);
  const url = new URL(PAYPAL_BASE[env] + path);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, String(v));
  const method = init.method ?? "GET";
  const requestId = method === "POST" ? (init.requestId ?? crypto.randomUUID()) : undefined;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await token(orgId, env)}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && attempt === 0) {
      tokenCache.delete(`${orgId}:${env}`);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) throw new PayPalApiError(res.status, body);
    return body as T;
  }
}

export function toMinorStr(value: string, currency: string): number {
  const exp = ["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD"].includes(currency) ? 0 : 2;
  return Math.round(Number(value) * 10 ** exp);
}
export function toValueStr(minor: number, currency: string): string {
  const exp = ["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD"].includes(currency) ? 0 : 2;
  return (minor / 10 ** exp).toFixed(exp);
}
