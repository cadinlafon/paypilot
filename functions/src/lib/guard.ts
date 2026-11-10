/**
 * Server-side authorization. Every callable goes through `requireMember`,
 * which re-reads membership from Firestore — the client's claimed orgId or
 * permissions are never trusted.
 */
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import type { Member, Permission } from "../../../shared/types";
import { db, orgCol } from "./admin";

export interface Caller {
  uid: string;
  email: string;
  name: string;
  orgId: string;
  member: Member;
}

const ORG_ID = /^[A-Za-z0-9_-]{6,64}$/;

export function requireAuth(req: CallableRequest): { uid: string; email: string; name: string } {
  const a = req.auth;
  if (!a) throw new HttpsError("unauthenticated", "Sign in required.");
  if (a.token.email && a.token.email_verified === false && a.token.firebase?.sign_in_provider === "password") {
    throw new HttpsError("permission-denied", "Verify your email address first.");
  }
  return { uid: a.uid, email: String(a.token.email ?? ""), name: String(a.token.name ?? a.token.email ?? "User") };
}

export async function requireMember(req: CallableRequest, permission?: Permission | Permission[]): Promise<Caller> {
  const u = requireAuth(req);
  const orgId = (req.data as { orgId?: unknown })?.orgId;
  if (typeof orgId !== "string" || !ORG_ID.test(orgId)) throw new HttpsError("invalid-argument", "Invalid organization.");
  const snap = await orgCol(orgId, "members").doc(u.uid).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "You are not a member of this organization.");
  const member = snap.data() as Member;
  if (member.status !== "active") throw new HttpsError("permission-denied", "Your membership is not active.");
  const needed = permission ? (Array.isArray(permission) ? permission : [permission]) : [];
  for (const p of needed) if (!member.permissions?.includes(p)) throw new HttpsError("permission-denied", `Missing permission: ${p}`);
  return { ...u, orgId, member };
}

/** Fixed-window rate limit backed by Firestore. */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const ref = db.collection("_rateLimits").doc(`${key.replace(/[/]/g, "_")}_${bucket}`);
  const n = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const c = (s.exists ? (s.data()!.count as number) : 0) + 1;
    tx.set(ref, { count: c, expiresAt: new Date((bucket + 2) * windowSec * 1000) });
    return c;
  });
  if (n > limit) throw new HttpsError("resource-exhausted", "Too many requests. Please wait a moment and try again.");
}

// ── Input validation helpers ──
export function str(v: unknown, field: string, { min = 0, max = 500, pattern }: { min?: number; max?: number; pattern?: RegExp } = {}): string {
  if (typeof v !== "string") throw new HttpsError("invalid-argument", `${field} must be text.`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HttpsError("invalid-argument", `${field} must be ${min}–${max} characters.`);
  if (pattern && !pattern.test(s)) throw new HttpsError("invalid-argument", `${field} is invalid.`);
  return s;
}
export function int(v: unknown, field: string, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new HttpsError("invalid-argument", `${field} is invalid.`);
  return v;
}
export const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$/;
export const CURRENCY = /^[A-Z]{3}$/;
export const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Map unknown errors to safe client messages without leaking internals. */
export function safeError(e: unknown, fallback = "The operation failed."): HttpsError {
  if (e instanceof HttpsError) return e;
  console.error(e);
  return new HttpsError("internal", fallback);
}
