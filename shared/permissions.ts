import type { Permission, Role } from "./types";

export const ALL_PERMISSIONS: { id: Permission; label: string; group: string; sensitive?: boolean }[] = [
  { id: "transactions.view", label: "View transactions", group: "Money" },
  { id: "transactions.refund", label: "Issue refunds", group: "Money", sensitive: true },
  { id: "transactions.capture", label: "Capture authorized payments", group: "Money", sensitive: true },
  { id: "invoices.view", label: "View invoices", group: "Money" },
  { id: "invoices.edit", label: "Create & edit invoices", group: "Money" },
  { id: "invoices.send", label: "Send invoices & reminders", group: "Money", sensitive: true },
  { id: "paymentLinks.view", label: "View payment links", group: "Money" },
  { id: "paymentLinks.create", label: "Create payment links", group: "Money", sensitive: true },
  { id: "subscriptions.view", label: "View subscriptions", group: "Money" },
  { id: "subscriptions.edit", label: "Manage subscriptions", group: "Money" },
  { id: "expenses.view", label: "View expenses", group: "Money" },
  { id: "expenses.edit", label: "Create & edit expenses", group: "Money" },
  { id: "customers.view", label: "View customers", group: "Business" },
  { id: "customers.edit", label: "Create & edit customers", group: "Business" },
  { id: "products.view", label: "View products", group: "Business" },
  { id: "products.edit", label: "Manage catalog", group: "Business" },
  { id: "reports.view", label: "Access reports & analytics", group: "Intelligence" },
  { id: "automations.view", label: "View automations", group: "Intelligence" },
  { id: "automations.configure", label: "Configure automations", group: "Intelligence" },
  { id: "notifications.view", label: "View notifications", group: "Intelligence" },
  { id: "ai.use", label: "Use AI assistant", group: "Intelligence" },
  { id: "files.upload", label: "Upload files", group: "Administration" },
  { id: "integrations.manage", label: "Manage integrations", group: "Administration", sensitive: true },
  { id: "users.manage", label: "Manage users & roles", group: "Administration", sensitive: true },
  { id: "settings.manage", label: "Manage organization settings", group: "Administration", sensitive: true },
];

const every = ALL_PERMISSIONS.map((p) => p.id);
const viewOnly = every.filter((p) => p.endsWith(".view"));

export const SYSTEM_ROLES: Role[] = [
  { id: "owner", name: "Owner", description: "Full access, including billing-sensitive actions and ownership.", permissions: every, system: true },
  {
    id: "admin",
    name: "Administrator",
    description: "Manages users, integrations and settings.",
    permissions: every,
    system: true,
  },
  {
    id: "finance_manager",
    name: "Finance Manager",
    description: "Runs day-to-day money operations including refunds and captures.",
    permissions: every.filter((p) => !["users.manage", "integrations.manage", "settings.manage"].includes(p)),
    system: true,
  },
  {
    id: "accountant",
    name: "Accountant",
    description: "Reads all financial data, manages expenses and reports.",
    permissions: [...viewOnly, "expenses.edit", "files.upload", "ai.use"],
    system: true,
  },
  {
    id: "employee",
    name: "Employee",
    description: "Creates invoices, customers and expenses; cannot move money.",
    permissions: [
      "invoices.view",
      "invoices.edit",
      "customers.view",
      "customers.edit",
      "products.view",
      "expenses.view",
      "expenses.edit",
      "notifications.view",
      "files.upload",
      "ai.use",
    ],
    system: true,
  },
  { id: "viewer", name: "Viewer", description: "Read-only access to business data.", permissions: viewOnly, system: true },
];

export function hasPermission(perms: readonly Permission[] | undefined, p: Permission): boolean {
  return !!perms && perms.includes(p);
}

export function roleById(roles: Role[], id: string): Role | undefined {
  return roles.find((r) => r.id === id) ?? SYSTEM_ROLES.find((r) => r.id === id);
}

export function isValidPermission(p: string): p is Permission {
  return every.includes(p as Permission);
}
