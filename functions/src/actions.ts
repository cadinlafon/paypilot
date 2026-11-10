/**
 * External / financial actions. Each executor is called ONLY from:
 *  - a callable invoked by a human with the right permission after a
 *    confirmation dialog, or
 *  - `decideApproval`, after a human approves a pending request created by
 *    the AI assistant or an automation.
 * Nothing in this file is reachable from AI tools or automations directly.
 */
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import type { ApprovalRequest, EmailTemplateKey, Invoice, Organization, PaymentLink, Permission, Transaction, AutomationRun } from "../../shared/types";
import { computeInvoiceTotals, formatMoney, lineAmount } from "../../shared/money";
import { db, orgCol, orgRef, nowIso } from "./lib/admin";
import { requireMember, rateLimit, str, int, safeError, EMAIL, CURRENCY, ID } from "./lib/guard";
import { audit } from "./lib/audit";
import { APP_BASE_URL, CREDENTIALS_ENCRYPTION_KEY, EMAILJS_PRIVATE_KEY, apiBase } from "./lib/params";
import { activeEnvironment, assertEnvironmentAllowed, connectionRef, paypal, PayPalApiError, toMinorStr, toValueStr } from "./paypal/client";
import { txDocId, upsertTransactions } from "./paypal/records";
import { sendAndLog } from "./email/emailjs";

const SECRETS = [CREDENTIALS_ENCRYPTION_KEY, EMAILJS_PRIVATE_KEY];
type Result = { ok: boolean; message: string };

function ppMessage(e: unknown): string {
  if (e instanceof PayPalApiError) {
    const issue = e.issue ?? "";
    const known: Record<string, string> = {
      CAPTURE_FULLY_REFUNDED: "This payment has already been fully refunded.",
      REFUND_AMOUNT_EXCEEDED: "The refund exceeds the remaining refundable amount.",
      REFUND_TIME_LIMIT_EXCEEDED: "PayPal's refund window for this payment has passed.",
      AUTHORIZATION_EXPIRED: "This authorization has expired and can't be captured.",
      AUTHORIZATION_ALREADY_CAPTURED: "This authorization was already captured.",
      PERMISSION_DENIED: "PayPal denied permission for this operation on the connected account.",
    };
    return known[issue] ?? `PayPal returned an error (${issue || e.status}).`;
  }
  if (e instanceof HttpsError) return e.message;
  return "The operation failed.";
}

// ── Executors ──────────────────────────────────────────────────────────────

export async function doRefund(orgId: string, actor: string, transactionId: string, amount: number, reason: string): Promise<Result> {
  const ref = orgCol(orgId, "transactions").doc(transactionId);
  const t = (await ref.get()).data() as Transaction | undefined;
  if (!t) return { ok: false, message: "Transaction not found." };
  if (t.source !== "paypal" || !t.externalId || !t.environment) return { ok: false, message: "Only PayPal transactions can be refunded through PayPilot." };
  if (!["completed", "partially_refunded"].includes(t.status) || t.type === "purchase") return { ok: false, message: `A ${t.status} ${t.type} can't be refunded.` };
  const remaining = t.gross - t.refundedAmount;
  if (amount <= 0 || amount > remaining) return { ok: false, message: `Refund must be between 0 and ${formatMoney(remaining, t.currency)}.` };
  assertEnvironmentAllowed(t.environment);
  try {
    const r = await paypal(orgId, t.environment, `/v2/payments/captures/${encodeURIComponent(t.externalId)}/refund`, {
      method: "POST",
      requestId: `refund-${transactionId}-${t.refunds.length}-${amount}`,
      body: { amount: { value: toValueStr(amount, t.currency), currency_code: t.currency }, note_to_payer: reason.slice(0, 255) },
    });
    const refunded = t.refundedAmount + amount;
    await ref.update({ refunds: [...t.refunds, { id: r.id, externalId: r.id, amount, date: nowIso(), reason }], refundedAmount: refunded, status: refunded >= t.gross ? "refunded" : "partially_refunded", updatedAt: nowIso() });
    await audit(orgId, actor, "Issued refund", t.externalId, `${formatMoney(amount, t.currency)} · ${reason}`);
    return { ok: true, message: `Refunded ${formatMoney(amount, t.currency)} via PayPal ${t.environment} (refund ${r.id}).` };
  } catch (e) {
    await audit(orgId, actor, "Refund failed", t.externalId, ppMessage(e));
    return { ok: false, message: ppMessage(e) };
  }
}

