import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable, type Functions } from "firebase/functions";
import { apiBaseUrl, backend, firebaseConfig, firebaseConfigured, functionsRegion, useEmulators } from "./config";
import { deliverEmail, hasEmailHandoff } from "./email";

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let fns: Functions | null = null;

if (firebaseConfigured) {
  app = initializeApp(firebaseConfig as Record<string, string>);
  auth = getAuth(app);
  db = getFirestore(app);
  fns = getFunctions(app, functionsRegion);
  if (useEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  }
}

export { app, auth, db };

/**
 * Call a Cloud Function. All privileged operations (PayPal, email, AI,
 * storage, member management) go through here — the server re-validates the
 * caller's organization membership and permissions on every call.
 */
export async function callFn<Req, Res>(name: string, data: Req): Promise<Res> {
  const result = await callRaw<Req, Res>(name, data);
  // The server handed us an email to send from this browser (EmailJS public key).
  if (hasEmailHandoff(result)) return (await deliverEmail(result, (d) => callRaw("confirmEmail", d))) as Res;
  return result;
}

async function callRaw<Req, Res>(name: string, data: Req): Promise<Res> {
  if (!fns || !auth) throw new Error("Firebase is not configured. Add VITE_FIREBASE_* values to .env to enable Real Mode.");
  if (backend === "firebase") {
    const res = await httpsCallable<Req, Res>(fns, name, { timeout: 120_000 })(data);
    return res.data;
  }
  const send = async (forceRefresh: boolean) => {
    const token = await auth!.currentUser?.getIdToken(forceRefresh);
    try {
      return await fetch(`${apiBaseUrl}/api/call/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ data }),
      });
    } catch {
      throw new Error("Couldn't reach the PayPilot server. Check your connection and try again.");
    }
  };
  let res = await send(false);
  let body = (await res.json().catch(() => null)) as { result?: Res; error?: { status: string; message: string } } | null;
  // Claims like email_verified live in the ID token; after verifying, a fresh token is needed once.
  if ((res.status === 401 || /verify your email/i.test(body?.error?.message ?? "")) && auth.currentUser) {
    res = await send(true);
    body = (await res.json().catch(() => null)) as typeof body;
  }
  if (!res.ok || !body || body.error) {
    // No JSON body means the request never reached PayPilot's server (proxy, network or platform error).
    const err = new Error(body?.error?.message ?? `Couldn't reach the PayPilot server (HTTP ${res.status}). Please try again.`) as Error & { code?: string };
    err.code = body?.error?.status;
    throw err;
  }
  return body.result as Res;
}

/** Ask the server to process recent client-side writes (automations, currency conversion). Best effort. */
export function nudgeServer() {
  if (backend !== "worker" || !auth?.currentUser) return;
  callFn("sweepNow", {}).catch(() => undefined);
}
