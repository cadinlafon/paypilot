/**
 * Demo Mode assistant. Runs entirely in the browser over isolated sample data
 * with the SAME tool implementations the server uses — but intent routing is
 * rule-based instead of an LLM, so it costs nothing and works offline.
 * Clearly labelled “Simulated AI” in the UI.
 */
import type { AiToolCallTrace, ChartSpec, Dataset } from "@shared/types";
import { toolByName, type ToolEffect } from "@shared/aiTools";
import { outstandingInvoices } from "@shared/analytics";

export interface DemoAssistantResult {
  content: string;
  toolCalls: AiToolCallTrace[];
  charts: ChartSpec[];
  effects: ToolEffect[];
}

function period(text: string): string {
  const t = text.toLowerCase();
  if (/\btoday|yesterday|this week|last week|7 ?d|seven days\b/.test(t)) return "7d";
  if (/this month|month to date|mtd/.test(t)) return "mtd";
  if (/quarter|qtd/.test(t)) return "qtd";
  if (/this year|ytd|year to date/.test(t)) return "ytd";
  if (/12 ?months|last year|annual|yearly/.test(t)) return "12m";
  if (/90|three months|3 months/.test(t)) return "90d";
  return "30d";
}

function findCustomer(ds: Dataset, text: string) {
  const t = text.toLowerCase();
  return (
    ds.customers.find((c) => t.includes(c.name.toLowerCase())) ??
    ds.customers.find((c) => c.company && t.includes(c.company.toLowerCase())) ??
    ds.customers.find((c) => t.includes(c.name.split(" ")[0].toLowerCase()) && c.name.split(" ")[0].length > 3)
  );
}

function amount(text: string): number | undefined {
  const m = text.match(/(?:[$€£]\s?)(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:usd|eur|gbp|dollars|euros)/i);
  const raw = m?.[1] ?? m?.[2];
  return raw ? Number(raw.replace(/,/g, "")) : undefined;
}

function table(rows: Record<string, unknown>[], cols: [string, string][]): string {
  if (!rows.length) return "_No matching records._";
  const head = `| ${cols.map((c) => c[1]).join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${cols.map(([k]) => String(r[k] ?? "—").replace(/\|/g, "/")).join(" | ")} |`).join("\n");
  return `${head}\n${body}`;
}

