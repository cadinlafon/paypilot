/**
 * Automation engine (Real Mode). Triggers come from Firestore events and a
 * scheduler. Steps are planned by the shared `planAutomation`; external steps
 * become approval requests and are never executed here.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import type { Automation, AutomationRun, Customer, Organization, Transaction, TriggerType } from "../../../shared/types";
import { evaluateConditions, planAutomation, runStatus, type EventPayload } from "../../../shared/automations";
import { toolByName } from "../../../shared/aiTools";
import { outstandingInvoices, upcomingRenewals } from "../../../shared/analytics";
import { formatMoney, txReporting, deriveInvoiceStatus } from "../../../shared/money";
import { addDays, todayKey } from "../../../shared/dates";
import { db, orgCol, orgRef, nowIso } from "../lib/admin";
import { requireMember, str, safeError, ID } from "../lib/guard";
import { remaining, rotate, saveCursor } from "../lib/budget";
import { notify } from "../lib/audit";
import { loadDataset } from "../lib/dataset";

async function execute(orgId: string, a: Automation, ev: EventPayload, test: boolean, summary: string, attempt = 1): Promise<AutomationRun> {
  const org = (await orgRef(orgId).get()).data() as Organization;
  const prefs = org.settings.notifications.categories;
  const runRef = orgCol(orgId, "automationRuns").doc();
  const met = evaluateConditions(a.conditions, ev);
  const steps = met ? planAutomation(a, ev, test) : [];
  if (!test) {
    for (const st of steps) {
      const e = st.effect;
      if (!e || st.status === "failed") continue;
      try {
        if (e.type === "notification") await notify(orgId, { category: e.category, severity: e.severity, title: e.title, body: e.body, link: "/automations" }, prefs);
        else if (e.type === "task") await orgCol(orgId, "tasks").add({ orgId, title: e.title, description: `Created by automation “${a.name}”`, status: "open", source: "automation", dueDate: addDays(todayKey(org.timezone), e.dueInDays), createdAt: nowIso(), updatedAt: nowIso(), archivedAt: null });
        else if (e.type === "email_draft") st.detail = `Draft for ${e.to}: “${e.subject}” (saved in run log, not sent)`;
        else if (e.type === "approval_email") await orgCol(orgId, "aiActions").add({ orgId, kind: "send_email", title: `Send email to ${e.to}`, description: `Requested by automation “${a.name}”`, payload: { to: e.to, subject: e.subject, body: e.body, template: "automation" }, status: "pending", requestedBy: "automation", automationRunId: runRef.id, createdAt: nowIso() });
        else if (e.type === "ai_report") {
          const ds = await loadDataset(orgId);
          const d = toolByName("get_daily_briefing")!.run(ds, {}).data as any;
          await notify(orgId, { category: "ai_insight", severity: "info", title: `Briefing · ${d.date}`, body: `Last 7 days: ${d.last7Days.gross} gross, ${d.last7Days.net} net, ${d.last7Days.expenses} expenses. ${d.overdueCount} overdue invoice(s).`, link: "/assistant" }, prefs);
        }
      } catch (err) {
        st.status = "failed";
        st.detail = (err as Error).message.slice(0, 200);
      }
    }
    const failed = steps.find((s) => s.status === "failed");
    if (failed) await notify(orgId, { category: "automation_error", severity: "error", title: `Automation step failed: ${a.name}`, body: failed.detail, link: "/automations" }, prefs);
  }
  const run: AutomationRun = {
    id: runRef.id, orgId, automationId: a.id, automationName: a.name, triggeredAt: nowIso(), triggerSummary: met ? summary : `${summary} — conditions not met`,
    status: met ? runStatus(steps, test) : "skipped", steps: steps.map(({ effect: _e, ...s }) => s), error: steps.find((s) => s.status === "failed")?.detail, attempt, test, event: ev,
  };
  await runRef.set(run);
  await orgCol(orgId, "automations").doc(a.id).update({ lastRunAt: run.triggeredAt, runCount: (a.runCount ?? 0) + 1, errorCount: (a.errorCount ?? 0) + (run.status === "failed" || run.status === "partial" ? 1 : 0) });
  return run;
}

/** Enabled automations for an org, read once per invocation. */
const autoCache = new Map<string, Promise<Automation[]>>();
function automationsFor(orgId: string): Promise<Automation[]> {
  let p = autoCache.get(orgId);
  if (!p) {
    p = orgCol(orgId, "automations").where("enabled", "==", true).limit(100).get().then((s) => s.docs.map((d) => ({ ...(d.data() as Automation), id: d.id })));
    autoCache.set(orgId, p);
    setTimeout(() => autoCache.delete(orgId), 30_000);
  }
  return p;
}

