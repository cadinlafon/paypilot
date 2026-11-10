import type { CurrencyCode, Dataset, Transaction } from "./types";
import { expenseReporting, txReporting } from "./money";
import { addDays, bucketKey, bucketLabel, dateKey, diffDays, enumerateBuckets, pickGranularity, todayKey, type DateRange, type Granularity } from "./dates";

/** Statuses representing money that actually arrived (possibly later refunded). */
const SETTLED = new Set(["completed", "refunded", "partially_refunded"]);
const REVENUE_TYPES = new Set(["payment", "subscription_payment"]);

export function linkedExpenseTxIds(ds: Dataset): Set<string> {
  return new Set(ds.expenses.filter((e) => !e.archivedAt && e.linkedTransactionId).map((e) => e.linkedTransactionId!));
}

export function txInRange(t: Transaction, r: DateRange, tz: string): boolean {
  const k = dateKey(t.date, tz);
  return k >= r.from && k <= r.to;
}

export function isRevenueTx(t: Transaction, linked: Set<string>): boolean {
  return REVENUE_TYPES.has(t.type) && SETTLED.has(t.status) && !linked.has(t.id) && !t.archivedAt;
}

export interface FinancialSummary {
  currency: CurrencyCode;
  grossReceipts: number;
  refunds: number;
  fees: number;
  netRevenue: number; // gross - refunds - fees
  expenses: number;
  netAfterExpenses: number;
  transactionCount: number;
  successfulCount: number;
  failedCount: number;
  successRate: number; // 0..1
  averageTransaction: number;
  /** Count of records whose reporting amount used an estimated/nearby rate. */
  estimatedConversions: number;
  /** Records excluded because no exchange rate was available. */
  unconverted: number;
}

export function summarize(ds: Dataset, r: DateRange, currency: CurrencyCode = ds.org.reportingCurrency): FinancialSummary {
  const tz = ds.org.timezone;
  const linked = linkedExpenseTxIds(ds);
  let gross = 0,
    refunds = 0,
    fees = 0,
    ok = 0,
    failed = 0,
    count = 0,
    est = 0,
    unconv = 0;
  for (const t of ds.transactions) {
    if (t.archivedAt || !txInRange(t, r, tz) || !REVENUE_TYPES.has(t.type) || linked.has(t.id)) continue;
    count++;
    if (t.status === "failed" || t.status === "denied") {
      failed++;
      continue;
    }
    if (!SETTLED.has(t.status)) continue;
    const rep = txReporting(t, currency);
    if (!rep.available) {
      unconv++;
      continue;
    }
    if (rep.estimated) est++;
    ok++;
    gross += rep.gross;
    fees += rep.fee;
    refunds += rep.refunded;
  }
  let expenses = 0;
  for (const e of ds.expenses) {
    if (e.archivedAt || e.date < r.from || e.date > r.to) continue;
    const rep = expenseReporting(e, currency);
    if (!rep.available) {
      unconv++;
      continue;
    }
    if (rep.estimated) est++;
    expenses += rep.amount;
  }
  const netRevenue = gross - refunds - fees;
  return {
    currency,
    grossReceipts: gross,
    refunds,
    fees,
    netRevenue,
    expenses,
    netAfterExpenses: netRevenue - expenses,
    transactionCount: count,
    successfulCount: ok,
    failedCount: failed,
    successRate: ok + failed > 0 ? ok / (ok + failed) : 0,
    averageTransaction: ok > 0 ? Math.round(gross / ok) : 0,
    estimatedConversions: est,
    unconverted: unconv,
  };
}

export interface SeriesPoint {
  bucket: string;
  label: string;
  gross: number;
  net: number;
  refunds: number;
  fees: number;
  expenses: number;
  count: number;
  failed: number;
}

