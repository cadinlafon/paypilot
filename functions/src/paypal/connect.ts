import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CREDENTIALS_ENCRYPTION_KEY, apiBase } from "../lib/params";
import { requireMember, rateLimit, str, safeError } from "../lib/guard";
import { encrypt } from "../lib/crypto";
import { audit, notify } from "../lib/audit";
import { nowIso, orgRef } from "../lib/admin";
import { assertEnvironmentAllowed, connectionRef, fetchToken, paypal, privateRef, PAYPAL_BASE } from "./client";
import type { PayPalConnectionPublic, PayPalEnvironment } from "../../../shared/types";

export const WEBHOOK_EVENTS = [
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.SALE.COMPLETED",
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "BILLING.SUBSCRIPTION.CREATED",
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
];

export function webhookUrl(orgId: string, env: PayPalEnvironment) {
  return `${apiBase()}/api/paypal/webhook?org=${encodeURIComponent(orgId)}&env=${env}`;
}

export const paypalConnect = onCall({ secrets: [CREDENTIALS_ENCRYPTION_KEY] }, async (req) => {
  try {
    const c = await requireMember(req, "integrations.manage");
    await rateLimit(`ppconnect_${c.orgId}`, 10, 3600);
    const env = req.data?.environment as PayPalEnvironment;
    if (env !== "sandbox" && env !== "live") throw new HttpsError("invalid-argument", "Invalid environment.");
    assertEnvironmentAllowed(env);
    const clientId = str(req.data?.clientId, "Client ID", { min: 20, max: 128, pattern: /^[A-Za-z0-9_-]+$/ });
    const clientSecret = str(req.data?.clientSecret, "Secret", { min: 20, max: 128 });

    // 1. Verify credentials against THIS environment only (sandbox creds fail on live and vice-versa).
    const t = await fetchToken(env, clientId, clientSecret);
    const scope = t.scope ?? "";
    const capabilities = {
      transactions: scope.includes("/v1/reporting/search"),
      invoicing: scope.includes("invoicing"),
      subscriptions: scope.includes("/billing") || scope.includes("vault"),
      orders: true,
    };

    // 2. Store encrypted credentials server-side.
    await privateRef(c.orgId, env).set({ clientId, secretEnc: await encrypt(clientSecret), environment: env, connectedBy: c.uid, connectedAt: nowIso() });

    // 3. Register (or reuse) the webhook for this organization.
    const pub: PayPalConnectionPublic = { environment: env, status: "connected", connectedAt: nowIso(), webhookStatus: "not_configured", capabilities };
    try {
      const url = webhookUrl(c.orgId, env);
      if (!url.startsWith("https://")) throw new Error("APP_BASE_URL must be https for PayPal webhooks");
      const list = await paypal<{ webhooks: { id: string; url: string }[] }>(c.orgId, env, "/v1/notifications/webhooks");
      let hook = list.webhooks.find((w) => w.url === url);
      if (!hook) hook = await paypal(c.orgId, env, "/v1/notifications/webhooks", { method: "POST", body: { url, event_types: WEBHOOK_EVENTS.map((name) => ({ name })) } });
      await privateRef(c.orgId, env).update({ webhookId: hook!.id });
      pub.webhookId = hook!.id;
      pub.webhookStatus = "active";
    } catch (e) {
      console.warn("Webhook registration failed", e);
      pub.webhookStatus = "error";
      const org = (await orgRef(c.orgId).get()).data();
      await notify(c.orgId, { category: "integration", severity: "warning", title: "PayPal webhook not registered", body: "Payments will still sync on schedule, but real-time updates are off. Check APP_BASE_URL is a public https URL.", link: "/integrations" }, org?.settings?.notifications?.categories);
    }
    await connectionRef(c.orgId, env).set(pub);
    await audit(c.orgId, c.email, `Connected PayPal ${env}`, clientId.slice(0, 6) + "…");
    return { ok: true, message: `Verified with ${PAYPAL_BASE[env].replace("https://", "")}. Initial sync will start shortly.` };
  } catch (e) {
    throw safeError(e, "Couldn't connect PayPal.");
  }
});

export const paypalDisconnect = onCall({ secrets: [CREDENTIALS_ENCRYPTION_KEY] }, async (req) => {
  try {
    const c = await requireMember(req, "integrations.manage");
    const env = req.data?.environment === "live" ? "live" : "sandbox";
    const priv = await privateRef(c.orgId, env).get();
    const hookId = priv.data()?.webhookId;
    if (hookId) await paypal(c.orgId, env, `/v1/notifications/webhooks/${hookId}`, { method: "DELETE" }).catch((e) => console.warn("webhook delete failed", e));
    await privateRef(c.orgId, env).delete();
    await connectionRef(c.orgId, env).set({ environment: env, status: "disconnected", webhookStatus: "not_configured", capabilities: { transactions: false, invoicing: false, subscriptions: false, orders: false } });
    await audit(c.orgId, c.email, `Disconnected PayPal ${env}`, "");
    return { ok: true };
  } catch (e) {
    throw safeError(e);
  }
});
