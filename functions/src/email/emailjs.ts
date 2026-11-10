/**
 * Email delivery behind a provider interface (EmailJS today). Sending happens
 * only from the server with the EmailJS private key, and only after an
 * explicit human action or approval.
 *
 * EmailJS setup: Account → Security → enable "Allow EmailJS API for non-browser
 * applications". Each template should use {{to_email}}, {{to_name}},
 * {{subject}}, {{message}}, {{from_name}}, {{reply_to}}.
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

export const emailjs: EmailProvider = {
  id: "emailjs",
  configured: () => !!(P.EMAILJS_SERVICE_ID.value() && P.EMAILJS_PUBLIC_KEY.value() && P.secretValue(P.EMAILJS_PRIVATE_KEY)),
  async send(m) {
    const templateId = TEMPLATE[m.template]() || TEMPLATE.customer();
    if (!templateId) throw new Error(`No EmailJS template configured for “${m.template}”.`);
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: P.EMAILJS_SERVICE_ID.value(),
        template_id: templateId,
        user_id: P.EMAILJS_PUBLIC_KEY.value(),
        accessToken: P.secretValue(P.EMAILJS_PRIVATE_KEY),
        template_params: { to_email: m.to, to_name: m.toName ?? "", subject: m.subject, message: m.body, from_name: m.fromName, reply_to: m.replyTo ?? "" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`EmailJS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },
};

export const emailProvider = (): EmailProvider => emailjs;

/** Send and log. Never throws for delivery failures — returns the log so callers can report. */
export async function sendAndLog(orgId: string, m: EmailMessage, meta: { relatedType?: string; relatedId?: string; approvalId?: string }): Promise<EmailLog> {
  const ref = orgCol(orgId, "emailLogs").doc();
  const log: EmailLog = { id: ref.id, orgId, to: m.to, subject: m.subject, template: m.template, status: "sent", relatedType: meta.relatedType, relatedId: meta.relatedId, approvalId: meta.approvalId, createdAt: nowIso() };
  const p = emailProvider();
  try {
    if (!p.configured()) throw new Error("Email isn't configured (EmailJS service, public key, private key).");
    await p.send(m);
  } catch (e) {
    log.status = "failed";
    log.error = (e as Error).message.slice(0, 300);
  }
  await ref.set(log);
  return log;
}

export const EMAIL_SECRETS = [P.EMAILJS_PRIVATE_KEY];
