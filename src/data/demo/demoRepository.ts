/**
 * Demo Mode repository.
 *
 * Isolation guarantees:
 *  - Data lives only in this browser (memory + localStorage, namespaced per
 *    demo organization). It is never written to Firestore.
 *  - No network calls are made to PayPal, EmailJS, OpenRouter or Backblaze.
 *  - Every "external" operation is a clearly labelled simulation.
 */
import type { AiConversation, AiMessage, ApprovalRequest, AutomationRun, Dataset, Organization, PaymentLink, PayPalConnectionPublic, Transaction, TriggerType } from "@shared/types";
import { planAutomation, evaluateConditions, runStatus, type EventPayload } from "@shared/automations";
import { toolByName } from "@shared/aiTools";
import { addDays, todayKey } from "@shared/dates";
import { computeInvoiceTotals, deriveInvoiceStatus, formatMoney } from "@shared/money";
import type { ActionResult, CollectionMap, CollectionName, Repository, SendEmailInput } from "../repository";
import { DEMO_VERSION, generateDemoState, type DemoState } from "./seed";
import { runDemoAssistant } from "./assistant";
import { demoRate } from "./rates";
import { convertMinor } from "@shared/money";
import { uid } from "@/lib/utils";

const KEY = (orgId: string) => `paypilot:demo:v${DEMO_VERSION}:${orgId}`;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const stores = new Map<string, DemoStore>();

class DemoStore {
  state: DemoState;
  listeners = new Map<string, Set<(rows: unknown) => void>>();
  orgListeners = new Set<(o: Organization) => void>();
  saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(public orgId: string) {
    this.state = this.load() ?? generateDemoState(orgId);
    this.save();
  }
  load(): DemoState | null {
    try {
      const raw = localStorage.getItem(KEY(this.orgId));
      if (!raw) return null;
      const s = JSON.parse(raw) as DemoState;
      return s.version === DEMO_VERSION ? s : null;
    } catch {
      return null;
    }
  }
  save() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY(this.orgId), JSON.stringify(this.state));
      } catch {
        /* storage full or blocked — demo continues in memory */
      }
    }, 250);
  }
  emit(name: CollectionName) {
    const rows = (this.state as any)[name] as unknown[];
    this.listeners.get(name)?.forEach((cb) => cb([...rows]));
    this.save();
  }
  emitOrg() {
    this.orgListeners.forEach((cb) => cb({ ...this.state.org }));
    this.save();
  }
  reset() {
    this.state = generateDemoState(this.orgId);
    for (const k of this.listeners.keys()) this.emit(k as CollectionName);
    this.emitOrg();
  }
  dataset(): Dataset {
    const s = this.state;
    return { org: s.org, transactions: s.transactions, customers: s.customers, invoices: s.invoices, products: s.products, subscriptions: s.subscriptions, expenses: s.expenses, paymentLinks: s.paymentLinks };
  }
}

function store(orgId: string): DemoStore {
  let s = stores.get(orgId);
  if (!s) stores.set(orgId, (s = new DemoStore(orgId)));
  return s;
}

