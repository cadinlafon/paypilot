import type {
  ActivityLog,
  AiConversation,
  AppMode,
  AppNotification,
  ApprovalRequest,
  Automation,
  AutomationRun,
  Customer,
  EmailLog,
  EmailTemplateKey,
  Expense,
  FileRecord,
  InternalTask,
  Invoice,
  Organization,
  PaymentLink,
  PayPalConnectionPublic,
  Product,
  Subscription,
  SyncRun,
  Transaction,
  TriggerType,
  WebhookEventRecord,
} from "@shared/types";

export interface CollectionMap {
  transactions: Transaction;
  customers: Customer;
  invoices: Invoice;
  products: Product;
  subscriptions: Subscription;
  expenses: Expense;
  paymentLinks: PaymentLink;
  notifications: AppNotification;
  automations: Automation;
  automationRuns: AutomationRun;
  tasks: InternalTask;
  aiConversations: AiConversation;
  approvals: ApprovalRequest;
  emailLogs: EmailLog;
  files: FileRecord;
  activityLogs: ActivityLog;
  syncRuns: SyncRun;
  webhookEvents: WebhookEventRecord;
}
export type CollectionName = keyof CollectionMap;

/** Collections the client may write directly (subject to Firestore rules). Everything else is server-only. */
export const CLIENT_WRITABLE: CollectionName[] = ["customers", "products", "invoices", "expenses", "automations", "tasks", "notifications"];

export type NewRecord<K extends CollectionName> = Omit<CollectionMap[K], "id" | "orgId" | "createdAt" | "updatedAt">;

export interface ActionResult {
  ok: boolean;
  message: string;
  /** True when the result is a simulation (Demo Mode). */
  simulated?: boolean;
}

export interface AiChatResponse {
  conversationId: string;
}

export interface SendEmailInput {
  to: string;
  toName?: string;
  subject: string;
  body: string;
  template: EmailTemplateKey;
  relatedType?: string;
  relatedId?: string;
}

export interface Repository {
  readonly mode: AppMode;
  readonly orgId: string;

  subscribe<K extends CollectionName>(name: K, cb: (rows: CollectionMap[K][]) => void, onError?: (e: Error) => void): () => void;
  create<K extends CollectionName>(name: K, data: NewRecord<K>): Promise<CollectionMap[K]>;
  update<K extends CollectionName>(name: K, id: string, patch: Partial<CollectionMap[K]>): Promise<void>;
  /** Soft delete. */
  archive<K extends CollectionName>(name: K, id: string): Promise<void>;

  subscribeOrg(cb: (org: Organization | null) => void): () => void;
  updateOrg(patch: Partial<Organization>): Promise<void>;
  subscribePayPal(cb: (c: PayPalConnectionPublic | null) => void): () => void;

  // ── Privileged / external — executed server-side in Real Mode, simulated in Demo ──
  refund(transactionId: string, amount: number, reason: string): Promise<ActionResult>;
  capture(transactionId: string): Promise<ActionResult>;
  sendInvoice(invoiceId: string): Promise<ActionResult>;
  sendEmail(input: SendEmailInput): Promise<ActionResult>;
  createPaymentLink(input: { description: string; amount: number; currency: string; customerId?: string; expiresAt?: string }): Promise<PaymentLink>;
  setPaymentLinkStatus(id: string, status: "active" | "disabled"): Promise<void>;
  syncNow(kind?: "manual" | "reconciliation"): Promise<ActionResult>;
  uploadFile(file: File, purpose: FileRecord["purpose"], related?: { type: string; id: string }): Promise<FileRecord>;
  getFileUrl(fileId: string): Promise<string | null>;
  aiChat(conversationId: string | null, message: string, model: string): Promise<AiChatResponse>;
  decideApproval(id: string, approve: boolean): Promise<ActionResult>;
  runAutomation(automationId: string, opts: { test: boolean }): Promise<AutomationRun>;
  retryAutomationRun(runId: string): Promise<AutomationRun>;
  /** Fire a trigger with a sample event (Demo) — Real Mode triggers fire server-side from real events. */
  fireTrigger?(type: TriggerType, payload: Record<string, string | number>): Promise<void>;
  resetDemo?(): Promise<void>;
  /** Demo only: add a sample incoming payment and run matching automations. */
  simulatePayment?(): Promise<Transaction>;
}