async function fire(orgId: string, type: TriggerType, ev: EventPayload, summary: string) {
  for (const a of (await automationsFor(orgId)).filter((x) => x.trigger.type === type)) {
    if (remaining() < 6) break;
    if (a.archivedAt) continue;
    if (!evaluateConditions(a.conditions, ev)) continue;
    await execute(orgId, a, ev, a.testMode, summary).catch((e) => console.error("automation", a.id, e));
  }
}

export const onTransactionWritten = onDocumentWritten("organizations/{orgId}/transactions/{id}", async (event) => {
  const before = event.data?.before?.data() as Transaction | undefined;
  const after = event.data?.after?.data() as Transaction | undefined;
  if (!after || after.type === "purchase" || after.type === "authorization") return;
  const { orgId } = event.params;
  const org = (await orgRef(orgId).get()).data() as Organization;
  const rep = txReporting(after, org.reportingCurrency);
  const ev: EventPayload = { amount: rep.gross / 100, amountFormatted: formatMoney(after.gross, after.currency), currency: after.currency, customerName: after.customerName, customerEmail: after.customerEmail ?? "", paymentMethod: after.paymentMethod, failureReason: after.failureReason ?? "", orgName: org.name };
  const becameCompleted = after.status === "completed" && before?.status !== "completed";
  const becameFailed = (after.status === "failed" || after.status === "denied") && before?.status !== after.status;
  if (becameCompleted) {
    await notify(orgId, { category: "payment", severity: "success", title: `Payment received — ${after.customerName}`, body: formatMoney(after.gross, after.currency), link: `/transactions?open=${event.params.id}` }, org.settings.notifications.categories);
    await fire(orgId, "payment_received", ev, `${after.customerName} paid ${ev.amountFormatted}`);
    if (rep.available && rep.gross >= org.settings.largeTransactionThreshold) await fire(orgId, "large_transaction", ev, `Large payment: ${ev.amountFormatted}`);
  }
  if (becameFailed) {
    await notify(orgId, { category: "payment_failed", severity: "error", title: `Payment failed — ${after.customerName}`, body: `${formatMoney(after.gross, after.currency)} · ${after.failureReason ?? after.status}`, link: `/transactions?open=${event.params.id}` }, org.settings.notifications.categories);
    await fire(orgId, "payment_failed", ev, `${after.customerName} — payment ${after.status}`);
  }
});

export const onCustomerCreated = onDocumentCreated("organizations/{orgId}/customers/{id}", async (event) => {
  const c = event.data?.data() as Customer | undefined;
  if (!c) return;
  const org = (await orgRef(event.params.orgId).get()).data() as Organization;
  await notify(event.params.orgId, { category: "customer", severity: "info", title: `New customer: ${c.name}`, body: c.company ?? c.email, link: `/customers/${event.params.id}` }, org.settings.notifications.categories);
  await fire(event.params.orgId, "new_customer", { customerName: c.name, company: c.company ?? "", email: c.email, customerEmail: c.email, orgName: org.name }, `New customer ${c.name}`);
});

/**
 * Hourly: per organization in its own timezone — refresh invoice statuses,
 * fire overdue + renewal triggers once per day, and the morning briefing at
 * the configured hour.
 */
