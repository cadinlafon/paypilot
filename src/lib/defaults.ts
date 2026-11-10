import type { NotificationCategory, OrgSettings } from "@shared/types";

export const NOTIFICATION_CATEGORIES: { id: NotificationCategory; label: string; description: string }[] = [
  { id: "payment", label: "Payments", description: "Payments received" },
  { id: "payment_failed", label: "Failed payments", description: "Declined, denied or failed payments" },
  { id: "customer", label: "New customers", description: "Customer records created" },
  { id: "invoice", label: "Invoice updates", description: "Sent, viewed and paid invoices" },
  { id: "invoice_overdue", label: "Overdue invoices", description: "Invoices past due" },
  { id: "subscription", label: "Subscription renewals", description: "Upcoming and failed renewals" },
  { id: "automation_error", label: "Automation errors", description: "Workflow steps that failed" },
  { id: "ai_insight", label: "AI insights", description: "Patterns flagged for review" },
  { id: "integration", label: "Integration problems", description: "Sync, webhook and credential issues" },
];

export function defaultOrgSettings(currency: string): OrgSettings {
  return {
    syncInterval: "1h",
    ai: { enabled: true, model: "nvidia/nemotron-3.5-super-vl:free", monthlyTokenBudget: 2_000_000 },
    notifications: {
      categories: Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c.id, true])) as OrgSettings["notifications"]["categories"],
      emailDigest: "off",
    },
    invoicePrefix: "INV-",
    defaultPaymentTermsDays: 30,
    largeTransactionThreshold: currency === "JPY" ? 500000 : 500000,
  };
}

export const AI_MODELS = [
  // Free OpenRouter models with tool calling. Must match OPENROUTER_ALLOWED_MODELS on the server.
  { id: "nvidia/nemotron-3.5-super-vl:free", label: "Nemotron 3.5 Super", note: "Free · default" },
  { id: "nvidia/nemotron-3.5-lightning:free", label: "Nemotron 3.5 Lightning", note: "Free · fastest" },
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B", note: "Free · often busy" },
  { id: "google/gemma-4-26b-a4b-it:free", label: "Gemma 4 26B", note: "Free · often busy" },
];

export const EXPENSE_CATEGORIES = [
  "Software", "Hosting", "Rent", "Utilities", "Travel", "Meals", "Contractors", "Payroll fees", "Marketing",
  "Office supplies", "Inventory", "Shipping", "Packaging", "Equipment", "Professional fees", "Insurance", "Other",
];

export const TIMEZONES = [
  "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Toronto", "America/Mexico_City",
  "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Madrid", "Europe/Zurich", "Europe/Stockholm",
  "Africa/Lagos", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland", "UTC",
];

export const BUSINESS_TYPES = [
  "Agency / professional services", "E-commerce", "SaaS / software", "Retail", "Restaurant / hospitality",
  "Creator / freelancer", "Nonprofit", "Education", "Health & wellness", "Other",
];
