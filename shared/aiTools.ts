/**
 * AI tool registry. The same pure implementations run:
 *  - in the browser against isolated demo data (Demo Mode), and
 *  - in Cloud Functions against Firestore data (Real Mode).
 *
 * Tools never perform external actions. Anything external (sending email,
 * creating a real payment link, refunds, captures) is returned as an
 * `approval` effect which a human must approve before execution.
 */
import type { ApprovalRequest, ChartSpec, Dataset, Invoice, InvoiceLine } from "./types";
import { detectAnomalies, invoiceCollection, outstandingInvoices, revenueByProduct, summarize, timeSeries, topCustomers, upcomingRenewals, expenseByCategory } from "./analytics";
import { computeInvoiceTotals, formatMoney, toMinor, txReporting } from "./money";
import { addDays, dateKey, rangeFromPreset, todayKey, type DateRange, type RangePreset } from "./dates";

export type ToolEffect =
  | { type: "create_invoice_draft"; invoice: Omit<Invoice, "id" | "orgId" | "number" | "createdAt" | "updatedAt"> }
  | { type: "approval"; approval: Pick<ApprovalRequest, "kind" | "title" | "description" | "payload"> }
  | { type: "email_draft"; to: string; subject: string; body: string };

export interface ToolResult {
  /** Compact JSON returned to the model. */
  data: unknown;
  /** One-line, human-readable trace for the UI. */
  summary: string;
  charts?: ChartSpec[];
  effects?: ToolEffect[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run: (ds: Dataset, args: Record<string, any>) => ToolResult;
}

const PERIOD = {
  type: "string",
  enum: ["7d", "30d", "90d", "mtd", "qtd", "ytd", "12m"],
  description: "Reporting period. Defaults to 30d.",
};

function range(ds: Dataset, period?: string): DateRange {
  const p = (["7d", "30d", "90d", "mtd", "qtd", "ytd", "12m"].includes(period ?? "") ? period : "30d") as RangePreset;
  return rangeFromPreset(p, ds.org.timezone);
}
const m = (ds: Dataset, v: number) => formatMoney(v, ds.org.reportingCurrency);

export const AI_TOOLS: ToolDef[] = [
  {
    name: "get_revenue_summary",
    description: "Gross receipts, refunds, processing fees, expenses and net amounts for a period, in the reporting currency. Includes a revenue chart.",
    parameters: { type: "object", properties: { period: PERIOD } },
    run(ds, a) {
      const r = range(ds, a.period);
      const s = summarize(ds, r);
      const series = timeSeries(ds, r);
      return {
        // Amounts are pre-formatted: raw values are integer minor units (cents), which models misread as dollars.
        data: {
          period: r,
          currency: ds.org.reportingCurrency,
          grossReceipts: m(ds, s.grossReceipts),
          refunds: m(ds, s.refunds),
          processingFees: m(ds, s.fees),
          netRevenue: m(ds, s.netRevenue),
          expenses: m(ds, s.expenses),
          netAfterExpenses: m(ds, s.netAfterExpenses),
          successfulPayments: s.successfulCount,
          failedPayments: s.failedCount,
          successRate: `${(s.successRate * 100).toFixed(1)}%`,
          averageTransaction: m(ds, s.averageTransaction),
          note: s.estimatedConversions ? `${s.estimatedConversions} records use estimated exchange rates` : undefined,
        },
        summary: `Revenue ${r.from} → ${r.to}: gross ${m(ds, s.grossReceipts)}, net ${m(ds, s.netRevenue)}`,
        charts: [
          {
            type: "area",
            title: `Gross vs net revenue (${a.period ?? "30d"})`,
            data: series.map((p) => ({ label: p.label, value: p.gross, value2: p.net })),
            valueFormat: "currency",
            currency: ds.org.reportingCurrency,
            seriesNames: ["Gross", "Net"],
          },
        ],
      };
    },
  },
  {
    name: "get_transactions",
    description: "List transactions with optional filters. Returns up to `limit` rows (default 15).",
    parameters: {
      type: "object",
      properties: {
        period: PERIOD,
        status: { type: "string", description: "completed, pending, failed, denied, refunded, partially_refunded, authorized" },
        customer: { type: "string", description: "Customer name or email substring" },
        minAmount: { type: "number", description: "Minimum amount in major units (reporting currency)" },
        limit: { type: "number" },
      },
    },
    run(ds, a) {
      const r = range(ds, a.period);
      const tz = ds.org.timezone;
      const q = (a.customer ?? "").toLowerCase();
      const min = a.minAmount ? toMinor(a.minAmount, ds.org.reportingCurrency) : 0;
      const rows = ds.transactions
        .filter((t) => !t.archivedAt)
        .filter((t) => {
          const k = dateKey(t.date, tz);
          return k >= r.from && k <= r.to;
        })
        .filter((t) => !a.status || t.status === a.status)
        .filter((t) => !q || t.customerName.toLowerCase().includes(q) || (t.customerEmail ?? "").toLowerCase().includes(q))
        .filter((t) => txReporting(t, ds.org.reportingCurrency).gross >= min)
        .sort((x, y) => y.date.localeCompare(x.date));
      const limit = Math.min(Math.max(Number(a.limit) || 15, 1), 50);
      return {
        data: {
          total: rows.length,
          rows: rows.slice(0, limit).map((t) => ({
            id: t.id,
            date: t.date,
            customer: t.customerName,
            amount: formatMoney(t.gross, t.currency),
            status: t.status,
            method: t.paymentMethod,
            failureReason: t.failureReason,
            description: t.description,
          })),
        },
        summary: `Found ${rows.length} transaction(s)`,
      };
    },
  },
  {
    name: "search_customers",
    description: "Search customers by name, email or company. Returns profile details and lifetime payment totals.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run(ds, a) {
      const q = String(a.query ?? "").toLowerCase();
      const lifetime = new Map(topCustomers(ds, null, 10000).map((c) => [c.id, c]));
      const rows = ds.customers
        .filter((c) => !c.archivedAt)
        .filter((c) => [c.name, c.email, c.company ?? ""].some((s) => s.toLowerCase().includes(q)))
        .slice(0, 10)
        .map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          company: c.company,
          phone: c.phone,
          lifetimePaid: m(ds, lifetime.get(c.id)?.total ?? 0),
          payments: lifetime.get(c.id)?.count ?? 0,
          openInvoices: ds.invoices.filter((i) => i.customerId === c.id && i.totals.balance > 0 && i.status !== "draft" && i.status !== "cancelled").length,
        }));
      return { data: rows, summary: `Matched ${rows.length} customer(s) for “${a.query}”` };
    },
  },
  {
    name: "get_invoice_status",
    description: "Look up invoices by number, customer, or status (e.g. overdue). Returns totals and balances.",
    parameters: {
      type: "object",
      properties: { number: { type: "string" }, customer: { type: "string" }, status: { type: "string", enum: ["draft", "sent", "partially_paid", "paid", "overdue", "cancelled", "outstanding"] } },
    },
    run(ds, a) {
      const q = (a.customer ?? "").toLowerCase();
      let rows = a.status === "outstanding" ? outstandingInvoices(ds) : ds.invoices.filter((i) => !i.archivedAt);
      if (a.number) rows = rows.filter((i) => i.number.toLowerCase().includes(String(a.number).toLowerCase()));
      if (q) rows = rows.filter((i) => i.customerName.toLowerCase().includes(q));
      if (a.status && a.status !== "outstanding") rows = rows.filter((i) => i.status === a.status);
      const coll = invoiceCollection(ds, null);
      return {
        data: {
          collection: { outstanding: m(ds, coll.outstanding), overdue: m(ds, coll.overdue), overdueCount: coll.overdueCount, collectionRate: `${(coll.collectionRate * 100).toFixed(1)}%` },
          invoices: rows.slice(0, 15).map((i) => ({
            id: i.id,
            number: i.number,
            customer: i.customerName,
            email: i.customerEmail,
            status: i.status,
            issueDate: i.issueDate,
            dueDate: i.dueDate,
            total: formatMoney(i.totals.total, i.currency),
            balance: formatMoney(i.totals.balance, i.currency),
          })),
        },
        summary: `Found ${rows.length} invoice(s)`,
      };
    },
  },
  {
    name: "create_invoice_draft",
    description:
      "Create an INTERNAL invoice draft (not sent). Match the customer by name/email and products by name when possible; otherwise use custom lines. Amounts in major units.",
    parameters: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Customer name or email" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: { description: { type: "string" }, quantity: { type: "number" }, unitPrice: { type: "number", description: "Major units; omit to use the catalog price" } },
            required: ["description"],
          },
        },
        dueInDays: { type: "number" },
        notes: { type: "string" },
      },
      required: ["customer", "lines"],
    },
    run(ds, a) {
      const q = String(a.customer ?? "").toLowerCase();
      const cust = ds.customers.find((c) => !c.archivedAt && (c.name.toLowerCase().includes(q) || c.email.toLowerCase() === q || (c.company ?? "").toLowerCase().includes(q)));
      if (!cust) return { data: { error: `No customer matches “${a.customer}”. Ask the user to create the customer first.` }, summary: `Customer “${a.customer}” not found` };
      const cur = ds.org.reportingCurrency;
      const lines: InvoiceLine[] = (Array.isArray(a.lines) ? a.lines : []).slice(0, 25).map((l: any, i: number) => {
        const prod = ds.products.find((p) => p.active && !p.archivedAt && p.name.toLowerCase().includes(String(l.description ?? "").toLowerCase()));
        return {
          id: `l${i + 1}`,
          productId: prod?.id,
          description: prod?.name ?? String(l.description ?? "Item"),
          quantity: Math.max(Number(l.quantity) || 1, 0.01),
          unitPrice: l.unitPrice != null ? toMinor(Number(l.unitPrice), cur) : (prod?.price ?? 0),
          taxRate: prod?.taxRate ?? 0,
        };
      });
      const today = todayKey(ds.org.timezone);
      const days = Number(a.dueInDays) || ds.org.settings.defaultPaymentTermsDays;
      const base = { lines, discount: { type: "percent" as const, value: 0 }, payments: [] };
      const invoice = {
        source: "manual" as const,
        customerId: cust.id,
        customerName: cust.name,
        customerEmail: cust.email,
        status: "draft" as const,
        issueDate: today,
        dueDate: addDays(today, days),
        currency: cur,
        ...base,
        notes: String(a.notes ?? ""),
        terms: `Net ${days}`,
        paymentTermsDays: days,
        totals: computeInvoiceTotals(base),
        history: [{ at: new Date().toISOString(), event: "Draft created by AI assistant", by: "ai" }],
        attachmentIds: [],
        createdByAi: true,
      };
      return {
        data: { created: true, customer: cust.name, total: formatMoney(invoice.totals.total, cur), lines: lines.map((l) => `${l.quantity} × ${l.description} @ ${formatMoney(l.unitPrice, cur)}`) },
        summary: `Drafted invoice for ${cust.name} — ${formatMoney(invoice.totals.total, cur)}`,
        effects: [{ type: "create_invoice_draft", invoice }],
      };
    },
  },
  {
    name: "prepare_payment_link",
    description: "Prepare a payment link. Creating it requires the user's approval; this tool only creates the approval request.",
    parameters: {
      type: "object",
      properties: { amount: { type: "number", description: "Major units" }, currency: { type: "string" }, description: { type: "string" }, customer: { type: "string" } },
      required: ["amount", "description"],
    },
    run(ds, a) {
      const currency = String(a.currency ?? ds.org.reportingCurrency).toUpperCase();
      const amount = toMinor(Number(a.amount), currency);
      if (!(amount > 0)) return { data: { error: "Amount must be positive" }, summary: "Invalid amount" };
      const q = String(a.customer ?? "").toLowerCase();
      const cust = q ? ds.customers.find((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase() === q) : undefined;
      return {
        data: { awaitingApproval: true, amount: formatMoney(amount, currency), description: a.description, customer: cust?.name },
        summary: `Prepared payment link for ${formatMoney(amount, currency)} — awaiting approval`,
        effects: [
          {
            type: "approval",
            approval: {
              kind: "create_payment_link",
              title: `Create payment link: ${formatMoney(amount, currency)}`,
              description: `${a.description}${cust ? ` for ${cust.name}` : ""}`,
              payload: { amount, currency, description: String(a.description), customerId: cust?.id, customerName: cust?.name },
            },
          },
        ],
      };
    },
  },
  {
    name: "draft_customer_email",
    description:
      "Draft an email to a customer (thank-you, payment reminder, follow-up). Set `requestSend` true only if the user asked to send it — that creates an approval request; nothing is sent automatically.",
    parameters: {
      type: "object",
      properties: {
        customer: { type: "string" },
        purpose: { type: "string", enum: ["payment_reminder", "thank_you", "follow_up", "custom"] },
        invoiceNumber: { type: "string" },
        subject: { type: "string" },
        body: { type: "string", description: "Full email body. Write it yourself in a professional tone." },
        requestSend: { type: "boolean" },
      },
      required: ["customer", "purpose"],
    },
    run(ds, a) {
      const q = String(a.customer ?? "").toLowerCase();
      const cust = ds.customers.find((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase() === q || (c.company ?? "").toLowerCase().includes(q));
      if (!cust) return { data: { error: `No customer matches “${a.customer}”` }, summary: "Customer not found" };
      const inv = a.invoiceNumber
        ? ds.invoices.find((i) => i.number.toLowerCase() === String(a.invoiceNumber).toLowerCase())
        : outstandingInvoices(ds).find((i) => i.customerId === cust.id);
      const first = cust.name.split(" ")[0];
      let subject = a.subject as string | undefined;
      let body = a.body as string | undefined;
      if (!subject || !body) {
        if (a.purpose === "payment_reminder" && inv) {
          subject ??= `Friendly reminder: invoice ${inv.number} (${formatMoney(inv.totals.balance, inv.currency)})`;
          body ??= `Hi ${first},\n\nI hope you're well. This is a quick reminder that invoice ${inv.number} for ${formatMoney(inv.totals.balance, inv.currency)} was due on ${inv.dueDate}. If you've already sent payment, thank you — please disregard this note.\n\nLet me know if you have any questions.\n\nBest regards,\n${ds.org.name}`;
        } else if (a.purpose === "thank_you") {
          subject ??= `Thank you from ${ds.org.name}`;
          body ??= `Hi ${first},\n\nThank you for your recent payment — we really appreciate your business.\n\nBest regards,\n${ds.org.name}`;
        } else {
          subject ??= `Following up from ${ds.org.name}`;
          body ??= `Hi ${first},\n\nI wanted to follow up and see if there's anything else we can help with.\n\nBest regards,\n${ds.org.name}`;
        }
      }
      const effects: ToolEffect[] = [{ type: "email_draft", to: cust.email, subject, body }];
      if (a.requestSend)
        effects.push({
          type: "approval",
          approval: {
            kind: "send_email",
            title: `Send email to ${cust.name}`,
            description: subject,
            payload: { to: cust.email, toName: cust.name, subject, body, template: a.purpose === "payment_reminder" ? "reminder" : "customer", relatedType: inv ? "invoice" : "customer", relatedId: inv?.id ?? cust.id },
          },
        });
      return { data: { to: cust.email, subject, body, awaitingApproval: !!a.requestSend }, summary: `Drafted email to ${cust.name}${a.requestSend ? " — awaiting approval" : ""}`, effects };
    },
  },
  {
    name: "generate_business_report",
    description: "Comprehensive report: revenue, fees, refunds, expenses by category, top customers, product performance, invoice collection. Includes charts.",
    parameters: { type: "object", properties: { period: PERIOD } },
    run(ds, a) {
      const r = range(ds, a.period);
      const s = summarize(ds, r);
      const prods = revenueByProduct(ds, r).slice(0, 6);
      const tops = topCustomers(ds, r, 5);
      const exp = expenseByCategory(ds, r);
      const coll = invoiceCollection(ds, r);
      return {
        data: {
          period: r,
          currency: ds.org.reportingCurrency,
          grossReceipts: m(ds, s.grossReceipts),
          refunds: m(ds, s.refunds),
          processingFees: m(ds, s.fees),
          netRevenue: m(ds, s.netRevenue),
          expenses: m(ds, s.expenses),
          netAfterExpenses: m(ds, s.netAfterExpenses),
          successRate: `${(s.successRate * 100).toFixed(1)}%`,
          averageTransaction: m(ds, s.averageTransaction),
          topProducts: prods.map((p) => ({ name: p.name, gross: m(ds, p.gross), count: p.count })),
          topCustomers: tops.map((c) => ({ name: c.name, total: m(ds, c.total) })),
          expensesByCategory: exp.map((e) => ({ category: e.category, amount: m(ds, e.amount) })),
          invoices: { issued: m(ds, coll.issued), collected: m(ds, coll.collected), outstanding: m(ds, coll.outstanding), collectionRate: `${(coll.collectionRate * 100).toFixed(0)}%` },
          estimatedConversions: s.estimatedConversions,
        },
        summary: `Built business report for ${r.from} → ${r.to}`,
        charts: [
          { type: "bar", title: "Revenue by product/service", data: prods.map((p) => ({ label: p.name, value: p.gross })), valueFormat: "currency", currency: ds.org.reportingCurrency },
          { type: "pie", title: "Expenses by category", data: exp.map((e) => ({ label: e.category, value: e.amount })), valueFormat: "currency", currency: ds.org.reportingCurrency },
        ],
      };
    },
  },
  {
    name: "detect_unusual_transactions",
    description: "Flag unusual transaction patterns for HUMAN REVIEW (large outliers, repeated failures, possible duplicates, quick refunds). Not a fraud determination.",
    parameters: { type: "object", properties: { period: PERIOD } },
    run(ds, a) {
      const r = range(ds, a.period ?? "90d");
      const found = detectAnomalies(ds, r);
      const byId = new Map(ds.transactions.map((t) => [t.id, t]));
      return {
        data: found.slice(0, 20).map((f) => {
          const t = byId.get(f.transactionId)!;
          return { ...f, date: t.date, customer: t.customerName, amount: formatMoney(t.gross, t.currency), status: t.status };
        }),
        summary: `${found.length} pattern(s) flagged for review`,
      };
    },
  },
  {
    name: "explain_payment_status",
    description: "Explain what a transaction status or failure means and what to do next. Pass a transaction id or a status.",
    parameters: { type: "object", properties: { transactionId: { type: "string" }, status: { type: "string" } } },
    run(ds, a) {
      const t = a.transactionId ? ds.transactions.find((x) => x.id === a.transactionId || x.externalId === a.transactionId) : undefined;
      const status = t?.status ?? a.status;
      const meanings: Record<string, string> = {
        completed: "Funds were captured and are in the PayPal balance (less fees).",
        pending: "PayPal is holding the payment — commonly an eCheck clearing, a risk review, or a currency the account doesn't hold yet.",
        failed: "The payment did not go through. The payer's funding source declined or an error occurred.",
        denied: "The payment was denied, often by PayPal risk checks or the merchant's payment receiving preferences.",
        refunded: "The full amount was returned to the payer. PayPal may not return the original fixed fee.",
        partially_refunded: "Part of the amount was returned to the payer.",
        authorized: "Funds are held on the payer's account but not yet captured. Authorizations typically have a 3-day honor period and expire after 29 days.",
        voided: "The authorization was cancelled; no funds were captured.",
      };
      return {
        data: { transaction: t && { id: t.id, status: t.status, failureReason: t.failureReason, amount: formatMoney(t.gross, t.currency), method: t.paymentMethod }, meaning: meanings[status ?? ""] ?? "Unknown status." },
        summary: `Explained status “${status}”`,
      };
    },
  },
  {
    name: "recommend_automations",
    description: "Recommend automation workflows based on the organization's actual activity (overdue invoices, failed payments, renewals).",
    parameters: { type: "object", properties: {} },
    run(ds) {
      const r = rangeFromPreset("90d", ds.org.timezone);
      const s = summarize(ds, r);
      const out = outstandingInvoices(ds).filter((i) => i.daysOverdue > 0);
      const renewals = upcomingRenewals(ds, 30);
      const recs = [] as { name: string; trigger: string; why: string }[];
      if (out.length) recs.push({ name: "Overdue invoice reminder", trigger: "invoice_overdue", why: `${out.length} invoices are overdue right now` });
      if (s.failedCount) recs.push({ name: "Failed payment follow-up", trigger: "payment_failed", why: `${s.failedCount} failed payments in 90 days` });
      if (renewals.length) recs.push({ name: "Renewal heads-up", trigger: "subscription_renewal", why: `${renewals.length} renewals in the next 30 days` });
      recs.push({ name: "Large payment alert", trigger: "large_transaction", why: `Average payment is ${m(ds, s.averageTransaction)}; alert on outliers` });
      recs.push({ name: "Morning briefing", trigger: "daily_briefing", why: "Daily summary of yesterday's money in and out" });
      return { data: recs, summary: `Recommended ${recs.length} automation(s)` };
    },
  },
  {
    name: "get_daily_briefing",
    description: "Yesterday's and today's activity, overdue invoices, upcoming renewals and items needing attention.",
    parameters: { type: "object", properties: {} },
    run(ds) {
      const tz = ds.org.timezone;
      const today = todayKey(tz);
      const y = addDays(today, -1);
      const sy = summarize(ds, { from: y, to: y });
      const st = summarize(ds, { from: today, to: today });
      const s7 = summarize(ds, { from: addDays(today, -6), to: today });
      const overdue = outstandingInvoices(ds).filter((i) => i.daysOverdue > 0);
      const renewals = upcomingRenewals(ds, 7);
      const failed = ds.transactions.filter((t) => (t.status === "failed" || t.status === "denied") && dateKey(t.date, tz) >= addDays(today, -2));
      return {
        data: {
          date: today,
          yesterday: { gross: m(ds, sy.grossReceipts), net: m(ds, sy.netRevenue), payments: sy.successfulCount },
          today: { gross: m(ds, st.grossReceipts), payments: st.successfulCount },
          last7Days: { gross: m(ds, s7.grossReceipts), net: m(ds, s7.netRevenue), expenses: m(ds, s7.expenses) },
          overdueInvoices: overdue.slice(0, 5).map((i) => ({ number: i.number, customer: i.customerName, balance: formatMoney(i.totals.balance, i.currency), daysOverdue: i.daysOverdue })),
          overdueCount: overdue.length,
          renewalsNext7Days: renewals.map((r) => ({ customer: r.customerName, product: r.productName, amount: formatMoney(r.amount, r.currency), date: r.nextBillingDate })),
          recentFailedPayments: failed.map((t) => ({ customer: t.customerName, amount: formatMoney(t.gross, t.currency), reason: t.failureReason })),
        },
        summary: `Briefing for ${today}`,
      };
    },
  },
];

export function toolByName(name: string): ToolDef | undefined {
  return AI_TOOLS.find((t) => t.name === name);
}

/** OpenAI/OpenRouter `tools` payload. */
export function toolSchemas() {
  return AI_TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

export function systemPrompt(ds: Dataset, mode: "demo" | "real"): string {
  return [
    `You are PayPilot's financial assistant for "${ds.org.name}" (${ds.org.businessType}).`,
    `Reporting currency: ${ds.org.reportingCurrency}. Timezone: ${ds.org.timezone}. Today: ${todayKey(ds.org.timezone)}.`,
    mode === "demo" ? "The organization is in DEMO MODE: all data is sample data. Say so if the user may think it is real." : "Data comes from the organization's connected accounts.",
    "Use tools to get facts — never invent numbers. Distinguish gross receipts, refunds, processing fees, expenses and net amounts.",
    "Flag estimated currency conversions. You are not an accountant or tax advisor; say so when giving tax-adjacent guidance.",
    "Unusual-pattern findings are for human review, not fraud accusations.",
    "You CANNOT execute external actions. Sending emails, creating payment links, refunds and captures only create approval requests the user must approve in the UI. Tell the user an approval card is waiting.",
    "Respond in concise GitHub-flavored Markdown. Use short tables for lists of records.",
  ].join("\n");
}