export async function doCapture(orgId: string, actor: string, transactionId: string): Promise<Result> {
  const ref = orgCol(orgId, "transactions").doc(transactionId);
  const t = (await ref.get()).data() as Transaction | undefined;
  if (!t || t.status !== "authorized" || !t.externalId || !t.environment) return { ok: false, message: "Only authorized PayPal payments can be captured." };
  assertEnvironmentAllowed(t.environment);
  try {
    const r = await paypal(orgId, t.environment, `/v2/payments/authorizations/${encodeURIComponent(t.externalId)}/capture`, { method: "POST", requestId: `capture-${transactionId}`, body: { final_capture: true } });
    // The authorization record (type "authorization", never counted as revenue) is marked done;
    // the capture becomes its own payment record. PAYMENT.CAPTURE.COMPLETED later fills in fees.
    const { id: _id, orgId: _o, createdAt: _c, updatedAt: _u, reporting: _r, ...base } = t;
    await upsertTransactions(orgId, t.environment, [{ ...base, externalId: r.id, type: "payment", status: r.status === "COMPLETED" ? "completed" : "pending", date: nowIso(), description: `${t.description} (captured)`, authorizationExpiresAt: undefined }]);
    await ref.update({ status: "completed", description: `${t.description} — captured as ${r.id}`, updatedAt: nowIso() });
    await audit(orgId, actor, "Captured authorization", t.externalId, formatMoney(t.gross, t.currency));
    return { ok: true, message: `Captured ${formatMoney(t.gross, t.currency)} (capture ${r.id}).` };
  } catch (e) {
    return { ok: false, message: ppMessage(e) };
  }
}

