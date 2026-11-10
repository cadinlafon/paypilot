/** Public, build-time configuration. Never put secrets in VITE_* variables. */
const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** True when Firebase web config is present. Without it, PayPilot runs Demo-only. */
export const firebaseConfigured = !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
export const functionsRegion = (env.VITE_FUNCTIONS_REGION as string | undefined) || "us-central1";
export const useEmulators = env.VITE_USE_EMULATORS === "true";
/**
 * Where server functions run:
 *  - "worker" (default): Cloudflare Worker at VITE_API_BASE_URL (same origin when empty) — free, no Firebase billing.
 *  - "firebase": Firebase Cloud Functions (requires the Blaze plan).
 */
export const backend = (env.VITE_BACKEND as string | undefined) === "firebase" ? "firebase" : "worker";
/** The deployed Worker API. Used when the app is served from Firebase Hosting (which can't proxy to it). */
const HOSTED_API_URL = "https://paypilot.cadinlafon.workers.dev";
const onFirebaseHosting = typeof location !== "undefined" && /\.(web\.app|firebaseapp\.com)$/.test(location.hostname);
export const apiBaseUrl = ((env.VITE_API_BASE_URL as string | undefined) || (onFirebaseHosting ? HOSTED_API_URL : "")).replace(/\/$/, "");
