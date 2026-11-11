/**
 * Browser-side EmailJS delivery (same approach as centre-floor-app).
 * The server checks permissions, writes the email and logs it as "queued",
 * then hands it here. We send it with the EmailJS public key and report the
 * outcome back so the log, invoice and approval are updated.
 */
import emailjs from "@emailjs/browser";

export interface EmailHandoff {
  logId: string;
  serviceId: string;
  templateId: string;
  publicKey: string;
  params: Record<string, string>;
}

type WithEmail = { ok: boolean; message: string; email?: EmailHandoff };

export const hasEmailHandoff = (r: unknown): r is WithEmail =>
  !!r && typeof r === "object" && !!(r as WithEmail).email && typeof (r as WithEmail).email!.logId === "string";

function errorText(e: unknown) {
  const x = e as { text?: string; message?: string; status?: number };
  return (x?.text || x?.message || "EmailJS rejected the request").slice(0, 280) + (x?.status ? ` (${x.status})` : "");
}

export async function deliverEmail<R extends WithEmail>(r: R, confirm: (data: { id: string; ok: boolean; error?: string }) => Promise<unknown>): Promise<R> {
  const h = r.email!;
  const to = h.params.to_email;
  try {
    await emailjs.send(h.serviceId, h.templateId, h.params, { publicKey: h.publicKey });
  } catch (e) {
    const error = errorText(e);
    await confirm({ id: h.logId, ok: false, error }).catch(() => undefined);
    return { ...r, email: undefined, ok: false, message: `The email to ${to} couldn't be sent: ${error}` };
  }
  await confirm({ id: h.logId, ok: true }).catch(() => undefined);
  return { ...r, email: undefined, ok: true, message: `Email sent to ${to}.` };
}
