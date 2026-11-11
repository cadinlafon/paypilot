/**
 * PayPilot domain model — shared by the web app and Cloud Functions.
 *
 * Money convention: every `amount`-like field is an INTEGER in the currency's
 * minor unit (cents for USD, yen for JPY). Never store floats for money.
 * Dates are ISO-8601 strings (UTC). Organization-local presentation uses the
 * organization's IANA timezone.
 */

export type AppMode = "demo" | "real";
export type PayPalEnvironment = "sandbox" | "live";
export type PayPalConnectionState = "not_connected" | "sandbox" | "live";
export type CurrencyCode = string;
export type ISODate = string;

export interface Timestamps {
  createdAt: ISODate;
  updatedAt: ISODate;
  /** Soft-delete marker. Records are archived, not hard-deleted. */
  archivedAt?: ISODate | null;
}

/** Where a record came from. Demo records never leave the browser. */
export type RecordSource = "demo" | "manual" | "paypal";

// ─── Organizations, members, roles ──────────────────────────────────────────

export type SyncInterval = "15m" | "30m" | "1h" | "6h" | "24h" | "manual";

export interface NotificationPrefs {
  categories: Record<NotificationCategory, boolean>;
  emailDigest: "off" | "daily" | "weekly";
}

export interface OrgSettings {
  syncInterval: SyncInterval;
  ai: { enabled: boolean; model: string; monthlyTokenBudget: number };
  notifications: NotificationPrefs;
  invoicePrefix: string;
  defaultPaymentTermsDays: number;
  largeTransactionThreshold: number; // minor units, reporting currency
  dashboardLayout?: string[];
}

export interface Organization {
  id: string;
  name: string;
  businessType: string;
  industry: string;
  country: string;
  email?: string;
  website?: string;
  address?: string;
  reportingCurrency: CurrencyCode;
  timezone: string;
  ownerId: string;
  settings: OrgSettings;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type Permission =
  | "transactions.view"
  | "transactions.refund"
  | "transactions.capture"
  | "invoices.view"
  | "invoices.edit"
  | "invoices.send"
  | "customers.view"
  | "customers.edit"
  | "products.view"
  | "products.edit"
  | "subscriptions.view"
  | "subscriptions.edit"
  | "expenses.view"
  | "expenses.edit"
  | "paymentLinks.view"
  | "paymentLinks.create"
  | "reports.view"
  | "automations.view"
  | "automations.configure"
  | "notifications.view"
  | "ai.use"
  | "files.upload"
  | "integrations.manage"
  | "users.manage"
  | "settings.manage";

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  system: boolean;
}

export interface Member {
  uid: string;
  email: string;
  displayName: string;
  roleId: string;
  /** Denormalized from the role by the server so security rules can check it. */
  permissions: Permission[];
  status: "active" | "invited" | "suspended";
  joinedAt: ISODate;
}

// ─── Multi-currency ─────────────────────────────────────────────────────────

export interface ConvertedAmount {
  currency: CurrencyCode;
  gross: number;
  fee: number;
  net: number;
  rate: number;
  rateTimestamp: ISODate;
  provider: string;
  /** True when no rate for the transaction date existed and a nearby/latest rate was used. */
  estimated: boolean;
}

export interface ExchangeRateSnapshot {
  id: string; // `${base}_${date}`
  base: CurrencyCode;
  date: string; // YYYY-MM-DD
  rates: Record<CurrencyCode, number>;
  provider: string;
  fetchedAt: ISODate;
}

// ─── Money records ──────────────────────────────────────────────────────────

/** `purchase` = money the business sent via PayPal (outgoing). Never counted as revenue. */
export type TransactionType = "payment" | "refund" | "authorization" | "subscription_payment" | "purchase";
export type TransactionStatus =
  | "completed"
  | "pending"
  | "failed"
  | "denied"
  | "refunded"
  | "partially_refunded"
  | "authorized"
  | "voided";
export type PaymentMethod = "paypal" | "card" | "venmo" | "pay_later" | "bank";

export interface RefundRecord {
  id: string;
  amount: number;
  date: ISODate;
  reason?: string;
  externalId?: string;
}

export interface Transaction extends Timestamps {
  id: string;
  orgId: string;
  source: RecordSource;
  environment?: PayPalEnvironment;
  externalId?: string;
  type: TransactionType;
  status: TransactionStatus;
  date: ISODate;
  description: string;
  customerId?: string;
  customerName: string;
  customerEmail?: string;
  /** Original amounts, never overwritten. */
  currency: CurrencyCode;
  gross: number;
  fee: number;
  net: number;
  reporting?: ConvertedAmount;
  paymentMethod: PaymentMethod;
  invoiceId?: string;
  subscriptionId?: string;
  productId?: string;
  paymentLinkId?: string;
  refundedAmount: number;
  refunds: RefundRecord[];
  failureReason?: string;
  /** PayPal authorization expiry when status = authorized. */
  authorizationExpiresAt?: ISODate;
}

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface Customer extends Timestamps {
  id: string;
  orgId: string;
  source: RecordSource;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  billingAddress?: Address;
  notes?: string;
  tags: string[];
}