export async function doCreatePaymentLink(orgId: string, actor: string, input: { description: string; amount: number; currency: string; customerId?: string; expiresAt?: string }): Promise<PaymentLink> {
  const env = await activeEnvironment(orgId);
  if (!env) throw new HttpsError("failed-precondition", "Connect PayPal before creating payment links.");
  const ref = orgCol(orgId, "paymentLinks").doc();
  const cust = input.customerId ? (await orgCol(orgId, "customers").doc(input.customerId).get()).data() : undefined;
  const now = nowIso();
  const link: PaymentLink = {
    id: ref.id,
    orgId,
    source: "paypal",
    environment: env,
    description: input.description,
    amount: input.amount,
    currency: input.currency,
    customerId: cust ? input.customerId : undefined,
    customerName: cust?.name,
    status: "active",
    url: `${apiBase()}/api/pay/${orgId}/${ref.id}`,
    isSample: false,
    expiresAt: input.expiresAt,
    views: 0,
    activity: [{ at: now, event: "Created", detail: `PayPal ${env} checkout` }],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  await ref.set(link);
  await audit(orgId, actor, "Created payment link", input.description, formatMoney(input.amount, input.currency));
  return link;
}

export async function doSendEmail(orgId: string, actor: string, m: { to: string; toName?: string; subject: string; body: string; template: EmailTemplateKey; relatedType?: string; relatedId?: string }, approvalId?: string): Promise<Result> {
  const org = (await orgRef(orgId).get()).data() as Organization;
  const log = await sendAndLog(orgId, { ...m, fromName: org.name, replyTo: org.email }, { relatedType: m.relatedType, relatedId: m.relatedId, approvalId });
  await audit(orgId, actor, log.status === "sent" ? "Sent email" : "Email failed", m.to, m.subject);
  return log.status === "sent" ? { ok: true, message: `Email sent to ${m.to}.` } : { ok: false, message: log.error ?? "Email failed." };
}

export async function doSendInvoice(orgId: string, actor: string, invoiceId: string): Promise<Result> {
  const ref = orgCol(orgId, "invoices").doc(invoiceId);
  const inv = (await ref.get()).data() as Invoice | undefined;
  if (!inv) return { ok: false, message: "Invoice not found." };
  if (inv.status === "cancelled" || inv.status === "paid") return { ok: false, message: `A ${inv.status} invoice can't be sent.` };
  const org = (await orgRef(orgId).get()).data() as Organization;
  const totals = computeInvoiceTotals(inv);
  const env = await activeEnvironment(orgId);
  const conn = env ? (await connectionRef(orgId, env).get()).data() : null;
  const history = [...inv.history];
  // Prefer PayPal Invoicing when available: PayPal emails the customer and hosts the payment page.
  if (env && conn?.capabilities?.invoicing && !inv.externalId) {
    try {
      const created = await paypal(orgId, env, "/v2/invoicing/invoices", {
        method: "POST",
        requestId: `inv-${invoiceId}`,
        body: {
          detail: { invoice_number: inv.number, invoice_date: inv.issueDate, currency_code: inv.currency, note: inv.notes.slice(0, 4000), payment_term: { due_date: inv.dueDate } },
          invoicer: { business_name: org.name },
          primary_recipients: [{ billing_info: { email_address: inv.customerEmail, name: { full_name: inv.customerName } } }],
          items: inv.lines.map((l) => ({ name: l.description.slice(0, 200), quantity: String(l.quantity), unit_amount: { currency_code: inv.currency, value: toValueStr(l.unitPrice, inv.currency) }, ...(l.taxRate ? { tax: { name: "Tax", percent: String(l.taxRate) } } : {}) })),
          ...(totals.discount ? { amount: { breakdown: { discount: { invoice_discount: { amount: { currency_code: inv.currency, value: toValueStr(totals.discount, inv.currency) } } } } } } : {}),
        },
      });
      const id = created.id ?? String(created.href ?? "").split("/").pop();
      await paypal(orgId, env, `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, { method: "POST", requestId: `invsend-${invoiceId}`, body: { send_to_invoicer: false } });
      history.push({ at: nowIso(), event: `Sent via PayPal ${env} invoicing to ${inv.customerEmail}`, by: actor });
      await ref.update({ externalId: id, environment: env, status: "sent", totals, history, updatedAt: nowIso() });
      await audit(orgId, actor, "Sent invoice via PayPal", inv.number);
      return { ok: true, message: `PayPal emailed invoice ${inv.number} to ${inv.customerEmail}.` };
    } catch (e) {
      console.warn("PayPal invoicing failed, falling back to email", e);
      history.push({ at: nowIso(), event: `PayPal invoicing failed: ${ppMessage(e)}`, by: "system" });
    }
  }
  const lines = inv.lines.map((l) => `• ${l.quantity} × ${l.description} — ${formatMoney(lineAmount(l), inv.currency)}`).join("\n");
  const r = await doSendEmail(orgId, actor, {
    to: inv.customerEmail,
    toName: inv.customerName,
    template: "invoice",
    subject: `Invoice ${inv.number} from ${org.name} — ${formatMoney(totals.balance || totals.total, inv.currency)}`,
    body: `Hi ${inv.customerName.split(" ")[0]},\n\nPlease find invoice ${inv.number} below.\n\n${lines}\n\nTotal: ${formatMoney(totals.total, inv.currency)}\nDue: ${inv.dueDate}\n\n${inv.notes}\n\n${org.name}`,
    relatedType: "invoice",
    relatedId: invoiceId,
  });
  if (r.ok) history.push({ at: nowIso(), event: `Emailed to ${inv.customerEmail}`, by: actor });
  await ref.update({ status: r.ok && inv.status === "draft" ? "sent" : inv.status, totals, history, updatedAt: nowIso() });
  return r;
}

// ── Callables (human-initiated, after a confirmation dialog) ───────────────

export const paypalRefund = onCall({ secrets: SECRETS }, async (req) => {
  try {
    const c = await requireMember(req, "transactions.refund");
    await rateLimit(`refund_${c.uid}`, 20, 3600);
    return await doRefund(c.orgId, c.email, str(req.data?.transactionId, "Transaction", { pattern: ID }), int(req.data?.amount, "Amount", { min: 1 }), str(req.data?.reason ?? "Refund", "Reason", { max: 255 }));
  } catch (e) {
    throw safeError(e);
  }
});

export const paypalCapture = onCall({ secrets: SECRETS }, async (req) => {
  try {
    const c = await requireMember(req, "transactions.capture");
    await rateLimit(`capture_${c.uid}`, 20, 3600);
    return await doCapture(c.orgId, c.email, str(req.data?.transactionId, "Transaction", { pattern: ID }));
  } catch (e) {
    throw safeError(e);
  }
});

export const createPaymentLink = onCall({ secrets: SECRETS }, async (req) => {
  try {
    const c = await requireMember(req, "paymentLinks.create");
    await rateLimit(`plink_${c.uid}`, 50, 3600);
    const currency = str(req.data?.currency, "Currency", { pattern: CURRENCY });
    const expiresAt = req.data?.expiresAt ? new Date(String(req.data.expiresAt)) : undefined;
    if (expiresAt && (isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now())) throw new HttpsError("invalid-argument", "Expiry must be in the future.");
    return await doCreatePaymentLink(c.orgId, c.email, {
      description: str(req.data?.description, "Description", { min: 2, max: 127 }),
      amount: int(req.data?.amount, "Amount", { min: 1, max: 10_000_000_00 }),
      currency,
      customerId: req.data?.customerId ? str(req.data.customerId, "Customer", { pattern: ID }) : undefined,
      expiresAt: expiresAt?.toISOString(),
    });
  } catch (e) {
    throw safeError(e);
  }
});

export const setPaymentLinkStatus = onCall(async (req) => {
  try {
    const c = await requireMember(req, "paymentLinks.create");
    const id = str(req.data?.id, "Link", { pattern: ID });
    const status = req.data?.status === "disabled" ? "disabled" : "active";
    const ref = orgCol(c.orgId, "paymentLinks").doc(id);
    const l = (await ref.get()).data() as PaymentLink | undefined;
    if (!l || l.status === "paid" || l.status === "expired") throw new HttpsError("failed-precondition", "This link can't be changed.");
    await ref.update({ status, activity: [...l.activity, { at: nowIso(), event: status === "disabled" ? "Disabled" : "Re-enabled", detail: c.email }], updatedAt: nowIso() });
    await audit(c.orgId, c.email, `${status === "disabled" ? "Disabled" : "Enabled"} payment link`, l.description);
    return { ok: true };
  } catch (e) {
    throw safeError(e);
  }
});

export const sendInvoice = onCall({ secrets: SECRETS }, async (req) => {
  try {
    const c = await requireMember(req, "invoices.send");
    await rateLimit(`sendinv_${c.uid}`, 60, 3600);
    return await doSendInvoice(c.orgId, c.email, str(req.data?.invoiceId, "Invoice", { pattern: ID }));
  } catch (e) {
    throw safeError(e);
  }
});

/** A human-initiated email (e.g. "Send reminder" after confirmation). */
export const requestEmail = onCall({ secrets: SECRETS }, async (req) => {
  try {
    const c = await requireMember(req, "invoices.send");
    await rateLimit(`email_${c.uid}`, 60, 3600);
    const d = req.data ?? {};
    const template = (["invoice", "reminder", "customer", "business", "automation"].includes(d.template) ? d.template : "customer") as EmailTemplateKey;
    return await doSendEmail(c.orgId, c.email, { to: str(d.to, "Recipient", { pattern: EMAIL, max: 254 }), toName: d.toName ? str(d.toName, "Name", { max: 120 }) : undefined, subject: str(d.subject, "Subject", { min: 1, max: 200 }), body: str(d.body, "Body", { min: 1, max: 10_000 }), template, relatedType: d.relatedType, relatedId: d.relatedId });
  } catch (e) {
    throw safeError(e);
  }
});

// ── Approvals ──────────────────────────────────────────────────────────────

const KIND_PERMISSION: Record<ApprovalRequest["kind"], Permission> = {
  send_email: "invoices.send",
  send_invoice: "invoices.send",
  create_payment_link: "paymentLinks.create",
  refund: "transactions.refund",
  capture: "transactions.capture",
  trigger_automation: "automations.configure",
};

export const decideApproval = onCall({ secrets: SECRETS }, async (req) => {
  try {
    const c = await requireMember(req);
    const id = str(req.data?.id, "Request", { pattern: ID });
    const approve = req.data?.approve === true;
    const ref = orgCol(c.orgId, "aiActions").doc(id);
    // Claim the request atomically so it can only ever execute once.
    const a = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw new HttpsError("not-found", "Request not found.");
      const a = s.data() as ApprovalRequest;
      if (a.status !== "pending") throw new HttpsError("failed-precondition", "This request was already decided.");
      if (!c.member.permissions.includes(KIND_PERMISSION[a.kind])) throw new HttpsError("permission-denied", `Your role can't approve ${a.kind.replace("_", " ")}.`);
      tx.update(ref, { status: approve ? "approved" : "rejected", decidedAt: nowIso(), decidedBy: c.email });
      return a;
    });
    if (!approve) {
      await audit(c.orgId, c.email, "Rejected action", a.title);
      if (a.automationRunId) await markRun(c.orgId, a.automationRunId, false, "Rejected by reviewer");
      return { ok: true, message: "Rejected. Nothing was executed." };
    }
    const p = a.payload as Record<string, any>;
    let r: Result;
    switch (a.kind) {
      case "send_email":
        r = await doSendEmail(c.orgId, c.email, { to: str(p.to, "Recipient", { pattern: EMAIL }), toName: p.toName, subject: String(p.subject).slice(0, 200), body: String(p.body).slice(0, 10_000), template: p.template ?? "customer", relatedType: p.relatedType, relatedId: p.relatedId }, a.id);
        break;
      case "send_invoice":
        r = await doSendInvoice(c.orgId, c.email, String(p.invoiceId));
        break;
      case "create_payment_link": {
        const l = await doCreatePaymentLink(c.orgId, c.email, { description: String(p.description).slice(0, 127), amount: Number(p.amount), currency: String(p.currency), customerId: p.customerId });
        r = { ok: true, message: `Payment link created: ${l.url}` };
        break;
      }
      case "refund":
        r = await doRefund(c.orgId, c.email, String(p.transactionId), Number(p.amount), String(p.reason ?? "Approved refund"));
        break;
      case "capture":
        r = await doCapture(c.orgId, c.email, String(p.transactionId));
        break;
      default:
        r = { ok: false, message: "Unsupported action." };
    }
    await ref.update({ status: r.ok ? "executed" : "failed", result: r.message });
    await audit(c.orgId, c.email, `Approved: ${a.title}`, a.kind, r.message);
    if (a.automationRunId) await markRun(c.orgId, a.automationRunId, r.ok, r.message);
    return r;
  } catch (e) {
    throw safeError(e);
  }
});

