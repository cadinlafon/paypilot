import type { ConvertedAmount, CurrencyCode, Expense, Invoice, InvoiceLine, InvoiceTotals, Transaction } from "./types";

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD"]);

export const SUPPORTED_CURRENCIES: { code: CurrencyCode; name: string }[] = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "MXN", name: "Mexican Peso" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "BRL", name: "Brazilian Real" },
];

export function currencyExponent(currency: CurrencyCode): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

export function toMinor(major: number, currency: CurrencyCode): number {
  const f = 10 ** currencyExponent(currency);
  return Math.round(major * f);
}

export function toMajor(minor: number, currency: CurrencyCode): number {
  return minor / 10 ** currencyExponent(currency);
}

/** Parse a user-entered decimal string ("1,234.50") into minor units. Returns NaN when invalid. */
export function parseMoneyInput(input: string, currency: CurrencyCode): number {
  const clean = input.replace(/[\s,]/g, "");
  if (!/^-?\d*(\.\d*)?$/.test(clean) || clean === "" || clean === "-" || clean === ".") return NaN;
  return toMinor(Number(clean), currency);
}

const fmtCache = new Map<string, Intl.NumberFormat>();
export function formatMoney(minor: number, currency: CurrencyCode, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const key = `${currency}|${opts.compact}|${opts.sign}`;
  let f = fmtCache.get(key);
  if (!f) {
    const exp = currencyExponent(currency);
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: opts.compact ? "compact" : "standard",
      minimumFractionDigits: opts.compact ? 0 : exp,
      maximumFractionDigits: opts.compact ? 1 : exp,
      signDisplay: opts.sign ? "exceptZero" : "auto",
    });
    fmtCache.set(key, f);
  }
  return f.format(toMajor(minor, currency));
}

/**
 * Convert minor units between currencies given a rate quoted as
 * 1 unit of `from` = `rate` units of `to`. Handles differing exponents.
 */
export function convertMinor(minor: number, from: CurrencyCode, to: CurrencyCode, rate: number): number {
  if (from === to) return minor;
  return toMinor(toMajor(minor, from) * rate, to);
}

export interface RateLookup {
  /** Rate for 1 `from` in `to` on `date` (YYYY-MM-DD). */
  (from: CurrencyCode, to: CurrencyCode, date: string): { rate: number; date: string; provider: string; estimated: boolean } | null;
}

export function buildReporting(
  t: Pick<Transaction, "currency" | "gross" | "fee" | "net" | "date">,
  reportingCurrency: CurrencyCode,
  lookup: RateLookup,
): ConvertedAmount | undefined {
  if (t.currency === reportingCurrency) {
    return { currency: reportingCurrency, gross: t.gross, fee: t.fee, net: t.net, rate: 1, rateTimestamp: t.date, provider: "identity", estimated: false };
  }
  const r = lookup(t.currency, reportingCurrency, t.date.slice(0, 10));
  if (!r) return undefined;
  return {
    currency: reportingCurrency,
    gross: convertMinor(t.gross, t.currency, reportingCurrency, r.rate),
    fee: convertMinor(t.fee, t.currency, reportingCurrency, r.rate),
    net: convertMinor(t.net, t.currency, reportingCurrency, r.rate),
    rate: r.rate,
    rateTimestamp: r.date,
    provider: r.provider,
    estimated: r.estimated,
  };
}

/** Reporting-currency amounts for a transaction; falls back to original when the currencies already match. */
export function txReporting(t: Transaction, reportingCurrency: CurrencyCode): { gross: number; fee: number; net: number; refunded: number; estimated: boolean; available: boolean } {
  if (t.currency === reportingCurrency) return { gross: t.gross, fee: t.fee, net: t.net, refunded: t.refundedAmount, estimated: false, available: true };
  if (t.reporting && t.reporting.currency === reportingCurrency) {
    return {
      gross: t.reporting.gross,
      fee: t.reporting.fee,
      net: t.reporting.net,
      refunded: convertMinor(t.refundedAmount, t.currency, reportingCurrency, t.reporting.rate),
      estimated: t.reporting.estimated,
      available: true,
    };
  }
  return { gross: 0, fee: 0, net: 0, refunded: 0, estimated: true, available: false };
}

export function expenseReporting(e: Expense, reportingCurrency: CurrencyCode): { amount: number; estimated: boolean; available: boolean } {
  if (e.currency === reportingCurrency) return { amount: e.amount, estimated: false, available: true };
  if (e.reporting && e.reporting.currency === reportingCurrency) return { amount: e.reporting.amount, estimated: e.reporting.estimated, available: true };
  return { amount: 0, estimated: true, available: false };
}

// ─── Invoices ───────────────────────────────────────────────────────────────

export function lineAmount(l: InvoiceLine): number {
  return Math.round(l.quantity * l.unitPrice);
}

export function computeInvoiceTotals(inv: Pick<Invoice, "lines" | "discount" | "payments">): InvoiceTotals {
  const subtotal = inv.lines.reduce((s, l) => s + lineAmount(l), 0);
  let discount =
    inv.discount.type === "percent" ? Math.round((subtotal * Math.min(Math.max(inv.discount.value, 0), 100)) / 100) : Math.round(inv.discount.value);
  discount = Math.min(Math.max(discount, 0), subtotal);
  // Discount is applied proportionally across lines before tax.
  const ratio = subtotal > 0 ? (subtotal - discount) / subtotal : 0;
  const tax = inv.lines.reduce((s, l) => s + Math.round(lineAmount(l) * ratio * (l.taxRate / 100)), 0);
  const total = subtotal - discount + tax;
  const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
  return { subtotal, discount, tax, total, paid, balance: Math.max(total - paid, 0) };
}

/** Derive invoice status from payments and due date, without clobbering draft/cancelled. */
export function deriveInvoiceStatus(inv: Pick<Invoice, "status" | "dueDate" | "totals">, today: string): Invoice["status"] {
  if (inv.status === "draft" || inv.status === "cancelled") return inv.status;
  if (inv.totals.total > 0 && inv.totals.balance <= 0) return "paid";
  if (inv.totals.paid > 0) return inv.dueDate < today ? "overdue" : "partially_paid";
  return inv.dueDate < today ? "overdue" : "sent";
}