export interface Product extends Timestamps {
  id: string;
  orgId: string;
  source: RecordSource;
  name: string;
  description: string;
  type: "product" | "service";
  price: number;
  currency: CurrencyCode;
  category: string;
  taxRate: number; // percent, e.g. 8.25
  taxCode?: string;
  active: boolean;
}

export interface InvoiceLine {
  id: string;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number; // percent
}

export type InvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";

export interface InvoicePayment {
  id: string;
  amount: number;
  date: ISODate;
  method: string;
  transactionId?: string;
}

export interface InvoiceHistoryEntry {
  at: ISODate;
  event: string;
  by: string;
}

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
}

export interface Invoice extends Timestamps {
  id: string;
  orgId: string;
  source: RecordSource;
  environment?: PayPalEnvironment;
  externalId?: string;
  number: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  status: InvoiceStatus;
  issueDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  currency: CurrencyCode;
  lines: InvoiceLine[];
  discount: { type: "percent" | "fixed"; value: number };
  notes: string;
  terms: string;
  paymentTermsDays: number;
  totals: InvoiceTotals;
  payments: InvoicePayment[];
  history: InvoiceHistoryEntry[];
  attachmentIds: string[];
  createdByAi?: boolean;
}

export type BillingInterval = "week" | "month" | "quarter" | "year";
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "paused" | "cancelled";

export interface Subscription extends Timestamps {
  id: string;
  orgId: string;
  source: RecordSource;
  environment?: PayPalEnvironment;
  externalId?: string;
  customerId: string;
  customerName: string;
  productId?: string;
  productName: string;
  amount: number;
  currency: CurrencyCode;
  interval: BillingInterval;
  startDate: string;
  nextBillingDate: string;
  status: SubscriptionStatus;
  paymentHistory: { date: string; amount: number; status: "paid" | "failed"; transactionId?: string }[];
}

export type ExpensePaymentSource = "manual" | "paypal" | "card" | "bank" | "cash";

export interface Expense extends Timestamps {
  id: string;
  orgId: string;
  source: RecordSource;
  name: string;
  amount: number;
  currency: CurrencyCode;
  reporting?: { currency: CurrencyCode; amount: number; rate: number; estimated: boolean; provider: string };
  date: string;
  category: string;
  vendor: string;
  description?: string;
  taxAmount: number;
  taxDeductible: boolean;
  paymentSource: ExpensePaymentSource;
  /**
   * When an expense corresponds to a PayPal transaction (e.g. a PayPal
   * purchase), link it here. Reports count the expense once and exclude the
   * linked transaction from revenue — no double counting.
   */
  linkedTransactionId?: string;
  receiptFileId?: string;
  notes?: string;
}

export type PaymentLinkStatus = "active" | "paid" | "expired" | "disabled";

export interface PaymentLink extends Timestamps {
  id: string;
  orgId: string;
  source: RecordSource;
  environment?: PayPalEnvironment;
  description: string;
  amount: number;
  currency: CurrencyCode;
  customerId?: string;
  customerName?: string;
  status: PaymentLinkStatus;
  url: string;
  /** Demo links are sample URLs that cannot accept money. */
  isSample: boolean;
  expiresAt?: ISODate;
  views: number;
  activity: { at: ISODate; event: string; detail?: string }[];
  paidTransactionId?: string;
}

// ─── Intelligence ───────────────────────────────────────────────────────────

export type NotificationCategory =
  | "payment"
  | "payment_failed"
  | "customer"
  | "invoice"
  | "invoice_overdue"
  | "subscription"
  | "automation_error"
  | "ai_insight"
  | "integration";

export interface AppNotification {
  id: string;
  orgId: string;
  category: NotificationCategory;
  severity: "info" | "success" | "warning" | "error";
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: ISODate;
}

export type TriggerType =
  | "payment_received"
  | "invoice_overdue"
  | "new_customer"
  | "large_transaction"
  | "daily_briefing"
  | "payment_failed"
  | "subscription_renewal";

export type ConditionOperator = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "contains";

export interface AutomationCondition {
  id: string;
  field: string;
  operator: ConditionOperator;
  value: string;
}

export type AutomationActionType =
  | "create_notification"
  | "draft_email"
  | "send_email"
  | "create_task"
  | "generate_ai_report"
  | "notify_admin";

export interface AutomationAction {
  id: string;
  type: AutomationActionType;
  config: Record<string, string>;
}

export interface Automation extends Timestamps {
  id: string;
  orgId: string;
  source: RecordSource;
  name: string;
  description: string;
  enabled: boolean;
  testMode: boolean;
  trigger: { type: TriggerType; config: Record<string, string> };
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  lastRunAt?: ISODate;
  runCount: number;
  errorCount: number;
}

export interface AutomationRunStep {
  actionId: string;
  type: AutomationActionType;
  status: "success" | "failed" | "skipped" | "pending_approval" | "simulated";
  detail: string;
}

