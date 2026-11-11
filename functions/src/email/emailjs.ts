/**
 * Email delivery behind a provider interface (EmailJS today). Every send
 * follows an explicit human action or approval.
 *
 * Two delivery modes:
 *  - Browser (default, same as centre-floor-app): the server checks
 *    permissions, writes the email and logs it as "queued", then hands it to
 *    the signed-in user's browser, which sends it with the EmailJS public key
 *    and reports back via `confirmEmail`. No private key or EmailJS settings
 *    change needed.
 *  - Server: when EMAILJS_PRIVATE_KEY is set (and "Allow EmailJS API for
 *    non-browser applications" is on), the server sends directly.
 *
 * Each template should use {{to_email}}, {{to_name}}, {{subject}},
 * {{message}}, {{from_name}}, {{reply_to}}.
 */
import type { EmailLog, EmailTemplateKey } from "../../../shared/types";
import { orgCol, nowIso } from "../lib/admin";
import * as P from "../lib/params";

export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  body: string;
  fromName: string;
  replyTo?: string;
  template: EmailTemplateKey;
}

export interface EmailProvider {
  id: string;
  configured(): boolean;
  send(m: EmailMessage): Promise<void>;
}

const TEMPLATE: Record<EmailTemplateKey, () => string> = {
  invoice: () => P.EMAILJS_TEMPLATE_INVOICE.value(),
  reminder: () => P.EMAILJS_TEMPLATE_REMINDER.value(),
  customer: () => P.EMAILJS_TEMPLATE_CUSTOMER.value(),
  business: () => P.EMAILJS_TEMPLATE_BUSINESS.value(),
  automation: () => P.EMAILJS_TEMPLATE_AUTOMATION.value(),
};

const templateFor = (k: EmailTemplateKey) => TEMPLATE[k]() || TEMPLATE.customer();
const paramsFor = (m: EmailMessage) => ({ to_email: m.to, to_name: m.toName ?? "", subject: m.subject, message: m.body, from_name: m.fromName, reply_to: m.replyTo ?? "" });
const serverDelivery = () => !!P.secretValue(P.EMAILJS_PRIVATE_KEY);

/** What the browser needs to send a queued email itself. All values are public except the content. */
export interface EmailHandoff {
  logId: string;
  serviceId: string;
  templateId: string;
  publicKey: string;
  params: Record<string, string>;
}

export const emailjs: EmailProvider = {
  id: "emailjs",
  configured: () => !!(P.EMAILJS_SERVICE_ID.value() && P.EMAILJS_PUBLIC_KEY.value() && TEMPLATE.customer()),
  async send(m) {
    const templateId = templateFor(m.template);
    if (!templateId) throw new Error(`No EmailJS template configured for “${m.template}”.`);
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: P.EMAILJS_SERVICE_ID.value(),
        template_id: templateId,
        user_id: P.EMAILJS_PUBLIC_KEY.value(),
        accessToken: P.secretValue(P.EMAILJS_PRIVATE_KEY),
        template_params: paramsFor(m),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`EmailJS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },
};

export const emailProvider = (): EmailProvider => emailjs;

/**
 * Send (server mode) or queue for the browser (browser mode), and log it.
 * Never throws for delivery failures — returns the log so callers can report.
 */
export async function sendAndLog(orgId: string, m: EmailMessage, meta: { relatedType?: string; relatedId?: string; approvalId?: string; uid?: string }): Promise<{ log: EmailLog; handoff?: EmailHandoff }> {
  const ref = orgCol(orgId, "emailLogs").doc();
  const log: EmailLog = { id: ref.id, orgId, to: m.to, subject: m.subject, template: m.template, status: "sent", createdAt: nowIso() };
  if (meta.relatedType) log.relatedType = meta.relatedType;
  if (meta.relatedId) log.relatedId = meta.relatedId;
  if (meta.approvalId) log.approvalId = meta.approvalId;
  const p = emailProvider();
  let handoff: EmailHandoff | undefined;
  try {
    if (!p.configured()) throw new Error("Email isn't configured (EmailJS service ID, public key and template).");
    if (serverDelivery()) {
      await p.send(m);
    } else {
      if (!meta.uid) throw new Error("Email can only be sent from the app.");
      log.status = "queued";
      log.queuedBy = meta.uid;
      handoff = { logId: ref.id, serviceId: P.EMAILJS_SERVICE_ID.value(), templateId: templateFor(m.template), publicKey: P.EMAILJS_PUBLIC_KEY.value(), params: paramsFor(m) };
    }
  } catch (e) {
    log.status = "failed";
    log.error = (e as Error).message.slice(0, 300);
  }
  await ref.set(log);
  return { log, handoff };
}

export const EMAIL_SECRETS = [P.EMAILJS_PRIVATE_KEY];