async function markRun(orgId: string, runId: string, ok: boolean, detail: string) {
  const ref = orgCol(orgId, "automationRuns").doc(runId);
  const run = (await ref.get()).data() as AutomationRun | undefined;
  if (!run) return;
  await ref.update({ steps: run.steps.map((s) => (s.status === "pending_approval" ? { ...s, status: ok ? "success" : "failed", detail } : s)), status: ok ? "success" : "failed", error: ok ? null : detail });
}

// ── Public payment-link checkout (served under /api/pay via Hosting rewrites) ──

export const payLink = onRequest({ secrets: [CREDENTIALS_ENCRYPTION_KEY], maxInstances: 20 }, async (req, res) => {
  const base = APP_BASE_URL.value().replace(/\/$/, "");
  const fail = (msg: string) => res.redirect(302, `${base}/pay/return?status=error&message=${encodeURIComponent(msg)}`);
  try {
    const parts = req.path.split("/").filter(Boolean); // [.., orgId, linkId]
    const [orgId, linkId] = parts.slice(-2);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(orgId ?? "") || !ID.test(linkId ?? "")) return fail("This payment link is invalid.");
    const ref = orgCol(orgId, "paymentLinks").doc(linkId);
    const l = (await ref.get()).data() as PaymentLink | undefined;
    if (!l || l.isSample) return fail("This payment link doesn't exist.");
    if (l.status === "paid") return fail("This link has already been paid.");
    if (l.status !== "active") return fail("This payment link is no longer active.");
    if (l.expiresAt && Date.parse(l.expiresAt) < Date.now()) {
      await ref.update({ status: "expired", activity: [...l.activity, { at: nowIso(), event: "Expired" }] });
      return fail("This payment link has expired.");
    }
    const org = (await orgRef(orgId).get()).data() as Organization;
    const order = await paypal(orgId, l.environment!, "/v2/checkout/orders", {
      method: "POST",
      body: {
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: l.currency, value: toValueStr(l.amount, l.currency) }, description: l.description.slice(0, 127), custom_id: `pl:${linkId}` }],
        payment_source: { paypal: { experience_context: { brand_name: org.name.slice(0, 127), user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: `${apiBase()}/api/pay-return?org=${orgId}&link=${linkId}`, cancel_url: `${base}/pay/return?status=cancelled` } } },
      },
    });
    await ref.update({ views: (l.views ?? 0) + 1, activity: [...l.activity, { at: nowIso(), event: "Checkout started", detail: order.id }].slice(-100) });
    const approve = (order.links as { rel: string; href: string }[]).find((x) => x.rel === "payer-action" || x.rel === "approve");
    if (!approve) return fail("PayPal didn't return a checkout page.");
    res.redirect(302, approve.href);
  } catch (e) {
    console.error(e);
    fail("Checkout is temporarily unavailable.");
  }
});

