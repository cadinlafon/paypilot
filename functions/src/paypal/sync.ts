import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import type { Invoice, Organization, PayPalEnvironment, SyncRun, Transaction, TransactionStatus } from "../../../shared/types";
import { CREDENTIALS_ENCRYPTION_KEY } from "../lib/params";
import { db, orgCol, orgRef, nowIso } from "../lib/admin";
import { requireMember, rateLimit, safeError } from "../lib/guard";
import { remaining, rotate, saveCursor } from "../lib/budget";
import { audit, notify } from "../lib/audit";
import { activeEnvironment, connectionRef, paypal, toMinorStr, PayPalApiError } from "./client";
import { customerResolver, upsertTransactions } from "./records";
import { computeInvoiceTotals } from "../../../shared/money";

const INTERVAL_MIN: Record<string, number> = { "15m": 15, "30m": 30, "1h": 60, "6h": 360, "24h": 1440 };
const STATUS: Record<string, TransactionStatus> = { S: "completed", P: "pending", D: "denied", V: "refunded", F: "failed" };

interface SearchTx {
  transaction_info: {
    transaction_id: string;
    paypal_reference_id?: string;
    transaction_event_code: string;
    transaction_initiation_date: string;
    transaction_amount: { currency_code: string; value: string };
    fee_amount?: { currency_code: string; value: string };
    transaction_status: string;
    transaction_subject?: string;
    invoice_id?: string;
    custom_field?: string;
  };
  payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string; given_name?: string; surname?: string } };
  cart_info?: { item_details?: { item_name?: string }[] };
}

/** Pull Transaction Search history in ≤31-day windows. PayPal indexes new activity with up to ~3h delay; webhooks cover the gap. */
async function syncTransactions(orgId: string, env: PayPalEnvironment, sinceIso: string): Promise<{ fetched: number; upserted: number }> {
  const end = new Date();
  let start = new Date(sinceIso);
  let fetched = 0;
  const payments: Omit<Transaction, "id" | "orgId" | "createdAt" | "updatedAt" | "reporting">[] = [];
  const refunds: SearchTx[] = [];
  const customers = await customerResolver(orgId);
  while (start < end) {
    const windowEnd = new Date(Math.min(start.getTime() + 30 * 86400000, end.getTime()));
    for (let page = 1; page <= 50; page++) {
      const r = await paypal<{ transaction_details: SearchTx[]; total_pages: number }>(orgId, env, "/v1/reporting/transactions", {
        query: { start_date: start.toISOString(), end_date: windowEnd.toISOString(), fields: "transaction_info,payer_info,cart_info", page_size: 500, page },
      });
      for (const d of r.transaction_details ?? []) {
        fetched++;
        const ti = d.transaction_info;
        const value = Number(ti.transaction_amount.value);
        const code = ti.transaction_event_code;
        const currency = ti.transaction_amount.currency_code;
        if (code.startsWith("T11")) {
          refunds.push(d);
          continue;
        }
        if (code.startsWith("T04") || code.startsWith("T02") || code.startsWith("T03")) continue; // transfers/withdrawals/currency conversions — not revenue or expenses
        const name = d.payer_info?.payer_name?.alternate_full_name ?? [d.payer_info?.payer_name?.given_name, d.payer_info?.payer_name?.surname].filter(Boolean).join(" ");
        const email = d.payer_info?.email_address;
        const gross = Math.abs(toMinorStr(ti.transaction_amount.value, currency));
        const fee = Math.abs(toMinorStr(ti.fee_amount?.value ?? "0", currency));
        const customerId = value > 0 ? customers.resolve(email, name) : undefined;
        payments.push({
          source: "paypal",
          externalId: ti.transaction_id,
          type: value < 0 ? "purchase" : code === "T0002" ? "subscription_payment" : "payment",
          status: STATUS[ti.transaction_status] ?? "pending",
          date: new Date(ti.transaction_initiation_date).toISOString(),
          description: ti.transaction_subject ?? d.cart_info?.item_details?.[0]?.item_name ?? (value < 0 ? "PayPal purchase" : "PayPal payment"),
          customerId,
          customerName: name || email || "PayPal payer",
          customerEmail: email,
          currency,
          gross,
          fee,
          net: gross - fee,
          paymentMethod: "paypal",
          refundedAmount: 0,
          refunds: [],
          archivedAt: null,
        });
      }
      if (page >= (r.total_pages ?? 1)) break;
    }
    start = windowEnd;
  }
  await customers.flush();
  const upserted = await upsertTransactions(orgId, env, payments);
  // Attach refunds to their original transactions: one batched read, one batched write.
  const byOrig = new Map<string, SearchTx[]>();
  for (const r of refunds) {
    const orig = r.transaction_info.paypal_reference_id;
    if (orig) byOrig.set(orig, [...(byOrig.get(orig) ?? []), r]);
  }
  const refs = [...byOrig.keys()].map((o) => orgCol(orgId, "transactions").doc(`pp_${o.replace(/[^A-Za-z0-9_-]/g, "")}`));
  const batch = db.batch();
  let writes = 0;
  for (let i = 0; i < refs.length; i += 300) {
    const snaps = await db.getAll(...refs.slice(i, i + 300));
    for (const s of snaps) {
      if (!s.exists) continue;
      const t = s.data() as Transaction;
      const orig = (t.externalId ?? "");
      let list = [...t.refunds];
      for (const r of byOrig.get(orig) ?? []) {
        if (list.some((x) => x.externalId === r.transaction_info.transaction_id)) continue;
        list.push({ id: r.transaction_info.transaction_id, externalId: r.transaction_info.transaction_id, amount: Math.abs(toMinorStr(r.transaction_info.transaction_amount.value, r.transaction_info.transaction_amount.currency_code)), date: new Date(r.transaction_info.transaction_initiation_date).toISOString() });
      }
      if (list.length === t.refunds.length) continue;
      const refunded = list.reduce((a, x) => a + x.amount, 0);
      batch.update(s.ref, { refunds: list, refundedAmount: refunded, status: refunded >= t.gross ? "refunded" : "partially_refunded", updatedAt: nowIso() });
      writes++;
    }
  }
  if (writes) await batch.commit();
  return { fetched, upserted };
}