export function createDemoRepository(orgId: string, actorName: string): Repository {
  const s = store(orgId);
  const now = () => new Date().toISOString();
  const list = <K extends CollectionName>(n: K) => (s.state as any)[n] as CollectionMap[K][];

  const log = (action: string, target: string, detail?: string) => {
    s.state.activityLogs.unshift({ id: uid("log"), orgId, actor: actorName, action, target, detail, createdAt: now() });
    s.emit("activityLogs");
  };
  const notify = (n: Omit<CollectionMap["notifications"], "id" | "orgId" | "createdAt" | "read">) => {
    if (!s.state.org.settings.notifications.categories[n.category]) return;
    s.state.notifications.unshift({ ...n, id: uid("ntf"), orgId, createdAt: now(), read: false });
    s.emit("notifications");
  };

  const repo: Repository = {
    mode: "demo",
    orgId,

    subscribe(name, cb) {
      let set = s.listeners.get(name);
      if (!set) s.listeners.set(name, (set = new Set()));
      const fn = cb as (rows: unknown) => void;
      set.add(fn);
      // Async to mimic a real data source (lets skeletons render once).
      const t = setTimeout(() => fn([...list(name)]), 120);
      return () => {
        clearTimeout(t);
        set!.delete(fn);
      };
    },

    async create(name, data) {
      if (name === "expenses") data = withExpenseFx(data as any) as typeof data;
      const rec = { ...(data as object), id: uid(name.slice(0, 3)), orgId, source: "demo", createdAt: now(), updatedAt: now(), archivedAt: null } as unknown as CollectionMap[typeof name];
      list(name).unshift(rec);
      s.emit(name);
      log(`Created ${name.replace(/s$/, "")}`, (rec as any).name ?? (rec as any).number ?? (rec as any).title ?? rec.id);
      if (name === "customers") {
        const c = rec as unknown as CollectionMap["customers"];
        notify({ category: "customer", severity: "info", title: `New customer: ${c.name}`, body: c.company ?? "Individual", link: `/customers/${c.id}` });
        await fire("new_customer", { customerName: c.name, company: c.company ?? "", email: c.email, customerEmail: c.email, orgName: s.state.org.name });
      }
      return rec;
    },

    async update(name, id, patch) {
      const arr = list(name);
      const i = arr.findIndex((r: any) => r.id === id);
      if (i < 0) throw new Error("Record not found");
      arr[i] = { ...arr[i], ...patch, updatedAt: now() };
      if (name === "expenses") arr[i] = withExpenseFx(arr[i] as any) as any;
      s.emit(name);
    },

    async archive(name, id) {
      await repo.update(name, id, { archivedAt: now() } as any);
      log(`Archived ${name.replace(/s$/, "")}`, id);
    },

    subscribeOrg(cb) {
      s.orgListeners.add(cb);
      cb({ ...s.state.org });
      return () => s.orgListeners.delete(cb);
    },
    async updateOrg(patch) {
      s.state.org = { ...s.state.org, ...patch, settings: { ...s.state.org.settings, ...(patch.settings ?? {}) }, updatedAt: now() };
      s.emitOrg();
      log("Updated organization settings", s.state.org.name);
    },
    subscribePayPal(cb: (c: PayPalConnectionPublic | null) => void) {
      cb(null); // Demo Mode never connects to PayPal.
      return () => {};
    },

    async refund(transactionId, amount, reason): Promise<ActionResult> {
      await delay(600);
      const t = s.state.transactions.find((x) => x.id === transactionId);
      if (!t) return { ok: false, message: "Transaction not found" };
      const remaining = t.gross - t.refundedAmount;
      if (amount <= 0 || amount > remaining) return { ok: false, message: `Refund must be between 0 and ${formatMoney(remaining, t.currency)}` };
      t.refunds.push({ id: uid("rf"), amount, date: now(), reason: `${reason} (simulated)` });
      t.refundedAmount += amount;
      t.status = t.refundedAmount >= t.gross ? "refunded" : "partially_refunded";
      t.updatedAt = now();
      s.emit("transactions");
      log("Simulated refund", t.externalId ?? t.id, formatMoney(amount, t.currency));
      return { ok: true, simulated: true, message: `Simulated refund of ${formatMoney(amount, t.currency)} recorded on demo data. No money moved.` };
    },

    async capture(transactionId) {
      await delay(600);
      const t = s.state.transactions.find((x) => x.id === transactionId);
      if (!t || t.status !== "authorized") return { ok: false, message: "Only authorized payments can be captured" };
      t.status = "completed";
      t.fee = Math.round(t.gross * 0.0349 + 49);
      t.net = t.gross - t.fee;
      t.updatedAt = now();
      s.emit("transactions");
      log("Simulated capture", t.externalId ?? t.id);
      return { ok: true, simulated: true, message: "Simulated capture recorded on demo data. No PayPal call was made." };
    },

    async sendInvoice(invoiceId) {
      await delay(500);
      const inv = s.state.invoices.find((i) => i.id === invoiceId);
      if (!inv) return { ok: false, message: "Invoice not found" };
      inv.totals = computeInvoiceTotals(inv);
      inv.status = inv.status === "draft" ? "sent" : inv.status;
      inv.status = deriveInvoiceStatus(inv, todayKey(s.state.org.timezone));
      inv.history.push({ at: now(), event: `Sent to ${inv.customerEmail} (simulated)`, by: actorName });
      inv.updatedAt = now();
      s.emit("invoices");
      s.state.emailLogs.unshift({ id: uid("eml"), orgId, to: inv.customerEmail, subject: `Invoice ${inv.number} from ${s.state.org.name}`, template: "invoice", status: "simulated", relatedType: "invoice", relatedId: inv.id, createdAt: now() });
      s.emit("emailLogs");
      return { ok: true, simulated: true, message: `Invoice marked as sent. Demo Mode: no email was delivered to ${inv.customerEmail}.` };
    },

    async sendEmail(input: SendEmailInput) {
      await delay(400);
      s.state.emailLogs.unshift({ id: uid("eml"), orgId, to: input.to, subject: input.subject, template: input.template, status: "simulated", relatedType: input.relatedType, relatedId: input.relatedId, createdAt: now() });
      s.emit("emailLogs");
      log("Simulated email", input.to, input.subject);
      return { ok: true, simulated: true, message: `Simulated — no email was sent to ${input.to}.` };
    },

    async createPaymentLink(input) {
      await delay(400);
      const id = uid("pl");
      const cust = input.customerId ? s.state.customers.find((c) => c.id === input.customerId) : undefined;
      const link: PaymentLink = {
        id,
        orgId,
        source: "demo",
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        customerId: cust?.id,
        customerName: cust?.name,
        status: "active",
        url: `https://demo.paypilot.local/pay/${id}`,
        isSample: true,
        expiresAt: input.expiresAt,
        views: 0,
        activity: [{ at: now(), event: "Created", detail: "Sample link — cannot accept payments" }],
        createdAt: now(),
        updatedAt: now(),
        archivedAt: null,
      };
      s.state.paymentLinks.unshift(link);
      s.emit("paymentLinks");
      log("Created sample payment link", input.description, formatMoney(input.amount, input.currency));
      return link;
    },

    async setPaymentLinkStatus(id, status) {
      const l = s.state.paymentLinks.find((x) => x.id === id);
      if (!l) return;
      l.status = status;
      l.activity.push({ at: now(), event: status === "disabled" ? "Disabled" : "Re-enabled" });
      l.updatedAt = now();
      s.emit("paymentLinks");
    },

    async syncNow() {
      return { ok: false, message: "Demo Mode has no PayPal connection to sync. Switch to Real Mode to connect PayPal Sandbox." };
    },

    async uploadFile(file, purpose, related) {
      await delay(500);
      // Demo: only metadata is stored; file content never leaves the browser.
      const rec = { id: uid("file"), orgId, name: file.name, contentType: file.type || "application/octet-stream", size: file.size, purpose, relatedType: related?.type, relatedId: related?.id, storageKey: `demo/${file.name}`, uploadedBy: actorName, createdAt: now(), isSample: true };
      demoBlobs.set(rec.id, URL.createObjectURL(file));
      s.state.files.unshift(rec);
      s.emit("files");
      return rec;
    },

    async getFileUrl(fileId) {
      return demoBlobs.get(fileId) ?? null;
    },

    async aiChat(conversationId, message, model) {
      await delay(700 + Math.random() * 500);
      let conv = conversationId ? s.state.aiConversations.find((c) => c.id === conversationId) : undefined;
      if (!conv) {
        conv = { id: uid("conv"), orgId, title: message.slice(0, 60), model: "simulated", messages: [], createdAt: now(), updatedAt: now(), createdBy: actorName } as AiConversation;
        s.state.aiConversations.unshift(conv);
      }
      void model;
      const userMsg: AiMessage = { id: uid("msg"), role: "user", content: message, createdAt: now() };
      conv.messages.push(userMsg);
      const res = runDemoAssistant(s.dataset(), message);
      const actionIds: string[] = [];
      for (const e of res.effects) {
        if (e.type === "create_invoice_draft") {
          const n = s.state.invoices.length + 1001;
          s.state.invoices.unshift({ ...e.invoice, source: "demo", id: uid("inv"), orgId, number: `${s.state.org.settings.invoicePrefix}${n + 200}`, createdAt: now(), updatedAt: now(), archivedAt: null });
          s.emit("invoices");
        } else if (e.type === "approval") {
          const a: ApprovalRequest = { ...e.approval, id: uid("apr"), orgId, status: "pending", requestedBy: "ai", conversationId: conv.id, createdAt: now() };
          s.state.approvals.unshift(a);
          actionIds.push(a.id);
          s.emit("approvals");
        }
      }
      conv.messages.push({
        id: uid("msg"),
        role: "assistant",
        content: res.content,
        createdAt: now(),
        toolCalls: res.toolCalls,
        charts: res.charts,
        actionIds,
        usage: { promptTokens: 0, completionTokens: 0, model: "simulated-demo" },
      });
      conv.updatedAt = now();
      s.emit("aiConversations");
      return { conversationId: conv.id };
    },

    async decideApproval(id, approve) {
      const a = s.state.approvals.find((x) => x.id === id);
      if (!a || a.status !== "pending") return { ok: false, message: "This request is no longer pending" };
      a.decidedAt = now();
      a.decidedBy = actorName;
      if (!approve) {
        a.status = "rejected";
        s.emit("approvals");
        log("Rejected action", a.title);
        return { ok: true, message: "Request rejected. Nothing was executed." };
      }
      let result: ActionResult;
      const p = a.payload as any;
      switch (a.kind) {
        case "send_email":
          result = await repo.sendEmail({ to: p.to, toName: p.toName, subject: p.subject, body: p.body, template: p.template ?? "customer", relatedType: p.relatedType, relatedId: p.relatedId });
          break;
        case "create_payment_link": {
          const l = await repo.createPaymentLink({ amount: p.amount, currency: p.currency, description: p.description, customerId: p.customerId });
          result = { ok: true, simulated: true, message: `Sample payment link created: ${l.url}` };
          break;
        }
        case "send_invoice":
          result = await repo.sendInvoice(p.invoiceId);
          break;
        case "refund":
          result = await repo.refund(p.transactionId, p.amount, p.reason ?? "Approved refund");
          break;
        case "capture":
          result = await repo.capture(p.transactionId);
          break;
        default:
          result = { ok: true, simulated: true, message: "Simulated." };
      }
      a.status = result.ok ? "executed" : "failed";
      a.result = result.message;
      if (a.automationRunId) {
        const run = s.state.automationRuns.find((r) => r.id === a.automationRunId);
        if (run) {
          run.steps = run.steps.map((st) => (st.status === "pending_approval" ? { ...st, status: result.ok ? "simulated" : "failed", detail: result.message } : st));
          run.status = result.ok ? "success" : "failed";
          s.emit("automationRuns");
        }
      }
      s.emit("approvals");
      log(`Approved: ${a.title}`, a.kind, result.message);
      return result;
    },

    async runAutomation(automationId, { test }) {
      const a = s.state.automations.find((x) => x.id === automationId);
      if (!a) throw new Error("Automation not found");
      return execute(a.id, sampleEvent(a.trigger.type), test, `Manual ${test ? "test" : "run"} with sample event`);
    },

    async retryAutomationRun(runId) {
      const prev = s.state.automationRuns.find((r) => r.id === runId);
      if (!prev) throw new Error("Run not found");
      const a = s.state.automations.find((x) => x.id === prev.automationId);
      if (!a) throw new Error("Automation was deleted");
      // Retry with the original event; seeded sample runs have none, so fall back to a sample event.
      const ev = prev.event ?? sampleEvent(a.trigger.type);
      const run = await execute(a.id, ev, false, `Retry of ${prev.triggerSummary}`, prev.attempt + 1);
      return run;
    },

    async fireTrigger(type, payload) {
      await fire(type, payload);
    },

    async resetDemo() {
      s.reset();
    },

    async simulatePayment() {
      const org = s.state.org;
      const c = s.state.customers[Math.floor(Math.random() * s.state.customers.length)];
      const big = Math.random() < 0.35;
      const gross = big ? Math.max(org.settings.largeTransactionThreshold + 50000, 650000) : 18000 + Math.round(Math.random() * 90000);
      const fee = Math.round(gross * 0.0349 + 49);
      const t: Transaction = {
        id: uid("tx"), orgId, source: "demo", externalId: `DEMO-SIM-${Date.now().toString(36).toUpperCase()}`, type: "payment", status: "completed", date: now(),
        description: "Simulated incoming payment", customerId: c?.id, customerName: c?.name ?? "Sample payer", customerEmail: c?.email, currency: org.reportingCurrency,
        gross, fee, net: gross - fee, paymentMethod: "paypal", refundedAmount: 0, refunds: [], createdAt: now(), updatedAt: now(), archivedAt: null,
      };
      s.state.transactions.unshift(t);
      s.emit("transactions");
      notify({ category: "payment", severity: "success", title: `Payment received — ${t.customerName}`, body: `${formatMoney(gross, t.currency)} (simulated)`, link: `/transactions?open=${t.id}` });
      const ev = { amount: gross / 100, amountFormatted: formatMoney(gross, t.currency), customerName: t.customerName, customerEmail: t.customerEmail ?? "", currency: t.currency, paymentMethod: "paypal", orgName: org.name };
      await fire("payment_received", ev);
      if (gross >= org.settings.largeTransactionThreshold) await fire("large_transaction", ev);
      return t;
    },
  };

  /** Sample-rate conversion so demo reports stay consistent; flagged as estimated for today's date. */
  function withExpenseFx<T extends { amount: number; currency: string; date: string; reporting?: unknown }>(e: T): T {
    const rc = s.state.org.reportingCurrency;
    if (e.currency === rc) return { ...e, reporting: undefined };
    const r = demoRate(e.currency, rc, e.date);
    return { ...e, reporting: { currency: rc, amount: convertMinor(e.amount, e.currency, rc, r.rate), rate: r.rate, estimated: r.estimated, provider: r.provider } };
  }

  function sampleEvent(type: TriggerType): EventPayload {
    const c = s.state.customers[0];
    const inv = s.state.invoices.find((i) => i.status === "overdue") ?? s.state.invoices[0];
    const cur = s.state.org.reportingCurrency;
    const base: EventPayload = { customerName: c.name, customerEmail: c.email, email: c.email, company: c.company ?? "", orgName: s.state.org.name };
    switch (type) {
      case "payment_received":
      case "large_transaction":
        return { ...base, amount: 640000 / 100, amountFormatted: formatMoney(640000, cur), currency: cur, paymentMethod: "paypal" };
      case "payment_failed":
        return { ...base, amount: 24000 / 100, amountFormatted: formatMoney(24000, cur), failureReason: "INSTRUMENT_DECLINED" };
      case "invoice_overdue":
        return { ...base, customerName: inv.customerName, customerEmail: inv.customerEmail, invoiceNumber: inv.number, balance: inv.totals.balance / 100, balanceFormatted: formatMoney(inv.totals.balance, inv.currency), daysOverdue: 9 };
      case "subscription_renewal":
        return { ...base, amount: 249, daysUntil: 3 };
      case "daily_briefing":
        return { ...base, weekday: new Date().toLocaleDateString("en-US", { weekday: "short" }) };
      default:
        return base;
    }
  }

  async function fire(type: TriggerType, ev: EventPayload) {
    for (const a of s.state.automations.filter((x) => x.enabled && !x.archivedAt && x.trigger.type === type)) {
      if (!evaluateConditions(a.conditions, ev)) continue;
      await execute(a.id, ev, a.testMode, `${type.replace(/_/g, " ")}: ${ev.customerName ?? ""}`);
    }
  }

  async function execute(automationId: string, ev: EventPayload, test: boolean, summary: string, attempt = 1): Promise<AutomationRun> {
    const a = s.state.automations.find((x) => x.id === automationId)!;
    const runId = uid("run");
    const conditionsMet = evaluateConditions(a.conditions, ev);
    const steps = conditionsMet ? planAutomation(a, ev, test) : [];
    if (!test) {
      for (const st of steps) {
        const e = st.effect;
        if (!e || st.status === "failed") continue;
        if (e.type === "notification") notify({ category: e.category, severity: e.severity, title: e.title, body: e.body, link: "/automations" });
        else if (e.type === "task") {
          s.state.tasks.unshift({ id: uid("task"), orgId, title: e.title, description: `Created by automation “${a.name}”`, status: "open", source: "automation", dueDate: addDays(todayKey(s.state.org.timezone), e.dueInDays), createdAt: now(), updatedAt: now(), archivedAt: null });
          s.emit("tasks");
        } else if (e.type === "email_draft") {
          st.detail = `Draft saved for ${e.to}: “${e.subject}”`;
        } else if (e.type === "approval_email") {
          s.state.approvals.unshift({ id: uid("apr"), orgId, kind: "send_email", title: `Send email to ${e.to}`, description: `Requested by automation “${a.name}”`, payload: { to: e.to, subject: e.subject, body: e.body, template: "automation" }, status: "pending", requestedBy: "automation", automationRunId: runId, createdAt: now() });
          s.emit("approvals");
        } else if (e.type === "ai_report") {
          const d = toolByName("get_daily_briefing")!.run(s.dataset(), {}).data as any;
          notify({ category: "ai_insight", severity: "info", title: `Briefing · ${d.date}`, body: `Last 7 days: ${d.last7Days.gross} gross, ${d.last7Days.net} net. ${d.overdueCount} overdue invoice(s).`, link: "/assistant" });
        }
      }
      if (steps.some((x) => x.status === "failed")) notify({ category: "automation_error", severity: "error", title: `Automation step failed: ${a.name}`, body: steps.find((x) => x.status === "failed")!.detail, link: "/automations" });
    }
    const run: AutomationRun = {
      id: runId,
      orgId,
      automationId,
      automationName: a.name,
      triggeredAt: now(),
      triggerSummary: conditionsMet ? summary : `${summary} — conditions not met`,
      status: conditionsMet ? runStatus(steps, test) : "skipped",
      steps: steps.map(({ effect: _e, ...rest }) => rest),
      error: steps.find((x) => x.status === "failed")?.detail,
      attempt,
      test,
      event: ev,
    };
    s.state.automationRuns.unshift(run);
    a.lastRunAt = run.triggeredAt;
    a.runCount++;
    if (run.status === "failed" || run.status === "partial") a.errorCount++;
    s.emit("automationRuns");
    s.emit("automations");
    return run;
  }

  return repo;
}

const demoBlobs = new Map<string, string>();