export function runDemoAssistant(ds: Dataset, message: string): DemoAssistantResult {
  const text = message.toLowerCase();
  const toolCalls: AiToolCallTrace[] = [];
  const charts: ChartSpec[] = [];
  const effects: ToolEffect[] = [];
  const call = (name: string, args: Record<string, unknown>) => {
    const res = toolByName(name)!.run(ds, args);
    toolCalls.push({ name, args, status: "done", summary: res.summary });
    if (res.charts) charts.push(...res.charts.filter((c) => c.data.length));
    if (res.effects) effects.push(...res.effects);
    return res.data as any;
  };
  const cur = ds.org.reportingCurrency;
  const p = period(text);
  const cust = findCustomer(ds, message);
  let content = "";

  if (/briefing|morning|what happened|catch me up|today/.test(text)) {
    const d = call("get_daily_briefing", {});
    content = `### Daily briefing — ${d.date}\n\n**Yesterday:** ${d.yesterday.gross} gross · ${d.yesterday.net} net from ${d.yesterday.payments} payments.\n**Last 7 days:** ${d.last7Days.gross} gross, ${d.last7Days.net} net, ${d.last7Days.expenses} in expenses.\n\n`;
    if (d.overdueCount) content += `**${d.overdueCount} overdue invoice(s)** need attention:\n\n${table(d.overdueInvoices, [["number", "Invoice"], ["customer", "Customer"], ["balance", "Balance"], ["daysOverdue", "Days overdue"]])}\n\n`;
    if (d.renewalsNext7Days.length) content += `**Renewals in the next 7 days:** ${d.renewalsNext7Days.map((r: any) => `${r.customer} (${r.amount}, ${r.date})`).join(", ")}.\n\n`;
    if (d.recentFailedPayments.length) content += `**${d.recentFailedPayments.length} failed payment(s)** in the last 48 hours — mostly ${d.recentFailedPayments[0].reason?.split(" —")[0] ?? "declines"}. Ask me to *explain failed payments* for next steps.\n`;
  } else if (/unusual|anomal|suspicious|fraud|duplicate|weird|odd/.test(text)) {
    const d = call("detect_unusual_transactions", { period: p === "30d" ? "90d" : p });
    content = d.length
      ? `I found **${d.length} pattern(s)** worth a human look. These are heuristics, not fraud determinations:\n\n${table(d, [["date", "Date"], ["customer", "Customer"], ["amount", "Amount"], ["reason", "Why flagged"], ["severity", "Severity"]]).replace(/T\d\d:\d\d:\d\d\.\d+Z/g, "")}\n\nReview each on the **Transactions** page before taking action (e.g. refunding a duplicate).`
      : "Nothing unusual stood out in this period.";
  } else if (/remind|email|follow.?up|thank|write to|message/.test(text)) {
    const mostOverdue = outstandingInvoices(ds).find((i) => i.daysOverdue > 0);
    const target = cust ?? (mostOverdue ? ds.customers.find((c) => c.id === mostOverdue.customerId) : undefined);
    if (!target) content = "Who should I write to? Mention a customer by name.";
    else {
      const purpose = /thank/.test(text) ? "thank_you" : /remind|overdue|pay/.test(text) ? "payment_reminder" : "follow_up";
      const d = call("draft_customer_email", { customer: target.email, purpose, invoiceNumber: !cust && mostOverdue ? mostOverdue.number : undefined, requestSend: /\bsend\b/.test(text) });
      content = d.error ? d.error : `Here's a draft to **${d.to}**:\n\n> **Subject:** ${d.subject}\n>\n${d.body.split("\n").map((l: string) => `> ${l}`).join("\n")}\n\n${d.awaitingApproval ? "I've queued it for **your approval** below. In Demo Mode, approving records a simulated send — no email leaves PayPilot." : "Say *“send it”* and I'll queue it for your approval."}`;
    }
  } else if (/invoice/.test(text) && /draft|create|make|bill|new|generate/.test(text)) {
    if (!cust) {
      content = `Which customer should I bill? Try e.g. *“Draft an invoice for ${ds.customers[0].name} for 2 Strategy Workshops”*.`;
    } else {
      const forPart = message.split(/\bfor\b/i).slice(2).join(" for ").trim() || message.split(/\bfor\b/i)[1]?.replace(cust.name, "").trim() || "";
      const qty = Number(forPart.match(/\b(\d+)\s*(?:x|×)?\s/)?.[1]) || 1;
      const amt = amount(message);
      const prod = ds.products.find((pp) => pp.active && text.includes(pp.name.toLowerCase().split(" ")[0]) && pp.name.split(" ")[0].length > 3);
      const desc = prod?.name ?? (forPart.replace(/[$€£]?\d[\d,.]*/g, "").replace(/\b(an?|the)\b/gi, "").trim() || "Professional services");
      const d = call("create_invoice_draft", { customer: cust.name, lines: [{ description: desc, quantity: qty, unitPrice: amt }], notes: "Drafted by PayPilot AI (demo)" });
      content = d.error ? d.error : `I drafted an invoice for **${d.customer}** totalling **${d.total}**:\n\n${d.lines.map((l: string) => `- ${l}`).join("\n")}\n\nIt's saved as a **draft** on the Invoices page — nothing was sent. Review it there, then send when ready.`;
    }
  } else if (/overdue|outstanding|owe|unpaid|collect/.test(text)) {
    const d = call("get_invoice_status", { status: "outstanding", customer: cust?.name });
    content = `**Outstanding:** ${d.collection.outstanding} · **Overdue:** ${d.collection.overdue} across ${d.collection.overdueCount} invoice(s) · Collection rate ${d.collection.collectionRate}.\n\n${table(d.invoices.slice(0, 8), [["number", "Invoice"], ["customer", "Customer"], ["dueDate", "Due"], ["balance", "Balance"], ["status", "Status"]])}\n\nWant me to *draft a reminder* for the oldest one?`;
  } else if (/payment link|pay link|checkout link/.test(text)) {
    const amt = amount(message);
    if (!amt) content = "How much should the link be for? e.g. *“Create a $250 payment link for a Strategy Workshop deposit”*.";
    else {
      const desc = message.split(/\bfor\b/i).slice(1).join(" for ").replace(cust?.name ?? "§", "").trim() || "Payment";
      const d = call("prepare_payment_link", { amount: amt, description: desc, customer: cust?.name });
      content = `I prepared a payment link for **${d.amount}** (${d.description}). Approve it below to create it. In Demo Mode it'll be a clearly marked **sample link that cannot accept payments**.`;
    }
  } else if (/automat|workflow|rule/.test(text)) {
    const d = call("recommend_automations", {});
    content = `Based on your activity, I'd set up:\n\n${d.map((r: any) => `- **${r.name}** — _${r.why}_`).join("\n")}\n\nYou can build any of these on the **Automations** page. External steps like emails always wait for approval.`;
  } else if (/fail|declin|denied|pending|authori[sz]ed|status/.test(text)) {
    const status = /pending/.test(text) ? "pending" : /authori/.test(text) ? "authorized" : "failed";
    const d = call("get_transactions", { status, period: p === "30d" ? "90d" : p, limit: 8 });
    const ex = call("explain_payment_status", { status });
    content = `**${d.total} ${status} payment(s)** in the period.\n\n**What it means:** ${ex.meaning}\n\n${table(d.rows, [["customer", "Customer"], ["amount", "Amount"], ["method", "Method"], ["failureReason", "Reason"]])}`;
    if (status === "failed") content += `\n\n**Typical fixes:** ask the payer to retry with a different funding source, complete 3-D Secure, or pay via an invoice link. Repeated failures from one payer can indicate a card problem — or warrant review.`;
    if (status === "authorized") content += `\n\nCapture authorized payments from **Transactions → details**. In Demo Mode captures are simulated.`;
  } else if (/top|best|biggest|largest/.test(text) && /customer|client/.test(text)) {
    const d = call("generate_business_report", { period: p === "30d" ? "12m" : p });
    content = `**Top customers (${p === "30d" ? "last 12 months" : p})**, net of refunds:\n\n${table(d.topCustomers, [["name", "Customer"], ["total", "Paid"]])}`;
  } else if (cust && /customer|client|who is|about|profile|history/.test(text)) {
    const d = call("search_customers", { query: cust.name });
    const c = d[0];
    content = `**${c.name}**${c.company ? ` · ${c.company}` : ""}\n\n- Email: ${c.email}\n- Phone: ${c.phone ?? "—"}\n- Lifetime paid: **${c.lifetimePaid}** across ${c.payments} payment(s)\n- Open invoices: ${c.openInvoices}`;
  } else if (/report|summary|overview|p&l|profit|perform|product|how are we|how is business/.test(text)) {
    const d = call("generate_business_report", { period: p });
    content = `### Business report · ${d.period.from} → ${d.period.to}\n\n| | ${cur} |\n|---|---:|\n| Gross receipts | ${d.grossReceipts} |\n| Refunds | −${d.refunds} |\n| Processing fees | −${d.processingFees} |\n| **Net revenue** | **${d.netRevenue}** |\n| Expenses | −${d.expenses} |\n| **Net after expenses** | **${d.netAfterExpenses}** |\n\nPayment success rate **${d.successRate}**, average payment **${d.averageTransaction}**. Invoices: ${d.invoices.collected} collected of ${d.invoices.issued} issued (${d.invoices.collectionRate}).\n\n**Top products:** ${d.topProducts.slice(0, 3).map((x: any) => `${x.name} (${x.gross})`).join(", ")}.\n\n${d.estimatedConversions ? `_${d.estimatedConversions} amount(s) use estimated exchange rates._\n\n` : ""}_Management figures from sample data — not audited accounts or tax advice._`;
  } else if (/revenue|sales|earn|income|made|money|gross|net/.test(text)) {
    const d = call("get_revenue_summary", { period: p });
    content = `Between **${d.period.from}** and **${d.period.to}** (${cur}):\n\n- Gross receipts: **${d.grossReceipts}**\n- Refunds: ${d.refunds}\n- Processing fees: ${d.processingFees}\n- **Net revenue: ${d.netRevenue}**\n- Expenses: ${d.expenses} → net after expenses **${d.netAfterExpenses}**\n\n${d.successfulPayments} successful payments, ${d.successRate} success rate.${d.note ? `\n\n_${d.note}._` : ""}`;
  } else if (/improve|grow|advice|suggest|recommend|idea/.test(text)) {
    const d = call("generate_business_report", { period: "90d" });
    const inv = call("get_invoice_status", { status: "outstanding" });
    content = `A few ideas grounded in your last 90 days:\n\n1. **Tighten collections** — ${inv.collection.overdue} is overdue. An automated 7-day reminder (with approval) typically shortens payment time.\n2. **Lean into what sells** — ${d.topProducts[0]?.name} leads at ${d.topProducts[0]?.gross}. Consider a bundle or retainer version.\n3. **Reduce failed payments** — success rate is ${d.successRate}. Offer PayPal Pay Later and invoice links as fallbacks.\n4. **Watch fees** — processing fees were ${d.processingFees}. For large B2B invoices, bank transfer may be cheaper.\n5. **Expense hygiene** — largest category is ${d.expensesByCategory[0]?.category} (${d.expensesByCategory[0]?.amount}).\n\n_These are suggestions, not financial advice._`;
  } else {
    content = `I'm the **simulated** demo assistant — I answer from sample data using PayPilot's real analysis tools. Try:\n\n- *How much revenue did we make this month?*\n- *Give me today's briefing*\n- *Which invoices are overdue?*\n- *Draft an invoice for ${ds.customers[2]?.name} for a Strategy Workshop*\n- *Find unusual transactions*\n- *Create a $300 payment link for a deposit*\n- *Recommend automations*`;
  }
  return { content, toolCalls, charts, effects };
}
