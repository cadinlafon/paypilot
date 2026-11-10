/**
 * Verifies Firebase ID tokens against Google's published certificates — the
 * same checks the Admin SDK performs (signature, issuer, audience, expiry).
 * Emulator tokens (unsigned) are accepted ONLY when FIRESTORE_EMULATOR_HOST is set.
 */
import { decodeJwt, decodeProtectedHeader, importX509, jwtVerify, type JWTPayload } from "jose";
import { emulator, projectId } from "./runtime";

const CERTS = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certs: { map: Record<string, string>; exp: number } | null = null;

async function getCerts() {
  if (certs && certs.exp > Date.now()) return certs.map;
  const res = await fetch(CERTS);
  if (!res.ok) throw new Error("Could not fetch Firebase auth certificates");
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  certs = { map: (await res.json()) as Record<string, string>, exp: Date.now() + maxAge * 1000 };
  return certs.map;
}

export async function verifyIdToken(token: string): Promise<{ uid: string; token: JWTPayload & Record<string, any> }> {
  const pid = projectId();
  let payload: JWTPayload;
  if (emulator()) {
    payload = decodeJwt(token);
    if (payload.aud !== pid) throw new Error("Wrong audience");
  } else {
    const { kid } = decodeProtectedHeader(token);
    const pem = kid ? (await getCerts())[kid] : undefined;
    if (!pem) throw new Error("Unknown signing key");
    ({ payload } = await jwtVerify(token, await importX509(pem, "RS256"), { issuer: `https://securetoken.google.com/${pid}`, audience: pid }));
  }
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("Token has no subject");
  if (typeof payload.auth_time === "number" && payload.auth_time * 1000 > Date.now() + 60_000) throw new Error("Token from the future");
  return { uid: payload.sub, token: payload as JWTPayload & Record<string, any> };
}
