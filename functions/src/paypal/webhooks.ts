/**
 * PayPal webhook receiver.
 *  - Every event is signature-verified with PayPal before anything is trusted.
 *  - Organization association comes from the per-org webhook URL AND must match
 *    the webhook ID stored for that org (an event for org A can't be replayed to org B).
 *  - Deduplicated by PayPal event ID; failures return 500 so PayPal retries, and
 *    a scheduled job re-processes failed events.
 */
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import type { Organization, PayPalEnvironment, Subscription, Transaction, WebhookEventRecord, Invoice } from "../../../shared/types";
import { CREDENTIALS_ENCRYPTION_KEY } from "../lib/params";
import { db, orgCol, orgRef, nowIso } from "../lib/admin";
import { notify } from "../lib/audit";
import { loadCredentials, paypal, toMinorStr } from "./client";
import { findOrCreateCustomer, txDocId, upsertTransactions } from "./records";
import { computeInvoiceTotals, deriveInvoiceStatus } from "../../../shared/money";
import { todayKey } from "../../../shared/dates";

async function verify(orgId: string, env: PayPalEnvironment, headers: Record<string, string | string[] | undefined>, event: unknown): Promise<boolean> {
  const cred = await loadCredentials(orgId, env);
  if (!cred.webhookId) return false;
  const h = (k: string) => String(headers[k] ?? "");
  if (!h("paypal-transmission-id") || !h("paypal-transmission-sig")) return false;
  const r = await paypal<{ verification_status: string }>(orgId, env, "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: cred.webhookId,
      webhook_event: event,
    },
  });
  return r.verification_status === "SUCCESS";
}