export const automationScheduler = onSchedule({ schedule: "every 60 minutes", timeoutSeconds: 540, memory: "512MiB" }, async () => {
  const orgs = await db.collection("organizations").get();
  const byId = new Map(orgs.docs.map((o) => [o.id, o]));
  for (const id of await rotate("scheduler", [...byId.keys()])) {
    if (remaining() < 20) break;
    await saveCursor("scheduler", id);
    const o = byId.get(id)!;
    const org = { ...(o.data() as Organization), id: o.id };
    const hour = Number(new Date().toLocaleString("en-US", { timeZone: org.timezone, hour: "numeric", hourCycle: "h23" }));
    const today = todayKey(org.timezone);
    const marker = orgCol(o.id, "analytics").doc(`scheduler_${today}`);
    const done = ((await marker.get()).data() ?? {}) as Record<string, boolean>;
    try {
      if (!done.daily && hour >= 6) {
        const ds = await loadDataset(o.id);
        const batch = db.batch();
        let changed = 0;
        for (const inv of ds.invoices) {
          const s = deriveInvoiceStatus(inv, today);
          if (s !== inv.status && !inv.archivedAt && changed < 400) {
            batch.update(orgCol(o.id, "invoices").doc(inv.id), { status: s, updatedAt: nowIso() });
            changed++;
          }
        }
        if (changed) await batch.commit();
        for (const inv of outstandingInvoices(ds).filter((i) => i.daysOverdue > 0)) {
          if (inv.daysOverdue === 1) await notify(o.id, { category: "invoice_overdue", severity: "warning", title: `Invoice ${inv.number} is overdue`, body: `${inv.customerName} · ${formatMoney(inv.totals.balance, inv.currency)}`, link: `/invoices?open=${inv.id}` }, org.settings.notifications.categories);
          await fire(o.id, "invoice_overdue", { customerName: inv.customerName, customerEmail: inv.customerEmail, invoiceNumber: inv.number, balance: inv.totals.balance / 100, balanceFormatted: formatMoney(inv.totals.balance, inv.currency), daysOverdue: inv.daysOverdue, orgName: org.name }, `${inv.number} is ${inv.daysOverdue} day(s) overdue`);
        }
        for (const a of (await automationsFor(o.id)).filter((x) => x.trigger.type === "subscription_renewal")) {
          const daysBefore = Number(a.trigger.config.daysBefore) || 3;
          for (const s of upcomingRenewals(ds, daysBefore).filter((r) => r.inDays === daysBefore)) {
            const ev = { customerName: s.customerName, amount: s.amount / 100, amountFormatted: formatMoney(s.amount, s.currency), daysUntil: s.inDays, orgName: org.name };
            if (evaluateConditions(a.conditions, ev)) await execute(o.id, a, ev, a.testMode, `${s.customerName} renews in ${s.inDays} day(s)`);
          }
        }
        done.daily = true;
      }
      for (const a of (await automationsFor(o.id)).filter((x) => x.trigger.type === "daily_briefing")) {
        const at = Number(a.trigger.config.hour ?? 8);
        if (hour === at && !done[`brief_${a.id}`]) {
          await execute(o.id, a, { weekday: new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: org.timezone }), orgName: org.name }, a.testMode, `Daily briefing for ${today}`);
          done[`brief_${a.id}`] = true;
        }
      }
      await marker.set(done, { merge: true });
    } catch (e) {
      console.error("scheduler", o.id, e);
    }
  }
});

function sample(type: TriggerType, org: Organization): EventPayload {
  const base = { customerName: "Sample Customer", customerEmail: "", email: "", company: "Sample Co", orgName: org.name };
  return { ...base, amount: 250, amountFormatted: formatMoney(25000, org.reportingCurrency), currency: org.reportingCurrency, invoiceNumber: "INV-SAMPLE", balance: 250, balanceFormatted: formatMoney(25000, org.reportingCurrency), daysOverdue: 7, daysUntil: 3, failureReason: "INSTRUMENT_DECLINED", paymentMethod: "paypal", weekday: "Mon", ...(type === "new_customer" ? {} : {}) };
}

export const runAutomation = onCall(async (req) => {
  try {
    const c = await requireMember(req, "automations.configure");
    const id = str(req.data?.automationId, "Automation", { pattern: ID });
    const s = await orgCol(c.orgId, "automations").doc(id).get();
    if (!s.exists) throw new HttpsError("not-found", "Automation not found.");
    const a = { ...(s.data() as Automation), id };
    const org = (await orgRef(c.orgId).get()).data() as Organization;
    // Manual runs use a sample event. Non-test manual runs still only create approval requests for external steps.
    return await execute(c.orgId, a, sample(a.trigger.type, org), req.data?.test !== false, `Manual ${req.data?.test !== false ? "test" : "run"} by ${c.email}`);
  } catch (e) {
    throw safeError(e);
  }
});

export const retryAutomationRun = onCall(async (req) => {
  try {
    const c = await requireMember(req, "automations.configure");
    const runId = str(req.data?.runId, "Run", { pattern: ID });
    const prev = (await orgCol(c.orgId, "automationRuns").doc(runId).get()).data() as AutomationRun | undefined;
    if (!prev) throw new HttpsError("not-found", "Run not found.");
    const s = await orgCol(c.orgId, "automations").doc(prev.automationId).get();
    if (!s.exists) throw new HttpsError("not-found", "Automation no longer exists.");
    const org = (await orgRef(c.orgId).get()).data() as Organization;
    const a = { ...(s.data() as Automation), id: s.id };
    return await execute(c.orgId, a, prev.event ?? sample(a.trigger.type, org), false, `Retry of “${prev.triggerSummary}”`, prev.attempt + 1);
  } catch (e) {
    throw safeError(e);
  }
});
