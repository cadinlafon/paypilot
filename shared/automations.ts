import type { AutomationActionType, AutomationCondition, ConditionOperator, TriggerType } from "./types";

export interface TriggerDef {
  type: TriggerType;
  label: string;
  description: string;
  /** Fields of the event payload that conditions can reference. */
  fields: { key: string; label: string; kind: "money" | "number" | "text" }[];
  configFields?: { key: string; label: string; placeholder?: string }[];
}

export const TRIGGERS: TriggerDef[] = [
  {
    type: "payment_received",
    label: "Payment received",
    description: "A payment settles successfully.",
    fields: [
      { key: "amount", label: "Amount (reporting currency)", kind: "money" },
      { key: "currency", label: "Original currency", kind: "text" },
      { key: "customerName", label: "Customer name", kind: "text" },
      { key: "paymentMethod", label: "Payment method", kind: "text" },
    ],
  },
  {
    type: "invoice_overdue",
    label: "Invoice overdue",
    description: "An invoice passes its due date with a balance remaining.",
    fields: [
      { key: "balance", label: "Balance due", kind: "money" },
      { key: "daysOverdue", label: "Days overdue", kind: "number" },
      { key: "customerName", label: "Customer name", kind: "text" },
    ],
  },
  {
    type: "new_customer",
    label: "New customer",
    description: "A customer record is created.",
    fields: [
      { key: "customerName", label: "Customer name", kind: "text" },
      { key: "company", label: "Company", kind: "text" },
      { key: "email", label: "Email", kind: "text" },
    ],
  },
  {
    type: "large_transaction",
    label: "Large transaction detected",
    description: "A payment exceeds the organization's large-transaction threshold.",
    fields: [
      { key: "amount", label: "Amount (reporting currency)", kind: "money" },
      { key: "customerName", label: "Customer name", kind: "text" },
    ],
  },
  {
    type: "daily_briefing",
    label: "Daily business briefing",
    description: "Runs once each morning in the organization's timezone.",
    fields: [{ key: "weekday", label: "Weekday (Mon…Sun)", kind: "text" }],
    configFields: [{ key: "hour", label: "Hour (0–23, org timezone)", placeholder: "8" }],
  },
  {
    type: "payment_failed",
    label: "Payment failed",
    description: "A payment is declined, denied or fails.",
    fields: [
      { key: "amount", label: "Amount (reporting currency)", kind: "money" },
      { key: "failureReason", label: "Failure reason", kind: "text" },
      { key: "customerName", label: "Customer name", kind: "text" },
    ],
  },
  {
    type: "subscription_renewal",
    label: "Subscription renewal approaching",
    description: "A subscription renews within the configured number of days.",
    fields: [
      { key: "amount", label: "Renewal amount", kind: "money" },
      { key: "daysUntil", label: "Days until renewal", kind: "number" },
      { key: "customerName", label: "Customer name", kind: "text" },
    ],
    configFields: [{ key: "daysBefore", label: "Days before renewal", placeholder: "3" }],
  },
];

export interface ActionDef {
  type: AutomationActionType;
  label: string;
  description: string;
  /** External actions are never executed without an explicit human approval. */
  external: boolean;
  configFields: { key: string; label: string; placeholder?: string; multiline?: boolean }[];
}

export const ACTIONS: ActionDef[] = [
  {
    type: "create_notification",
    label: "Create notification",
    description: "Posts to the in-app notification center.",
    external: false,
    configFields: [
      { key: "title", label: "Title", placeholder: "Payment from {{customerName}}" },
      { key: "body", label: "Message", placeholder: "{{amount}} received", multiline: true },
    ],
  },
  {
    type: "draft_email",
    label: "Draft email",
    description: "Creates an email draft for review. Nothing is sent.",
    external: false,
    configFields: [
      { key: "to", label: "To", placeholder: "{{customerEmail}}" },
      { key: "subject", label: "Subject", placeholder: "Thank you for your payment" },
      { key: "body", label: "Body", multiline: true },
    ],
  },
  {
    type: "send_email",
    label: "Send approved email",
    description: "Queues an email for approval; sends via EmailJS only once approved.",
    external: true,
    configFields: [
      { key: "to", label: "To", placeholder: "{{customerEmail}}" },
      { key: "subject", label: "Subject" },
      { key: "body", label: "Body", multiline: true },
    ],
  },
  {
    type: "create_task",
    label: "Create internal task",
    description: "Adds a task for your team.",
    external: false,
    configFields: [
      { key: "title", label: "Task title", placeholder: "Follow up with {{customerName}}" },
      { key: "dueInDays", label: "Due in (days)", placeholder: "2" },
    ],
  },
  {
    type: "generate_ai_report",
    label: "Generate AI report",
    description: "Builds a written summary of recent activity.",
    external: false,
    configFields: [{ key: "period", label: "Period (7d, 30d, mtd)", placeholder: "7d" }],
  },
  {
    type: "notify_admin",
    label: "Notify an administrator",
    description: "High-priority notification for owners and admins.",
    external: false,
    configFields: [{ key: "message", label: "Message", multiline: true }],
  },
];

export const OPERATORS: { id: ConditionOperator; label: string }[] = [
  { id: "gt", label: "is greater than" },
  { id: "gte", label: "is at least" },
  { id: "lt", label: "is less than" },
  { id: "lte", label: "is at most" },
  { id: "eq", label: "equals" },
  { id: "neq", label: "does not equal" },
  { id: "contains", label: "contains" },
];

export type EventPayload = Record<string, string | number | undefined>;