export async function processEvent(orgId: string, env: PayPalEnvironment, ev: any) {
  const r = ev.resource ?? {};
  const org = (await orgRef(orgId).get()).data() as Organization;
  const prefs = org.settings.notifications.categories;
  switch (ev.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED":
    case "PAYMENT.CAPTURE.PENDING":
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED": {
      const cur = r.amount.currency_code;
      const gross = toMinorStr(r.amount.value, cur);
      const fee = toMinorStr(r.seller_receivable_breakdown?.paypal_fee?.value ?? "0", cur);
      const custom = String(r.custom_id ?? "");
      const payer = ev.resource?.payer ?? {};
      const email = payer.email_address;
      const name = [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(" ");
      const status: Transaction["status"] = ev.event_type.endsWith("COMPLETED") ? "completed" : ev.event_type.endsWith("PENDING") ? "pending" : ev.event_type.endsWith("DENIED") ? "denied" : "failed";
      await upsertTransactions(orgId, env, [
        {
          source: "paypal", externalId: r.id, type: "payment", status, date: r.create_time ?? nowIso(), description: custom.startsWith("pl:") ? "Payment link" : "PayPal checkout",
          customerId: await findOrCreateCustomer(orgId, email, name), customerName: name || email || "PayPal payer", customerEmail: email, currency: cur, gross, fee, net: gross - fee,
          paymentMethod: "paypal", refundedAmount: 0, refunds: [], paymentLinkId: custom.startsWith("pl:") ? custom.slice(3) : undefined,
          failureReason: status === "failed" || status === "denied" ? r.status_details?.reason ?? ev.summary : undefined, archivedAt: null,
        },
      ]);
      if (custom.startsWith("pl:") && status === "completed") {
        const link = orgCol(orgId, "paymentLinks").doc(custom.slice(3));
        const s = await link.get();
        if (s.exists) await link.update({ status: "paid", paidTransactionId: txDocId(r.id), activity: [...(s.data()!.activity ?? []), { at: nowIso(), event: "Paid", detail: `PayPal capture ${r.id}` }], updatedAt: nowIso() });
      }
      return;
    }
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED": {
      const up = (r.links ?? []).find((l: any) => l.rel === "up")?.href as string | undefined;
      const captureId = up?.split("/").pop();
      if (!captureId) return;
      const ref = orgCol(orgId, "transactions").doc(txDocId(captureId));
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) return;
        const t = s.data() as Transaction;
        if (t.refunds.some((x) => x.externalId === r.id)) return;
        const amount = toMinorStr(r.amount?.value ?? "0", r.amount?.currency_code ?? t.currency);
        const refunded = t.refundedAmount + amount;
        tx.update(ref, { refunds: [...t.refunds, { id: r.id, externalId: r.id, amount, date: r.create_time ?? nowIso(), reason: r.note_to_payer }], refundedAmount: refunded, status: refunded >= t.gross ? "refunded" : "partially_refunded", updatedAt: nowIso() });
      });
      return;
    }
    case "PAYMENT.AUTHORIZATION.CREATED": {
      const cur = r.amount.currency_code;
      const gross = toMinorStr(r.amount.value, cur);
      await upsertTransactions(orgId, env, [{ source: "paypal", externalId: r.id, type: "authorization", status: "authorized", date: r.create_time ?? nowIso(), description: "Authorized payment", customerName: "PayPal payer", currency: cur, gross, fee: 0, net: gross, paymentMethod: "paypal", refundedAmount: 0, refunds: [], authorizationExpiresAt: r.expiration_time, archivedAt: null }]);
      return;
    }
    case "PAYMENT.AUTHORIZATION.VOIDED":
      await orgCol(orgId, "transactions").doc(txDocId(r.id)).set({ status: "voided", updatedAt: nowIso() }, { merge: true });
      return;
    case "PAYMENT.SALE.COMPLETED": {
      const cur = r.amount.currency;
      const gross = toMinorStr(r.amount.total, cur);
      const fee = toMinorStr(r.transaction_fee?.value ?? "0", cur);
      const subId = r.billing_agreement_id as string | undefined;
      const sub = subId ? (await orgCol(orgId, "subscriptions").doc(`pp_${subId}`).get()).data() as Subscription | undefined : undefined;
      await upsertTransactions(orgId, env, [{ source: "paypal", externalId: r.id, type: subId ? "subscription_payment" : "payment", status: "completed", date: r.create_time ?? nowIso(), description: sub ? `${sub.productName} — subscription` : "PayPal payment", customerId: sub?.customerId, customerName: sub?.customerName ?? "PayPal payer", currency: cur, gross, fee, net: gross - fee, paymentMethod: "paypal", refundedAmount: 0, refunds: [], subscriptionId: sub ? `pp_${subId}` : undefined, archivedAt: null }]);
      if (sub) await orgCol(orgId, "subscriptions").doc(`pp_${subId}`).update({ paymentHistory: [...sub.paymentHistory, { date: (r.create_time ?? nowIso()).slice(0, 10), amount: gross, status: "paid", transactionId: txDocId(r.id) }].slice(-60), updatedAt: nowIso() });
      return;
    }
    case "INVOICING.INVOICE.PAID":
    case "INVOICING.INVOICE.CANCELLED": {
      const inv = r.invoice ?? r;
      const q = await orgCol(orgId, "invoices").where("externalId", "==", inv.id).limit(1).get();
      if (q.empty) return;
      const doc = q.docs[0];
      const cur = doc.data() as Invoice;
      if (ev.event_type.endsWith("CANCELLED")) {
        await doc.ref.update({ status: "cancelled", history: [...cur.history, { at: nowIso(), event: "Cancelled in PayPal", by: "PayPal" }], updatedAt: nowIso() });
        return;
      }
      const paid = toMinorStr(inv.payments?.paid_amount?.value ?? inv.amount?.value ?? "0", cur.currency);
      const payments = [{ id: `pp_${inv.id}`, amount: paid, date: nowIso(), method: "PayPal" }];
      const totals = computeInvoiceTotals({ ...cur, payments });
      await doc.ref.update({ payments, totals, status: deriveInvoiceStatus({ ...cur, totals, status: "sent" }, todayKey(org.timezone)), history: [...cur.history, { at: nowIso(), event: "Paid via PayPal", by: "PayPal" }], updatedAt: nowIso() });
      await notify(orgId, { category: "invoice", severity: "success", title: `Invoice ${cur.number} paid`, body: cur.customerName, link: `/invoices?open=${doc.id}` }, prefs);
      return;
    }
    default:
      if (String(ev.event_type).startsWith("BILLING.SUBSCRIPTION.")) {
        // Fetch the authoritative subscription record — only what PayPal reports is stored.
        const s = await paypal<any>(orgId, env, `/v1/billing/subscriptions/${encodeURIComponent(r.id)}`);
        const plan = await paypal<any>(orgId, env, `/v1/billing/plans/${encodeURIComponent(s.plan_id)}`).catch(() => null);
        const cycle = plan?.billing_cycles?.find((c: any) => c.tenure_type === "REGULAR");
        const amount = cycle?.pricing_scheme?.fixed_price;
        const unit = String(cycle?.frequency?.interval_unit ?? "MONTH").toLowerCase();
        const STATUS: Record<string, Subscription["status"]> = { ACTIVE: "active", APPROVAL_PENDING: "trialing", APPROVED: "trialing", SUSPENDED: "paused", CANCELLED: "cancelled", EXPIRED: "cancelled" };
        const email = s.subscriber?.email_address;
        const name = [s.subscriber?.name?.given_name, s.subscriber?.name?.surname].filter(Boolean).join(" ");
        const ref = orgCol(orgId, "subscriptions").doc(`pp_${s.id}`);
        const prev = (await ref.get()).data() as Subscription | undefined;
        const failed = ev.event_type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED";
        await ref.set({
          orgId, source: "paypal", environment: env, externalId: s.id, customerId: (await findOrCreateCustomer(orgId, email, name)) ?? "", customerName: name || email || "Subscriber",
          productName: plan?.name ?? s.plan_id, amount: amount ? toMinorStr(amount.value, amount.currency_code) : 0, currency: amount?.currency_code ?? org.reportingCurrency,
          interval: unit === "week" ? "week" : unit === "year" ? "year" : "month", startDate: (s.start_time ?? nowIso()).slice(0, 10), nextBillingDate: (s.billing_info?.next_billing_time ?? s.start_time ?? nowIso()).slice(0, 10),
          status: failed ? "past_due" : STATUS[s.status] ?? "active", paymentHistory: prev?.paymentHistory ?? [], updatedAt: nowIso(), createdAt: prev?.createdAt ?? nowIso(), archivedAt: null,
        }, { merge: true });
        if (failed) await notify(orgId, { category: "payment_failed", severity: "error", title: "Subscription payment failed", body: name || email || s.id, link: "/subscriptions" }, prefs);
      }
  }
}

