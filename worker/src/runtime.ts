/**
 * Per-isolate runtime state for the Worker: environment bindings, Google
 * service-account access, and outbound-request accounting.
 */
import { SignJWT, importPKCS8 } from "jose";

export interface Env {
  ASSETS?: { fetch(req: Request): Promise<Response> };
  FIREBASE_SERVICE_ACCOUNT?: string;
  FIREBASE_PROJECT_ID?: string;
  /** "host:port" — when set, Firestore + Auth emulators are used (local development only). */
  FIRESTORE_EMULATOR_HOST?: string;
  ALLOWED_ORIGINS?: string;
  [key: string]: unknown;
}

let current: Env = {};
export function setEnv(e: Env) {
  current = e;
}
export function env(): Env {
  return current;
}
export function envString(name: string): string | undefined {
  const v = current[name];
  return typeof v === "string" ? v : undefined;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}
let sa: ServiceAccount | null = null;
function serviceAccount(): ServiceAccount {
  if (sa) return sa;
  const raw = current.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
  const j = JSON.parse(raw) as ServiceAccount;
  if (!j.client_email || !j.private_key || !j.project_id) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing fields");
  sa = j;
  return sa;
}

export function projectId(): string {
  if (current.FIREBASE_PROJECT_ID) return current.FIREBASE_PROJECT_ID;
  return serviceAccount().project_id;
}

export const emulator = () => current.FIRESTORE_EMULATOR_HOST || "";

let token: { value: string; exp: number } | null = null;
/** OAuth token for Firestore, minted from the service account (cached ~1h). */
export async function googleToken(): Promise<string> {
  if (emulator()) return "owner"; // emulator admin bypass
  const now = Math.floor(Date.now() / 1000);
  if (token && token.exp > now + 60) return token.value;
  const acct = serviceAccount();
  const key = await importPKCS8(acct.private_key, "RS256");
  const uri = acct.token_uri ?? "https://oauth2.googleapis.com/token";
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/datastore" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(acct.client_email)
    .setAudience(uri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await counted(uri, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  if (!res.ok) throw new Error(`Service account token exchange failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, exp: now + j.expires_in };
  return token.value;
}

/** Outbound fetch (the Worker entry wraps global fetch to count subrequests). */
export function counted(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}