export const payReturn = onRequest({ secrets: [CREDENTIALS_ENCRYPTION_KEY], maxInstances: 20 }, async (req, res) => {
  const base = APP_BASE_URL.value().replace(/\/$/, "");
  try {
    const orgId = String(req.query.org ?? ""), linkId = String(req.query.link ?? ""), orderId = String(req.query.token ?? "");
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(orgId) || !ID.test(linkId) || !/^[A-Z0-9]{5,40}$/.test(orderId)) throw new Error("bad params");
    const ref = orgCol(orgId, "paymentLinks").doc(linkId);
    const l = (await ref.get()).data() as PaymentLink;
    let order: any;
    try {
      order = await paypal(orgId, l.environment!, `/v2/checkout/orders/${orderId}/capture`, { method: "POST", requestId: `cap-${orderId}` });
    } catch (e) {
      if (e instanceof PayPalApiError && e.issue === "ORDER_ALREADY_CAPTURED") order = await paypal(orgId, l.environment!, `/v2/checkout/orders/${orderId}`);
      else throw e;
    }
    const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
    if (order.purchase_units?.[0]?.custom_id && order.purchase_units[0].custom_id !== `pl:${linkId}`) throw new Error("order/link mismatch");
    if (cap?.status === "COMPLETED") {
      const gross = toMinorStr(cap.amount.value, cap.amount.currency_code);
      const fee = toMinorStr(cap.seller_receivable_breakdown?.paypal_fee?.value ?? "0", cap.amount.currency_code);
      const payer = order.payer ?? {};
      await upsertTransactions(orgId, l.environment!, [{ source: "paypal", externalId: cap.id, type: "payment", status: "completed", date: cap.create_time ?? nowIso(), description: l.description, customerId: l.customerId, customerName: [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(" ") || l.customerName || "PayPal payer", customerEmail: payer.email_address, currency: cap.amount.currency_code, gross, fee, net: gross - fee, paymentMethod: "paypal", refundedAmount: 0, refunds: [], paymentLinkId: linkId, archivedAt: null }]);
      await ref.update({ status: "paid", paidTransactionId: txDocId(cap.id), activity: [...l.activity, { at: nowIso(), event: "Paid", detail: `Capture ${cap.id}` }], updatedAt: nowIso() });
      res.redirect(302, `${base}/pay/return?status=success`);
      return;
    }
    res.redirect(302, `${base}/pay/return?status=pending&message=${encodeURIComponent("Your payment is pending with PayPal.")}`);
  } catch (e) {
    console.error(e);
    res.redirect(302, `${base}/pay/return?status=error`);
  }
});
