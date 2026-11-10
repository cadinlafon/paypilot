/** Integration status for the Integrations page. Reports only booleans/public IDs — never secret values. */
import { onCall } from "firebase-functions/v2/https";
import * as P from "./lib/params";
import { requireMember, safeError } from "./lib/guard";
import { db } from "./lib/admin";
import { emailjs } from "./email/emailjs";
import { fxHealth, provider } from "./fx/rates";
import { webhookUrl } from "./paypal/connect";

export const integrationStatus = onCall({ secrets: P.ALL_SECRETS }, async (req) => {
  try {
    const c = await requireMember(req);
    const fx = await fxHealth();
    const lastRate = await db.collection("organizations").doc(c.orgId).collection("exchangeRates").orderBy("fetchedAt", "desc").limit(1).get();
    return {
      openrouter: { configured: !!P.secretValue(P.OPENROUTER_API_KEY), defaultModel: P.OPENROUTER_DEFAULT_MODEL.value(), allowedModels: P.OPENROUTER_ALLOWED_MODELS.value().split(",") },
      emailjs: {
        configured: emailjs.configured(),
        serviceId: P.EMAILJS_SERVICE_ID.value() || undefined,
        publicKey: P.EMAILJS_PUBLIC_KEY.value() || undefined,
        templates: { invoice: P.EMAILJS_TEMPLATE_INVOICE.value() || undefined, reminder: P.EMAILJS_TEMPLATE_REMINDER.value() || undefined, customer: P.EMAILJS_TEMPLATE_CUSTOMER.value() || undefined, business: P.EMAILJS_TEMPLATE_BUSINESS.value() || undefined, automation: P.EMAILJS_TEMPLATE_AUTOMATION.value() || undefined },
      },
      b2: { configured: !!(P.secretValue(P.B2_KEY_ID) && P.secretValue(P.B2_APPLICATION_KEY) && P.B2_BUCKET_ID.value()), bucketName: P.B2_BUCKET_NAME.value() || undefined },
      fx: { provider: provider().label, ok: fx.ok, error: fx.error, lastUpdate: lastRate.docs[0]?.data().fetchedAt },
      paypal: { liveOnboardingEnabled: P.PAYPAL_LIVE_ENABLED.value(), webhookUrl: webhookUrl(c.orgId, "sandbox").split("?")[0] },
    };
  } catch (e) {
    throw safeError(e);
  }
});