export function evaluateCondition(c: AutomationCondition, ev: EventPayload): boolean {
  const raw = ev[c.field];
  if (raw === undefined) return false;
  const num = typeof raw === "number" ? raw : Number(raw);
  const target = Number(c.value);
  const numeric = !Number.isNaN(num) && !Number.isNaN(target) && c.value.trim() !== "";
  switch (c.operator) {
    case "gt":
      return numeric && num > target;
    case "gte":
      return numeric && num >= target;
    case "lt":
      return numeric && num < target;
    case "lte":
      return numeric && num <= target;
    case "eq":
      return numeric ? num === target : String(raw).toLowerCase() === c.value.toLowerCase();
    case "neq":
      return numeric ? num !== target : String(raw).toLowerCase() !== c.value.toLowerCase();
    case "contains":
      return String(raw).toLowerCase().includes(c.value.toLowerCase());
  }
}

export function evaluateConditions(conds: AutomationCondition[], ev: EventPayload): boolean {
  return conds.every((c) => evaluateCondition(c, ev));
}

/** Replace {{field}} placeholders from the event payload. Unknown fields become empty strings. */
export function renderTemplate(tpl: string, ev: EventPayload): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => (ev[k] === undefined ? "" : String(ev[k])));
}

export type AutomationEffect =
  | { type: "notification"; category: "automation_error" | "ai_insight" | "payment" | "invoice_overdue" | "payment_failed" | "customer" | "subscription"; severity: "info" | "success" | "warning" | "error"; title: string; body: string; adminOnly?: boolean }
  | { type: "task"; title: string; dueInDays: number }
  | { type: "email_draft"; to: string; subject: string; body: string }
  | { type: "approval_email"; to: string; subject: string; body: string }
  | { type: "ai_report"; period: string };

export interface PlannedStep {
  actionId: string;
  type: AutomationActionType;
  status: "success" | "failed" | "pending_approval" | "simulated";
  detail: string;
  effect?: AutomationEffect;
}

const TRIGGER_CATEGORY: Record<TriggerType, "payment" | "invoice_overdue" | "customer" | "payment_failed" | "subscription" | "ai_insight"> = {
  payment_received: "payment",
  invoice_overdue: "invoice_overdue",
  new_customer: "customer",
  large_transaction: "payment",
  daily_briefing: "ai_insight",
  payment_failed: "payment_failed",
  subscription_renewal: "subscription",
};

/**
 * Pure planning step shared by the browser (Demo) and Cloud Functions (Real).
 * Returns what each action WOULD do. External actions become approval
 * requests — they are never executed directly. In test mode nothing is
 * persisted except the run record.
 */
export function planAutomation(
  a: { trigger: { type: TriggerType }; actions: { id: string; type: AutomationActionType; config: Record<string, string> }[] },
  ev: EventPayload,
  test: boolean,
): PlannedStep[] {
  return a.actions.map((act) => {
    const c = (k: string) => renderTemplate(act.config[k] ?? "", ev).trim();
    const missing = (fields: string[]) => fields.filter((f) => /\{\{/.test(act.config[f] ?? "") && !c(f));
    try {
      switch (act.type) {
        case "create_notification": {
          const title = c("title") || "Automation notification";
          return { actionId: act.id, type: act.type, status: test ? "simulated" : "success", detail: `Notification “${title}”`, effect: { type: "notification", category: TRIGGER_CATEGORY[a.trigger.type], severity: "info", title, body: c("body") } };
        }
        case "notify_admin": {
          const msg = c("message") || "Automation alert";
          return { actionId: act.id, type: act.type, status: test ? "simulated" : "success", detail: "Administrators notified", effect: { type: "notification", category: TRIGGER_CATEGORY[a.trigger.type], severity: "warning", title: "Admin alert", body: msg, adminOnly: true } };
        }
        case "create_task": {
          const title = c("title") || "Follow up";
          return { actionId: act.id, type: act.type, status: test ? "simulated" : "success", detail: `Task “${title}”`, effect: { type: "task", title, dueInDays: Number(c("dueInDays")) || 1 } };
        }
        case "draft_email":
        case "send_email": {
          const miss = missing(["to"]);
          const to = c("to");
          if (miss.length || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
            return { actionId: act.id, type: act.type, status: "failed", detail: `Recipient is empty or invalid (${act.config.to || "no “to” set"})` };
          }
          const subject = c("subject") || "(no subject)";
          const body = c("body");
          if (act.type === "draft_email") return { actionId: act.id, type: act.type, status: test ? "simulated" : "success", detail: `Draft to ${to}`, effect: { type: "email_draft", to, subject, body } };
          return {
            actionId: act.id,
            type: act.type,
            status: test ? "simulated" : "pending_approval",
            detail: test ? `Would request approval to email ${to}` : `Approval requested to email ${to}`,
            effect: { type: "approval_email", to, subject, body },
          };
        }
        case "generate_ai_report":
          return { actionId: act.id, type: act.type, status: test ? "simulated" : "success", detail: `Report for ${c("period") || "7d"}`, effect: { type: "ai_report", period: c("period") || "7d" } };
      }
    } catch (e) {
      return { actionId: act.id, type: act.type, status: "failed", detail: (e as Error).message };
    }
  });
}

export function runStatus(steps: PlannedStep[], test: boolean): "success" | "failed" | "partial" | "pending_approval" | "test" {
  if (test) return "test";
  const failed = steps.filter((s) => s.status === "failed").length;
  if (failed === steps.length && failed) return "failed";
  if (failed) return "partial";
  if (steps.some((s) => s.status === "pending_approval")) return "pending_approval";
  return "success";
}

export function triggerDef(t: TriggerType): TriggerDef {
  return TRIGGERS.find((x) => x.type === t)!;
}
export function actionDef(t: AutomationActionType): ActionDef {
  return ACTIONS.find((x) => x.type === t)!;
}