export function timeSeries(ds: Dataset, r: DateRange, g: Granularity = pickGranularity(r.from, r.to), currency = ds.org.reportingCurrency): SeriesPoint[] {
  const tz = ds.org.timezone;
  const linked = linkedExpenseTxIds(ds);
  const map = new Map<string, SeriesPoint>();
  for (const b of enumerateBuckets(r.from, r.to, g)) {
    map.set(b, { bucket: b, label: bucketLabel(b, g), gross: 0, net: 0, refunds: 0, fees: 0, expenses: 0, count: 0, failed: 0 });
  }
  for (const t of ds.transactions) {
    if (t.archivedAt || !REVENUE_TYPES.has(t.type) || linked.has(t.id)) continue;
    const k = dateKey(t.date, tz);
    if (k < r.from || k > r.to) continue;
    const p = map.get(bucketKey(k, g));
    if (!p) continue;
    if (t.status === "failed" || t.status === "denied") {
      p.failed++;
      continue;
    }
    if (!SETTLED.has(t.status)) continue;
    const rep = txReporting(t, currency);
    if (!rep.available) continue;
    p.count++;
    p.gross += rep.gross;
    p.fees += rep.fee;
    p.refunds += rep.refunded;
    p.net += rep.gross - rep.fee - rep.refunded;
  }
  for (const e of ds.expenses) {
    if (e.archivedAt || e.date < r.from || e.date > r.to) continue;
    const p = map.get(bucketKey(e.date, g));
    const rep = expenseReporting(e, currency);
    if (p && rep.available) p.expenses += rep.amount;
  }
  return [...map.values()];
}

export function revenueByProduct(ds: Dataset, r: DateRange, currency = ds.org.reportingCurrency) {
  const tz = ds.org.timezone;
  const linked = linkedExpenseTxIds(ds);
  const names = new Map(ds.products.map((p) => [p.id, p.name]));
  const subs = new Map(ds.subscriptions.map((s) => [s.id, s]));
  const out = new Map<string, { id: string; name: string; gross: number; net: number; count: number }>();
  for (const t of ds.transactions) {
    if (!isRevenueTx(t, linked) || !txInRange(t, r, tz)) continue;
    const pid = t.productId ?? (t.subscriptionId ? subs.get(t.subscriptionId)?.productId : undefined) ?? "uncategorized";
    const rep = txReporting(t, currency);
    if (!rep.available) continue;
    const row = out.get(pid) ?? { id: pid, name: names.get(pid) ?? "Other / unassigned", gross: 0, net: 0, count: 0 };
    row.gross += rep.gross;
    row.net += rep.gross - rep.fee - rep.refunded;
    row.count++;
    out.set(pid, row);
  }
  return [...out.values()].sort((a, b) => b.gross - a.gross);
}

