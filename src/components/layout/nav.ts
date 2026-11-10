import { Activity, Bell, Bot, Boxes, CreditCard, FileText, LayoutDashboard, Link2, PlugZap, Receipt, Repeat, Settings, Users, Workflow, BarChart3, type LucideIcon } from "lucide-react";
import type { Permission } from "@shared/types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Workspace",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/assistant", label: "AI Assistant", icon: Bot, permission: "ai.use" },
    ],
  },
  {
    group: "Money",
    items: [
      { to: "/transactions", label: "Transactions", icon: Activity, permission: "transactions.view" },
      { to: "/invoices", label: "Invoices", icon: FileText, permission: "invoices.view" },
      { to: "/payment-links", label: "Payment Links", icon: Link2, permission: "paymentLinks.view" },
      { to: "/subscriptions", label: "Subscriptions", icon: Repeat, permission: "subscriptions.view" },
      { to: "/expenses", label: "Expenses", icon: Receipt, permission: "expenses.view" },
    ],
  },
  {
    group: "Business",
    items: [
      { to: "/customers", label: "Customers", icon: Users, permission: "customers.view" },
      { to: "/products", label: "Products & Services", icon: Boxes, permission: "products.view" },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { to: "/analytics", label: "Analytics & Reports", icon: BarChart3, permission: "reports.view" },
      { to: "/automations", label: "Automations", icon: Workflow, permission: "automations.view" },
      { to: "/notifications", label: "Notifications", icon: Bell, permission: "notifications.view" },
    ],
  },
  {
    group: "Administration",
    items: [
      { to: "/integrations", label: "Integrations", icon: PlugZap },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const ALL_NAV = NAV.flatMap((g) => g.items);
export { CreditCard };
