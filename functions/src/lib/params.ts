import { defineSecret, defineString, defineBoolean } from "firebase-functions/params";

// Secrets — set with `firebase functions:secrets:set NAME`. Never sent to clients.
export const OPENROUTER_API_KEY = defineSecret("OPENROUTER_API_KEY");
export const EMAILJS_PRIVATE_KEY = defineSecret("EMAILJS_PRIVATE_KEY");
export const B2_KEY_ID = defineSecret("B2_KEY_ID");
export const B2_APPLICATION_KEY = defineSecret("B2_APPLICATION_KEY");
export const CREDENTIALS_ENCRYPTION_KEY = defineSecret("CREDENTIALS_ENCRYPTION_KEY");

// Non-secret configuration (functions/.env).
export const APP_BASE_URL = defineString("APP_BASE_URL", { default: "http://localhost:5320" });
/** Public base URL of the API (webhooks, payment-link checkout). Same as APP_BASE_URL when one host serves both. */
export const API_BASE_URL = defineString("API_BASE_URL", { default: "" });
export const apiBase = () => (API_BASE_URL.value() || APP_BASE_URL.value()).replace(/\/$/, "");
/** Max transactions loaded for analytics/AI (lower on Cloudflare Workers to respect CPU limits). */
export const DATASET_TX_LIMIT = defineString("DATASET_TX_LIMIT", { default: "5000" });
export const OPENROUTER_DEFAULT_MODEL = defineString("OPENROUTER_DEFAULT_MODEL", { default: "nvidia/nemotron-3.5-super-vl:free" });
export const ONLY_FREE_MODELS = defineString("ONLY_FREE_MODELS", { default: "true" });
export const OPENROUTER_ALLOWED_MODELS = defineString("OPENROUTER_ALLOWED_MODELS", { default: "nvidia/nemotron-3.5-super-vl:free,nvidia/nemotron-3.5-lightning:free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free" });
export const EMAILJS_SERVICE_ID = defineString("EMAILJS_SERVICE_ID", { default: "" });
export const EMAILJS_PUBLIC_KEY = defineString("EMAILJS_PUBLIC_KEY", { default: "" });
export const EMAILJS_TEMPLATE_INVOICE = defineString("EMAILJS_TEMPLATE_INVOICE", { default: "" });
export const EMAILJS_TEMPLATE_REMINDER = defineString("EMAILJS_TEMPLATE_REMINDER", { default: "" });
export const EMAILJS_TEMPLATE_CUSTOMER = defineString("EMAILJS_TEMPLATE_CUSTOMER", { default: "" });
export const EMAILJS_TEMPLATE_BUSINESS = defineString("EMAILJS_TEMPLATE_BUSINESS", { default: "" });
export const EMAILJS_TEMPLATE_AUTOMATION = defineString("EMAILJS_TEMPLATE_AUTOMATION", { default: "" });
export const B2_BUCKET_ID = defineString("B2_BUCKET_ID", { default: "" });
export const B2_BUCKET_NAME = defineString("B2_BUCKET_NAME", { default: "" });
export const FX_PROVIDER = defineString("FX_PROVIDER", { default: "frankfurter" });
/**
 * Live PayPal operations stay OFF until PayPal partner approval and Live
 * onboarding are in place. Flip only after that approval.
 */
export const PAYPAL_LIVE_ENABLED = defineBoolean("PAYPAL_LIVE_ENABLED", { default: false });

export const ALL_SECRETS = [OPENROUTER_API_KEY, EMAILJS_PRIVATE_KEY, B2_KEY_ID, B2_APPLICATION_KEY, CREDENTIALS_ENCRYPTION_KEY];

/** Read a secret without throwing when it isn't configured. */
export function secretValue(s: { value(): string }): string {
  try {
    return s.value() || "";
  } catch {
    return "";
  }
}