export function topCustomers(ds: Dataset, r: DateRange | null, limit = 5, currency = ds.org.reportingCurrency) {
  const tz = ds.org.timezone;
  const linked = linkedExpenseTxIds(ds);
  const out = new Map<string, { id: string; name: string; email?: string; total: number; count: number; lastDate: string }>();
  for (const t of ds.transactions) {
    if (!isRevenueTx(t, linked) || (r && !txInRange(t, r, tz))) continue;
    const id = t.customerId ?? t.customerEmail ?? t.customerName;
    const rep = txReporting(t, currency);
    if (!rep.available) continue;
    const row = out.get(id) ?? { id, name: t.customerName, email: t.customerEmail, total: 0, count: 0, lastDate: t.date };
    row.total += rep.gross - rep.refunded;
    row.count++;
    if (t.date > row.lastDate) row.lastDate = t.date;
    out.set(id, row);
  }
  return [...out.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export function customerLifetime(ds: Dataset, customerId: string, currency = ds.org.reportingCurrency) {
  const linked = linkedExpenseTxIds(ds);
  let total = 0,
    refunds = 0,
    count = 0;
  for (const t of ds.transactions) {
    if (t.customerId !== customerId || !isRevenueTx(t, linked)) continue;
    const rep = txReporting(t, currency);
    if (!rep.available) continue;
    total += rep.gross;
    refunds += rep.refunded;
    count++;
  }
  return { total, refunds, net: total - refunds, count };
}

export function byCurrency(ds: Dataset, r: DateRange) {
  const tz = ds.org.timezone;
  const linked = linkedExpenseTxIds(ds);
  const out = new Map<string, { currency: string; gross: number; count: number; reportingGross: number; estimated: number }>();
  for (const t of ds.transactions) {
    if (!isRevenueTx(t, linked) || !txInRange(t, r, tz)) continue;
    const row = out.get(t.currency) ?? { currency: t.currency, gross: 0, count: 0, reportingGross: 0, estimated: 0 };
    row.gross += t.gross;
    row.count++;
    const rep = txReporting(t, ds.org.reportingCurrency);
    row.reportingGross += rep.gross;
    if (rep.estimated) row.estimated++;
    out.set(t.currency, row);
  }
  return [...out.values()].sort((a, b) => b.reportingGross - a.reportingGross);
}

export function paymentMethodBreakdown(ds: Dataset, r: DateRange) {
  const tz = ds.org.timezone;
  const out = new Map<string, { method: string; count: number; failed: number }>();
  for (const t of ds.transactions) {
    if (!REVENUE_TYPES.has(t.type) || !txInRange(t, r, tz)) continue;
    const row = out.get(t.paymentMethod) ?? { method: t.paymentMethod, count: 0, failed: 0 };
    row.count++;
    if (t.status === "failed" || t.status === "denied") row.failed++;
    out.set(t.paymentMethod, row);
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}

export function invoiceCollection(ds: Dataset, r: DateRange | null) {
  const today = todayKey(ds.org.timezone);
  let issued = 0,
    collected = 0,
    outstanding = 0,
    overdue = 0,
    overdueCount = 0,
    count = 0;
  for (const inv of ds.invoices) {
    if (inv.archivedAt || inv.status === "draft" || inv.status === "cancelled") continue;
    if (r && (inv.issueDate < r.from || inv.issueDate > r.to)) continue;
    if (inv.currency !== ds.org.reportingCurrency) continue; // shown separately per currency
    count++;
    issued += inv.totals.total;
    collected += inv.totals.paid;
    outstanding += inv.totals.balance;
    if (inv.totals.balance > 0 && inv.dueDate < today) {
      overdue += inv.totals.balance;
      overdueCount++;
    }
  }
  return { count, issued, collected, outstanding, overdue, overdueCount, collectionRate: issued > 0 ? collected / issued : 0 };
}

export function expenseByCategory(ds: Dataset, r: DateRange, currency = ds.org.reportingCurrency) {
  const out = new Map<string, { category: string; amount: number; count: number; tax: number }>();
  for (const e of ds.expenses) {
    if (e.archivedAt || e.date < r.from || e.date > r.to) continue;
    const rep = expenseReporting(e, currency);
    if (!rep.available) continue;
    const row = out.get(e.category) ?? { category: e.category, amount: 0, count: 0, tax: 0 };
    row.amount += rep.amount;
    row.count++;
    row.tax += e.currency === currency ? e.taxAmount : 0;
    out.set(e.category, row);
  }
  return [...out.values()].sort((a, b) => b.amount - a.amount);
}

export function customerGrowth(ds: Dataset, r: DateRange, g: Granularity = pickGranularity(r.from, r.to)) {
  const tz = ds.org.timezone;
  const buckets = enumerateBuckets(r.from, r.to, g);
  const counts = new Map(buckets.map((b) => [b, 0]));
  let before = 0;
  for (const c of ds.customers) {
    if (c.archivedAt) continue;
    const k = dateKey(c.createdAt, tz);
    if (k < r.from) before++;
    else if (k <= r.to) {
      const b = bucketKey(k, g);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
  }
  let cum = before;
  return buckets.map((b) => {
    const n = counts.get(b) ?? 0;
    cum += n;
    return { bucket: b, label: bucketLabel(b, g), newCustomers: n, total: cum };
  });
}

export function upcomingRenewals(ds: Dataset, days = 14) {
  const today = todayKey(ds.org.timezone);
  const end = addDays(today, days);
  return ds.subscriptions
    .filter((s) => !s.archivedAt && (s.status === "active" || s.status === "trialing" || s.status === "past_due") && s.nextBillingDate >= today && s.nextBillingDate <= end)
    .sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate))
    .map((s) => ({ ...s, inDays: diffDays(s.nextBillingDate, today) }));
}

export function outstandingInvoices(ds: Dataset) {
  const today = todayKey(ds.org.timezone);
  return ds.invoices
    .filter((i) => !i.archivedAt && i.status !== "draft" && i.status !== "cancelled" && i.totals.balance > 0)
    .map((i) => ({ ...i, daysOverdue: Math.max(0, diffDays(today, i.dueDate)) }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.totals.balance - a.totals.balance);
}

export interface Anomaly {
  transactionId: string;
  reason: string;
  severity: "low" | "medium" | "high";
}

/**
 * Flags patterns for HUMAN REVIEW — never an accusation of fraud.
 * Heuristics: amount far above the norm, repeated failures by one payer,
 * rapid duplicate charges, and refunds shortly after payment.
 */
export function detectAnomalies(ds: Dataset, r: DateRange): Anomaly[] {
  const tz = ds.org.timezone;
  const rc = ds.org.reportingCurrency;
  const txs = ds.transactions.filter((t) => !t.archivedAt && REVENUE_TYPES.has(t.type) && txInRange(t, r, tz));
  const amounts = txs.filter((t) => SETTLED.has(t.status)).map((t) => txReporting(t, rc).gross).filter((x) => x > 0);
  const out: Anomaly[] = [];
  if (amounts.length >= 8) {
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const sd = Math.sqrt(amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length);
    for (const t of txs) {
      const g = txReporting(t, rc).gross;
      if (sd > 0 && g > mean + 3 * sd) out.push({ transactionId: t.id, reason: `Amount is ${((g - mean) / sd).toFixed(1)}σ above the period average`, severity: "medium" });
    }
  }
  const failsByPayer = new Map<string, Transaction[]>();
  for (const t of txs) if (t.status === "failed" || t.status === "denied") failsByPayer.set(t.customerEmail ?? t.customerName, [...(failsByPayer.get(t.customerEmail ?? t.customerName) ?? []), t]);
  for (const [payer, list] of failsByPayer) if (list.length >= 3) out.push({ transactionId: list[list.length - 1].id, reason: `${list.length} failed payment attempts from ${payer}`, severity: "high" });
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1],
      b = sorted[i];
    if (a.customerEmail && a.customerEmail === b.customerEmail && a.gross === b.gross && a.currency === b.currency && Date.parse(b.date) - Date.parse(a.date) < 10 * 60000)
      out.push({ transactionId: b.id, reason: `Possible duplicate charge — same payer and amount within 10 minutes`, severity: "medium" });
  }
  for (const t of txs) {
    const first = t.refunds[0];
    if (first && Date.parse(first.date) - Date.parse(t.date) < 86400000 && t.refundedAmount >= t.gross) out.push({ transactionId: t.id, reason: "Fully refunded within 24 hours of payment", severity: "low" });
  }
  return out;
}

export function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return (cur - prev) / Math.abs(prev);
}

/**
 * View a dataset in ONE original currency (no conversion): keeps only records
 * in that currency and treats it as the reporting currency for calculations.
 */
export function restrictToCurrency(ds: Dataset, currency: string): Dataset {
  if (currency === "all") return ds;
  return {
    ...ds,
    org: { ...ds.org, reportingCurrency: currency },
    transactions: ds.transactions.filter((t) => t.currency === currency),
    expenses: ds.expenses.filter((e) => e.currency === currency),
    invoices: ds.invoices.filter((i) => i.currency === currency),
    subscriptions: ds.subscriptions.filter((s) => s.currency === currency),
  };
}

export function currenciesIn(ds: Dataset): string[] {
  return [...new Set([...ds.transactions.map((t) => t.currency), ...ds.expenses.map((e) => e.currency)])].sort();
}
