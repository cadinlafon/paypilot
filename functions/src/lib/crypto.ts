/**
 * AES-256-GCM encryption for per-organization credentials at rest.
 * Uses WebCrypto so the same code runs on Node (Firebase Functions) and
 * Cloudflare Workers. Format: v1.<iv b64>.<tag b64>.<ciphertext b64>
 */
import { HttpsError } from "firebase-functions/v2/https";
import { CREDENTIALS_ENCRYPTION_KEY, secretValue } from "./params";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

async function key(): Promise<CryptoKey> {
  const raw = secretValue(CREDENTIALS_ENCRYPTION_KEY);
  const k = raw ? unb64(raw) : new Uint8Array();
  if (k.length !== 32) throw new HttpsError("failed-precondition", "Server encryption key is not configured (CREDENTIALS_ENCRYPTION_KEY).");
  return crypto.subtle.importKey("raw", k, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain)));
  return ["v1", b64(iv), b64(out.slice(out.length - 16)), b64(out.slice(0, out.length - 16))].join(".");
}

export async function decrypt(token: string): Promise<string> {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1") throw new Error("Unknown ciphertext version");
  const ct = unb64(data), t = unb64(tag);
  const joined = new Uint8Array(ct.length + t.length);
  joined.set(ct);
  joined.set(t, ct.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), joined);
  return new TextDecoder().decode(plain);
}