export const paypalWebhook = onRequest({ secrets: [CREDENTIALS_ENCRYPTION_KEY], cors: false, maxInstances: 20 }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  const orgId = String(req.query.org ?? "");
  const env = req.query.env === "live" ? "live" : "sandbox";
  const ev = req.body;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(orgId) || !ev?.id || !ev?.event_type) {
    res.status(400).send("Bad request");
    return;
  }
  let verified = false;
  try {
    verified = await verify(orgId, env, req.headers, ev);
  } catch (e) {
    console.error("verify error", e);
  }
  if (!verified) {
    // Never process or store unverified payloads beyond a minimal security log.
    console.warn("Rejected unverified webhook", { orgId, env, id: ev.id, type: ev.event_type });
    res.status(401).send("Signature verification failed");
    return;
  }
  const ref = orgCol(orgId, "webhookEvents").doc(String(ev.id).replace(/[^A-Za-z0-9_-]/g, ""));
  const existing = await ref.get();
  if (existing.exists && (existing.data() as WebhookEventRecord).status !== "failed") {
    res.status(200).send("Duplicate");
    return;
  }
  const rec: WebhookEventRecord = { id: ref.id, orgId, environment: env, eventType: ev.event_type, resourceType: ev.resource_type ?? "", resourceId: ev.resource?.id, receivedAt: nowIso(), verified: true, status: "processed", attempts: ((existing.data() as WebhookEventRecord | undefined)?.attempts ?? 0) + 1 };
  try {
    await processEvent(orgId, env, ev);
    await ref.set({ ...rec, payload: JSON.stringify(ev).slice(0, 50_000) });
    res.status(200).send("OK");
  } catch (e) {
    console.error("webhook processing failed", e);
    await ref.set({ ...rec, status: "failed", error: (e as Error).message.slice(0, 300), payload: JSON.stringify(ev).slice(0, 50_000) });
    res.status(500).send("Processing failed"); // PayPal will retry
  }
});

/** Re-process failed (already verified) webhook events with backoff; alerts after repeated failure. */
export const retryFailedWebhooks = onSchedule({ schedule: "every 30 minutes", secrets: [CREDENTIALS_ENCRYPTION_KEY] }, async () => {
  const failed = await db.collectionGroup("webhookEvents").where("status", "==", "failed").limit(100).get();
  for (const d of failed.docs) {
    const rec = d.data() as WebhookEventRecord & { payload?: string };
    if (rec.attempts >= 8 || !rec.payload) continue;
    try {
      await processEvent(rec.orgId, rec.environment, JSON.parse(rec.payload));
      await d.ref.update({ status: "processed", attempts: rec.attempts + 1, error: null });
    } catch (e) {
      await d.ref.update({ attempts: rec.attempts + 1, error: (e as Error).message.slice(0, 300) });
      if (rec.attempts + 1 >= 8) {
        const org = (await orgRef(rec.orgId).get()).data() as Organization;
        await notify(rec.orgId, { category: "integration", severity: "error", title: "Webhook event failed permanently", body: `${rec.eventType} (${rec.id}) could not be processed after 8 attempts.`, link: "/integrations" }, org.settings.notifications.categories);
      }
    }
  }
});