export interface AutomationRun {
  id: string;
  orgId: string;
  automationId: string;
  automationName: string;
  triggeredAt: ISODate;
  triggerSummary: string;
  status: "success" | "failed" | "partial" | "pending_approval" | "test" | "skipped";
  steps: AutomationRunStep[];
  error?: string;
  attempt: number;
  test: boolean;
  /** The triggering event, kept so failed runs can be retried with the same data. */
  event?: Record<string, string | number | undefined>;
}

export interface InternalTask extends Timestamps {
  id: string;
  orgId: string;
  title: string;
  description: string;
  status: "open" | "done";
  source: "automation" | "ai" | "user";
  dueDate?: string;
}

// ─── AI ─────────────────────────────────────────────────────────────────────

export interface ChartSpec {
  type: "bar" | "line" | "area" | "pie";
  title: string;
  data: { label: string; value: number; value2?: number }[];
  valueFormat: "currency" | "number" | "percent";
  currency?: CurrencyCode;
  seriesNames?: [string, string?];
}

export interface AiToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  summary: string;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: ISODate;
  toolCalls?: AiToolCallTrace[];
  charts?: ChartSpec[];
  /** Approval requests created by this message (ids in aiActions). */
  actionIds?: string[];
  usage?: { promptTokens: number; completionTokens: number; model: string };
  error?: string;
}

export interface AiConversation {
  id: string;
  orgId: string;
  title: string;
  model: string;
  messages: AiMessage[];
  createdAt: ISODate;
  updatedAt: ISODate;
  createdBy: string;
}

export type ExternalActionKind =
  | "send_email"
  | "send_invoice"
  | "create_payment_link"
  | "refund"
  | "capture"
  | "trigger_automation";

export interface ApprovalRequest {
  id: string;
  orgId: string;
  kind: ExternalActionKind;
  title: string;
  description: string;
  /** Exactly what will be executed. Shown verbatim in the approval dialog. */
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  requestedBy: "ai" | "automation" | "user";
  conversationId?: string;
  automationRunId?: string;
  createdAt: ISODate;
  decidedAt?: ISODate;
  decidedBy?: string;
  result?: string;
}

export interface AiUsageRecord {
  month: string; // YYYY-MM
  promptTokens: number;
  completionTokens: number;
  requests: number;
}

// ─── Integrations & logs ────────────────────────────────────────────────────

export interface PayPalConnectionPublic {
  environment: PayPalEnvironment;
  status: "connected" | "error" | "disconnected";
  merchantId?: string;
  accountEmail?: string;
  connectedAt?: ISODate;
  lastSyncAt?: ISODate;
  lastSyncStatus?: "success" | "failed" | "running";
  lastSyncError?: string;
  webhookId?: string;
  webhookStatus: "active" | "not_configured" | "error";
  /** Capabilities PayPal confirmed for these credentials. */
  capabilities: { transactions: boolean; invoicing: boolean; subscriptions: boolean; orders: boolean };
}

export interface SyncRun {
  id: string;
  orgId: string;
  kind: "scheduled" | "manual" | "reconciliation" | "webhook";
  environment: PayPalEnvironment;
  startedAt: ISODate;
  finishedAt?: ISODate;
  status: "running" | "success" | "failed";
  itemsFetched: number;
  itemsUpserted: number;
  error?: string;
}

export interface WebhookEventRecord {
  id: string; // PayPal event id (dedupe key)
  orgId: string;
  environment: PayPalEnvironment;
  eventType: string;
  resourceType: string;
  resourceId?: string;
  receivedAt: ISODate;
  verified: boolean;
  status: "processed" | "failed" | "ignored";
  attempts: number;
  error?: string;
}

export interface EmailLog {
  id: string;
  orgId: string;
  to: string;
  subject: string;
  template: EmailTemplateKey;
  /** "queued": handed to the user's browser to send (EmailJS public key); becomes sent/failed when it reports back. */
  status: "sent" | "failed" | "simulated" | "queued";
  error?: string;
  queuedBy?: string;
  relatedType?: string;
  relatedId?: string;
  approvalId?: string;
  createdAt: ISODate;
}

export type EmailTemplateKey = "invoice" | "reminder" | "customer" | "business" | "automation";

export interface FileRecord {
  id: string;
  orgId: string;
  name: string;
  contentType: string;
  size: number;
  purpose: "receipt" | "invoice_attachment" | "document";
  relatedType?: string;
  relatedId?: string;
  storageKey: string;
  uploadedBy: string;
  createdAt: ISODate;
  isSample: boolean;
}

export interface ActivityLog {
  id: string;
  orgId: string;
  actor: string;
  action: string;
  target: string;
  detail?: string;
  createdAt: ISODate;
}

/** A read-only snapshot of an organization's data, used by analytics and AI tools. */
export interface Dataset {
  org: Organization;
  transactions: Transaction[];
  customers: Customer[];
  invoices: Invoice[];
  products: Product[];
  subscriptions: Subscription[];
  expenses: Expense[];
  paymentLinks: PaymentLink[];
}