/** Pull PayPal invoices created outside PayPilot. */
async function syncInvoices(orgId: string, env: PayPalEnvironment): Promise<number> {
  let n = 0;
  const customers = await customerResolver(orgId);
  const existing = await orgCol(orgId, "invoices").where("source", "==", "paypal").limit(3000).get();
  const byExt = new Map(existing.docs.map((d) => [String(d.data().externalId ?? ""), d.ref]));
  const batch = db.batch();
  const STATUS_MAP: Record<string, Invoice["status"]> = { DRAFT: "draft", SENT: "sent", SCHEDULED: "sent", PAID: "paid", MARKED_AS_PAID: "paid", PARTIALLY_PAID: "partially_paid", MARKED_AS_PARTIALLY_PAID: "partially_paid", CANCELLED: "cancelled", REFUNDED: "cancelled", PAYMENT_PENDING: "sent", UNPAID: "sent" };
  for (let page = 1; page <= 20; page++) {
    const r = await paypal<{ items?: any[]; total_pages?: number }>(orgId, env, "/v2/invoicing/invoices", { query: { page, page_size: 100, total_required: "true" } });
    for (const it of r.items ?? []) {
      const target = byExt.get(it.id) ?? orgCol(orgId, "invoices").doc(`pp_${it.id}`);
      const cur = it.amount?.currency_code ?? "USD";
      const total = toMinorStr(it.amount?.value ?? "0", cur);
      const paid = toMinorStr(it.payments?.paid_amount?.value ?? "0", cur);
      const recip = it.primary_recipients?.[0]?.billing_info ?? {};
      const email = recip.email_address ?? "";
      const name = [recip.name?.given_name, recip.name?.surname].filter(Boolean).join(" ") || email;
      const customerId = customers.resolve(email, name) ?? "";
      const now = nowIso();
      const lines = [{ id: "l1", description: it.detail?.memo || "PayPal invoice", quantity: 1, unitPrice: total, taxRate: 0 }];
      const base = { lines, discount: { type: "fixed" as const, value: 0 }, payments: paid ? [{ id: "paypal", amount: paid, date: now, method: "PayPal" }] : [] };
      batch.set(
        target,
        {
          orgId, source: "paypal", environment: env, externalId: it.id, number: it.detail?.invoice_number ?? it.id, customerId, customerName: name, customerEmail: email,
          status: STATUS_MAP[it.status] ?? "sent", issueDate: it.detail?.invoice_date ?? now.slice(0, 10), dueDate: it.detail?.payment_term?.due_date ?? it.detail?.invoice_date ?? now.slice(0, 10),
          currency: cur, ...base, totals: computeInvoiceTotals(base), notes: it.detail?.note ?? "", terms: it.detail?.payment_term?.term_type ?? "", paymentTermsDays: 0,
          history: [{ at: now, event: "Synced from PayPal", by: "PayPal" }], attachmentIds: [], updatedAt: now, createdAt: now, archivedAt: null,
        },
        { merge: true },
      );
      n++;
    }
    if (page >= (r.total_pages ?? 1)) break;
  }
  await customers.flush();
  if (n) await batch.commit();
  return n;
}

export async function runSync(orgId: string, kind: SyncRun["kind"]): Promise<SyncRun> {
  const env = await activeEnvironment(orgId);
  if (!env) throw new HttpsError("failed-precondition", "PayPal isn't connected.");
  const conn = (await connectionRef(orgId, env).get()).data()!;
  const runRef = orgCol(orgId, "syncHistory").doc();
  const run: SyncRun = { id: runRef.id, orgId, kind, environment: env, startedAt: nowIso(), status: "running", itemsFetched: 0, itemsUpserted: 0 };
  await runRef.set(run);
  await connectionRef(orgId, env).update({ lastSyncStatus: "running" });
  try {
    const since = kind === "reconciliation" || !conn.lastSyncAt ? new Date(Date.now() - 90 * 86400000).toISOString() : new Date(Date.parse(conn.lastSyncAt) - 6 * 3600000).toISOString(); // overlap for indexing delay
    let fetched = 0, upserted = 0;
    if (conn.capabilities?.transactions !== false) {
      const r = await syncTransactions(orgId, env, since);
      fetched += r.fetched;
      upserted += r.upserted;
    }
    if (conn.capabilities?.invoicing) upserted += await syncInvoices(orgId, env).catch((e) => (console.warn("invoice sync", e), 0));
    Object.assign(run, { status: "success", finishedAt: nowIso(), itemsFetched: fetched, itemsUpserted: upserted });
    await runRef.set(run);
    await connectionRef(orgId, env).update({ lastSyncAt: run.finishedAt, lastSyncStatus: "success", lastSyncError: null });
    return run;
  } catch (e) {
    const msg = e instanceof PayPalApiError ? (e.status === 403 ? "PayPal denied access — enable Transaction Search for this app." : e.message) : (e as Error).message;
    Object.assign(run, { status: "failed", finishedAt: nowIso(), error: msg.slice(0, 300) });
    await runRef.set(run);
    await connectionRef(orgId, env).update({ lastSyncStatus: "failed", lastSyncError: run.error });
    const org = (await orgRef(orgId).get()).data() as Organization;
    await notify(orgId, { category: "integration", severity: "error", title: "PayPal sync failed", body: run.error ?? "Unknown error", link: "/integrations" }, org.settings.notifications.categories);
    return run;
  }
}

export const paypalSyncNow = onCall({ secrets: [CREDENTIALS_ENCRYPTION_KEY], timeoutSeconds: 540, memory: "512MiB" }, async (req) => {
  try {
    const c = await requireMember(req, "transactions.view");
    await rateLimit(`sync_${c.orgId}`, 6, 600);
    const kind = req.data?.kind === "reconciliation" ? "reconciliation" : "manual";
    const run = await runSync(c.orgId, kind);
    await audit(c.orgId, c.email, `${kind === "manual" ? "Manual" : "Reconciliation"} sync`, run.status, `${run.itemsUpserted} records`);
    return { ok: run.status === "success", message: run.status === "success" ? `Synced ${run.itemsUpserted} record(s) from PayPal ${run.environment}.` : `Sync failed: ${run.error}` };
  } catch (e) {
    throw safeError(e, "Sync failed.");
  }
});

/** Runs every 15 minutes; syncs each org whose configured interval has elapsed. */
export const paypalScheduledSync = onSchedule({ schedule: "every 15 minutes", secrets: [CREDENTIALS_ENCRYPTION_KEY], timeoutSeconds: 540, memory: "512MiB" }, async () => {
  const conns = await db.collectionGroup("paypalConnections").where("status", "==", "connected").get();
  const byOrg = new Map(conns.docs.map((c) => [c.ref.parent.parent!.id, c]));
  for (const orgId of await rotate("sync", [...byOrg.keys()])) {
    if (remaining() < 25) break;
    const c = byOrg.get(orgId)!;
    await saveCursor("sync", orgId);
    const org = (await orgRef(orgId).get()).data() as Organization | undefined;
    const every = INTERVAL_MIN[org?.settings.syncInterval ?? "1h"];
    if (!org || !every) continue; // manual-only
    const last = c.data().lastSyncAt ? Date.parse(c.data().lastSyncAt) : 0;
    if (Date.now() - last < every * 60000 - 60000) continue;
    await runSync(orgId, "scheduled").catch((e) => console.error("scheduled sync", orgId, e));
  }
});

/** Nightly 90-day reconciliation catches anything missed by webhooks or incremental sync. */
export const paypalNightlyReconciliation = onSchedule({ schedule: "every day 03:30", secrets: [CREDENTIALS_ENCRYPTION_KEY], timeoutSeconds: 540, memory: "512MiB" }, async () => {
  const conns = await db.collectionGroup("paypalConnections").where("status", "==", "connected").get();
  for (const orgId of await rotate("reconcile", conns.docs.map((c) => c.ref.parent.parent!.id))) {
    if (remaining() < 25) break;
    await saveCursor("reconcile", orgId);
    await runSync(orgId, "reconciliation").catch((e) => console.error("reconcile", e));
  }
});
