/**
 * Deterministic sample-data generator for Demo Mode.
 * Everything produced here is clearly marked `source: "demo"` and lives only
 * in the browser — it is never written to Firestore or sent to PayPal.
 */
import type {
  AppNotification,
  ApprovalRequest,
  Automation,
  AutomationRun,
  Customer,
  EmailLog,
  Expense,
  FileRecord,
  InternalTask,
  Invoice,
  InvoiceLine,
  Organization,
  PaymentLink,
  PaymentMethod,
  Product,
  Subscription,
  SyncRun,
  Transaction,
  ActivityLog,
  AiConversation,
} from "@shared/types";
import { computeInvoiceTotals, convertMinor, deriveInvoiceStatus } from "@shared/money";
import { addDays, addMonths, dateKey, todayKey } from "@shared/dates";
import { demoRate } from "./rates";
import { defaultOrgSettings } from "@/lib/defaults";

export interface DemoState {
  version: number;
  org: Organization;
  transactions: Transaction[];
  customers: Customer[];
  invoices: Invoice[];
  products: Product[];
  subscriptions: Subscription[];
  expenses: Expense[];
  paymentLinks: PaymentLink[];
  notifications: AppNotification[];
  automations: Automation[];
  automationRuns: AutomationRun[];
  tasks: InternalTask[];
  aiConversations: AiConversation[];
  approvals: ApprovalRequest[];
  emailLogs: EmailLog[];
  files: FileRecord[];
  activityLogs: ActivityLog[];
  syncRuns: SyncRun[];
  webhookEvents: never[];
}

export const DEMO_VERSION = 3;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Profile {
  id: string;
  name: string;
  businessType: string;
  industry: string;
  country: string;
  currency: string;
  timezone: string;
  seed: number;
  scale: number; // daily payment volume multiplier
  products: [string, string, "product" | "service", number, string, number][]; // name, desc, type, price(major), category, taxRate
  foreign: { currency: string; share: number }[];
  vendors: [string, string, number, number][]; // vendor, category, min, max (major)
}

export const DEMO_PROFILES: Profile[] = [
  {
    id: "demo-northwind",
    name: "Northwind Studio",
    businessType: "Design & development agency",
    industry: "Professional services",
    country: "US",
    currency: "USD",
    timezone: "America/Los_Angeles",
    seed: 42,
    scale: 1,
    products: [
      ["Brand Identity Package", "Logo, palette, typography and brand guidelines", "service", 4800, "Design", 0],
      ["Website Design Sprint", "Two-week UX/UI sprint with clickable prototype", "service", 7200, "Design", 0],
      ["Landing Page Build", "Responsive marketing page, CMS-ready", "service", 2400, "Development", 0],
      ["Growth Retainer", "Monthly design & dev retainer (20 hrs)", "service", 3500, "Retainer", 0],
      ["Care Plan", "Monthly hosting, updates and support", "service", 249, "Retainer", 0],
      ["UI Kit Pro", "Figma component library license", "product", 149, "Digital products", 8.25],
      ["Icon Pack — Line", "1,200 hand-tuned line icons", "product", 59, "Digital products", 8.25],
      ["Pitch Deck Template", "Keynote + Google Slides template", "product", 39, "Digital products", 8.25],
      ["Strategy Workshop", "Half-day facilitated product workshop", "service", 1800, "Consulting", 0],
      ["Hourly Consulting", "Senior designer, billed hourly", "service", 165, "Consulting", 0],
      ["Accessibility Audit", "WCAG 2.2 AA audit with remediation plan", "service", 2900, "Consulting", 0],
      ["Motion Design Add-on", "Lottie animations for product UI", "service", 950, "Design", 0],
      ["Printed Brand Book", "Hardcover brand book, 40 pages", "product", 120, "Physical goods", 8.25],
      ["Legacy Theme License", "Discontinued WordPress theme", "product", 49, "Digital products", 8.25],
    ],
    foreign: [
      { currency: "EUR", share: 0.12 },
      { currency: "GBP", share: 0.07 },
      { currency: "CAD", share: 0.06 },
    ],
    vendors: [
      ["Figma", "Software", 45, 180],
      ["Google Workspace", "Software", 72, 72],
      ["Adobe", "Software", 89, 89],
      ["AWS", "Hosting", 120, 640],
      ["Vercel", "Hosting", 20, 150],
      ["WeWork", "Rent", 1850, 1850],
      ["Delta Air Lines", "Travel", 280, 920],
      ["Uber", "Travel", 14, 62],
      ["Blue Bottle Coffee", "Meals", 9, 48],
      ["Upwork", "Contractors", 400, 2600],
      ["Gusto", "Payroll fees", 80, 80],
      ["LinkedIn Ads", "Marketing", 150, 900],
      ["Staples", "Office supplies", 18, 140],
      ["Comcast Business", "Utilities", 129, 129],
    ],
  },
  {
    id: "demo-lumen",
    name: "Lumen Coffee Co.",
    businessType: "Specialty coffee roaster & e-commerce",
    industry: "Retail / e-commerce",
    country: "DE",
    currency: "EUR",
    timezone: "Europe/Berlin",
    seed: 7,
    scale: 2.2,
    products: [
      ["House Blend 1kg", "Chocolatey espresso blend", "product", 32, "Coffee", 7],
      ["Single Origin — Ethiopia 250g", "Washed Yirgacheffe, floral", "product", 16, "Coffee", 7],
      ["Single Origin — Colombia 250g", "Huila, caramel & red apple", "product", 14, "Coffee", 7],
      ["Decaf Swiss Water 500g", "Gentle, sweet decaf", "product", 19, "Coffee", 7],
      ["Coffee Subscription", "Monthly curated 2×250g", "service", 29, "Subscriptions", 7],
      ["Pour-Over Kit", "Dripper, filters, carafe", "product", 58, "Equipment", 19],
      ["Barista Workshop", "3-hour home barista class", "service", 89, "Classes", 19],
      ["Wholesale Box 5kg", "Café wholesale", "product", 120, "Wholesale", 7],
    ],
    foreign: [
      { currency: "USD", share: 0.1 },
      { currency: "GBP", share: 0.08 },
      { currency: "CHF", share: 0.05 },
    ],
    vendors: [
      ["Green Coffee Imports GmbH", "Inventory", 900, 4200],
      ["DHL", "Shipping", 40, 380],
      ["Shopify", "Software", 79, 79],
      ["Stadtwerke Berlin", "Utilities", 210, 340],
      ["Packaging Plus", "Packaging", 150, 700],
      ["Meta Ads", "Marketing", 100, 600],
      ["Roastery Lease", "Rent", 2400, 2400],
    ],
  },
];

const FIRST = ["Olivia", "Liam", "Emma", "Noah", "Ava", "Mateo", "Sofia", "Lucas", "Mia", "Ethan", "Amara", "Kenji", "Priya", "Diego", "Hannah", "Omar", "Chloe", "Leo", "Isla", "Arjun", "Zoe", "Felix", "Nora", "Samuel", "Elena", "Jonas", "Maya", "Theo", "Aisha", "Gabriel", "Freya", "Daniel", "Lena", "Hugo", "Yara", "Max", "Ines", "Caleb", "Ruby", "Malik"];
const LAST = ["Johnson", "Garcia", "Chen", "Müller", "Okafor", "Patel", "Rossi", "Nakamura", "Silva", "Kowalski", "Dubois", "Andersen", "Haddad", "Novak", "Kim", "Fischer", "Lopez", "Ibrahim", "Walsh", "Bennett"];
const COMPANIES = ["Acme Robotics", "Bluebird Health", "Cobalt Labs", "Driftwood Hotels", "Evergreen Legal", "Fable & Co", "Granite Capital", "Harbor Foods", "Ion Mobility", "Juniper Schools", "Kestrel Media", "Lighthouse Dental", "Maple Outdoor", "Nimbus Cloud", "Orchard Wellness", "Pinecone Games", "Quartz Fintech", "Redwood Realty", "Summit Fitness", "Tidal Energy", "Umbra Studios", "Vantage Analytics", "Willow Bakery", "Zephyr Travel"];
const CITIES: [string, string, string][] = [
  ["San Francisco", "CA", "US"],
  ["Austin", "TX", "US"],
  ["Brooklyn", "NY", "US"],
  ["Seattle", "WA", "US"],
  ["Denver", "CO", "US"],
  ["Toronto", "ON", "CA"],
  ["London", "", "GB"],
  ["Berlin", "", "DE"],
  ["Amsterdam", "", "NL"],
  ["Zürich", "", "CH"],
];
const FAILS = ["INSTRUMENT_DECLINED — card issuer declined", "PAYER_ACTION_REQUIRED — 3-D Secure not completed", "INSUFFICIENT_FUNDS", "TRANSACTION_REFUSED — risk review", "CARD_EXPIRED"];

function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length)];
}

function feeFor(gross: number, currency: string, international: boolean): number {
  // Sample fee schedule for demo purposes only (3.49% + fixed, +1.5% international).
  const pct = 0.0349 + (international ? 0.015 : 0);
  const fixed = currency === "JPY" ? 49 : 49;
  return Math.round(gross * pct + fixed);
}

let idc = 0;
const nid = (p: string) => `${p}_${(++idc).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export function generateDemoState(profileId: string, ownerId = "demo-user"): DemoState {
  const P = DEMO_PROFILES.find((p) => p.id === profileId) ?? DEMO_PROFILES[0];
  const r = rng(P.seed);
  const tz = P.timezone;
  const today = todayKey(tz);
  const start = addMonths(today, -13);
  const nowIso = new Date().toISOString();
  const cur = P.currency;
  const iso = (key: string, hour = 9 + Math.floor(r() * 10), min = Math.floor(r() * 60)) => new Date(`${key}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`).toISOString();
  const ts = (k: string) => ({ createdAt: iso(k), updatedAt: iso(k), archivedAt: null });

  const org: Organization = {
    id: P.id,
    name: P.name,
    businessType: P.businessType,
    industry: P.industry,
    country: P.country,
    email: `hello@${P.name.toLowerCase().replace(/[^a-z]/g, "")}.example`,
    website: `https://${P.name.toLowerCase().replace(/[^a-z]/g, "")}.example`,
    address: P.country === "US" ? "500 Market St, San Francisco, CA 94105" : "Torstraße 1, 10119 Berlin",
    reportingCurrency: cur,
    timezone: tz,
    ownerId,
    settings: defaultOrgSettings(cur),
    createdAt: iso(start),
    updatedAt: nowIso,
  };
  org.settings.largeTransactionThreshold = cur === "EUR" ? 50000 : 500000;
  org.settings.invoicePrefix = P.id === "demo-lumen" ? "LUM-" : "NW-";

  // Products
  const products: Product[] = P.products.map(([name, description, type, price, category, taxRate], i) => ({
    id: `${P.id}-prod-${i + 1}`,
    orgId: P.id,
    source: "demo",
    name,
    description,
    type,
    price: Math.round(price * 100),
    currency: cur,
    category,
    taxRate,
    active: !name.startsWith("Legacy"),
    ...ts(addDays(start, i * 3)),
  }));
  const activeProducts = products.filter((p) => p.active);

  // Customers
  const customers: Customer[] = [];
  const nCust = Math.round(44 * (P.scale > 1 ? 1.4 : 1));
  for (let i = 0; i < nCust; i++) {
    const f = FIRST[(i * 7 + P.seed) % FIRST.length];
    const l = LAST[(i * 11 + P.seed) % LAST.length];
    const company = r() < 0.65 ? COMPANIES[(i * 5 + P.seed) % COMPANIES.length] : undefined;
    const [city, state, country] = pick(r, CITIES);
    // Customer acquisition skews more recent (growth)
    const createdKey = addDays(start, Math.floor(Math.sqrt(r()) * 395));
    customers.push({
      id: `${P.id}-cus-${i + 1}`,
      orgId: P.id,
      source: "demo",
      name: `${f} ${l}`,
      email: `${f}.${l}`.toLowerCase().replace(/[^a-z.]/g, "") + `@${company ? company.toLowerCase().replace(/[^a-z]/g, "") : "mail"}.example`,
      phone: `+1 (555) ${String(100 + Math.floor(r() * 899))}-${String(1000 + Math.floor(r() * 8999))}`,
      company,
      billingAddress: { line1: `${100 + Math.floor(r() * 899)} ${pick(r, ["Oak", "Pine", "Elm", "Cedar", "Main", "Harbor"])} St`, city, state, postalCode: String(10000 + Math.floor(r() * 89999)), country },
      notes: i % 6 === 0 ? "Prefers invoices at the start of each month." : "",
      tags: [i % 4 === 0 ? "vip" : "", company ? "business" : "individual"].filter(Boolean),
      ...ts(createdKey),
    });
  }
  customers.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const lookup = (from: string, to: string, date: string) => demoRate(from, to, date);
  const reporting = (t: Pick<Transaction, "currency" | "gross" | "fee" | "net" | "date">) => {
    if (t.currency === cur) return undefined;
    const rr = lookup(t.currency, cur, t.date.slice(0, 10));
    return {
      currency: cur,
      gross: convertMinor(t.gross, t.currency, cur, rr.rate),
      fee: convertMinor(t.fee, t.currency, cur, rr.rate),
      net: convertMinor(t.net, t.currency, cur, rr.rate),
      rate: rr.rate,
      rateTimestamp: rr.date,
      provider: rr.provider,
      estimated: rr.estimated,
    };
  };

  const transactions: Transaction[] = [];
  const mkTx = (o: Partial<Transaction> & Pick<Transaction, "date" | "gross" | "currency" | "customerName">): Transaction => {
    const intl = o.currency !== cur;
    const status = o.status ?? "completed";
    const fee = status === "failed" || status === "denied" || status === "authorized" ? 0 : feeFor(o.gross, o.currency, intl);
    const base: Transaction = {
      id: nid("tx"),
      orgId: P.id,
      source: "demo",
      externalId: `DEMO-${Math.floor(r() * 1e16).toString(36).toUpperCase().padStart(10, "0").slice(0, 14)}`,
      type: "payment",
      status,
      description: "",
      paymentMethod: "paypal",
      refundedAmount: 0,
      refunds: [],
      fee,
      net: o.gross - fee,
      createdAt: o.date,
      updatedAt: o.date,
      archivedAt: null,
      ...o,
    } as Transaction;
    base.net = base.gross - base.fee;
    base.reporting = reporting(base);
    return base;
  };

  // Subscriptions (recurring revenue)
  const subProducts = activeProducts.filter((p) => p.category === "Retainer" || p.category === "Subscriptions");
  const subscriptions: Subscription[] = [];
  const nSubs = P.scale > 1 ? 22 : 14;
  for (let i = 0; i < nSubs; i++) {
    const c = customers[(i * 3) % customers.length];
    const prod = subProducts[i % subProducts.length];
    const startKey = c.createdAt.slice(0, 10) > start ? c.createdAt.slice(0, 10) : addDays(start, Math.floor(r() * 60));
    const status: Subscription["status"] = i % 9 === 4 ? "cancelled" : i % 11 === 6 ? "past_due" : i % 13 === 3 ? "paused" : i === 1 ? "trialing" : "active";
    const s: Subscription = {
      id: `${P.id}-sub-${i + 1}`,
      orgId: P.id,
      source: "demo",
      externalId: `I-DEMO${String(100000 + i)}`,
      customerId: c.id,
      customerName: c.name,
      productId: prod.id,
      productName: prod.name,
      amount: prod.price,
      currency: cur,
      interval: "month",
      startDate: startKey,
      nextBillingDate: startKey,
      status,
      paymentHistory: [],
      ...ts(startKey),
    };
    let k = startKey;
    const stopAt = status === "cancelled" ? addMonths(startKey, 3 + (i % 5)) : today;
    while (k <= today) {
      if (k > stopAt) break;
      if (status === "trialing") break;
      const failed = status === "past_due" && addMonths(k, 1) > today;
      const t = mkTx({
        date: iso(k, 15, 5),
        gross: s.amount,
        currency: cur,
        customerId: c.id,
        customerName: c.name,
        customerEmail: c.email,
        type: "subscription_payment",
        status: failed ? "failed" : "completed",
        failureReason: failed ? FAILS[2] : undefined,
        description: `${prod.name} — monthly`,
        subscriptionId: s.id,
        productId: prod.id,
        paymentMethod: i % 3 === 0 ? "card" : "paypal",
      });
      transactions.push(t);
      s.paymentHistory.push({ date: k, amount: s.amount, status: failed ? "failed" : "paid", transactionId: t.id });
      k = addMonths(k, 1);
    }
    s.nextBillingDate = status === "cancelled" || status === "paused" ? s.paymentHistory.at(-1)?.date ?? k : status === "trialing" ? addDays(today, 5) : status === "past_due" ? addDays(today, 2) : k;
    if (status === "active" && i < 4) s.nextBillingDate = addDays(today, [1, 3, 6, 9][i]);
    subscriptions.push(s);
  }

  // One-off payments
  let day = start;
  let dayIndex = 0;
  const methods: PaymentMethod[] = ["paypal", "paypal", "paypal", "card", "card", "venmo", "pay_later"];
  while (day <= today) {
    const growth = 0.55 + (dayIndex / 395) * 0.9;
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 0.45 : 1;
    const n = Math.floor(r() * 3.2 * growth * weekend * P.scale + (r() < 0.3 ? 1 : 0));
    for (let j = 0; j < n; j++) {
      const eligible = customers.filter((c) => c.createdAt.slice(0, 10) <= day);
      if (!eligible.length) break;
      const c = eligible[Math.floor(Math.pow(r(), 1.6) * eligible.length)];
      const prod = activeProducts.filter((p) => p.category !== "Retainer" && p.category !== "Subscriptions")[Math.floor(Math.pow(r(), 1.3) * (activeProducts.length - subProducts.length))] ?? activeProducts[0];
      const qty = prod.type === "product" ? 1 + Math.floor(r() * (P.scale > 1 ? 3 : 1.4)) : prod.name === "Hourly Consulting" ? 2 + Math.floor(r() * 10) : 1;
      let currency = cur;
      const roll = r();
      let acc = 0;
      for (const f of P.foreign) {
        acc += f.share;
        if (roll < acc) {
          currency = f.currency;
          break;
        }
      }
      const baseGross = prod.price * qty;
      const gross = currency === cur ? baseGross : convertMinor(baseGross, cur, currency, lookup(cur, currency, day).rate);
      const sroll = r();
      const status: Transaction["status"] =
        dayIndex > 388 && sroll < 0.04 ? "pending" : sroll < 0.035 ? "failed" : sroll < 0.045 ? "denied" : dayIndex > 380 && sroll < 0.07 ? "authorized" : "completed";
      const t = mkTx({
        date: iso(day),
        gross,
        currency,
        customerId: c.id,
        customerName: c.name,
        customerEmail: c.email,
        status,
        failureReason: status === "failed" || status === "denied" ? pick(r, FAILS) : undefined,
        description: qty > 1 ? `${qty} × ${prod.name}` : prod.name,
        productId: prod.id,
        paymentMethod: pick(r, methods),
        authorizationExpiresAt: status === "authorized" ? new Date(Date.parse(iso(day)) + 29 * 86400000).toISOString() : undefined,
      });
      if (status === "completed" && r() < 0.04) {
        const full = r() < 0.55;
        const amt = full ? t.gross : Math.round(t.gross * (0.2 + r() * 0.4));
        const rd = new Date(Date.parse(t.date) + (1 + Math.floor(r() * 9)) * 86400000).toISOString();
        if (rd < nowIso) {
          t.refunds = [{ id: nid("rf"), amount: amt, date: rd, reason: pick(r, ["Customer request", "Duplicate order", "Scope reduced", "Item damaged in transit"]) }];
          t.refundedAmount = amt;
          t.status = full ? "refunded" : "partially_refunded";
        }
      }
      transactions.push(t);
    }
    day = addDays(day, 1);
    dayIndex++;
  }

  // A notable large payment and a possible duplicate (for anomaly detection demos)
  const vip = customers.find((c) => c.tags.includes("vip")) ?? customers[0];
  const big = mkTx({ date: iso(addDays(today, -4), 17, 12), gross: Math.round((cur === "EUR" ? 4200 : 38500) * 100), currency: cur, customerId: vip.id, customerName: vip.name, customerEmail: vip.email, description: "Annual platform redesign — milestone 1", productId: products[1].id, paymentMethod: "bank" });
  transactions.push(big);
  const dupBase = customers[customers.length - 3];
  const d1 = mkTx({ date: iso(addDays(today, -2), 10, 2), gross: products[5].price, currency: cur, customerId: dupBase.id, customerName: dupBase.name, customerEmail: dupBase.email, description: products[5].name, productId: products[5].id });
  const d2 = mkTx({ date: new Date(Date.parse(d1.date) + 3 * 60000).toISOString(), gross: products[5].price, currency: cur, customerId: dupBase.id, customerName: dupBase.name, customerEmail: dupBase.email, description: products[5].name, productId: products[5].id });
  transactions.push(d1, d2);
  const failer = customers[customers.length - 5];
  for (let k = 0; k < 3; k++)
    transactions.push(mkTx({ date: iso(addDays(today, -1 - k), 20, 10 + k), gross: products[2].price, currency: cur, customerId: failer.id, customerName: failer.name, customerEmail: failer.email, status: "failed", failureReason: FAILS[0], description: products[2].name, productId: products[2].id, paymentMethod: "card" }));

  // Invoices
  const invoices: Invoice[] = [];
  const invProducts = activeProducts.filter((p) => p.type === "service");
  let invNo = 1001;
  for (let i = 0; i < (P.scale > 1 ? 34 : 58); i++) {
    const c = customers[Math.floor(r() * customers.length)];
    const issue = addDays(start, 20 + Math.floor((i / 58) * 380 + r() * 8));
    if (issue > today) continue;
    const lines: InvoiceLine[] = [];
    const nl = 1 + Math.floor(r() * 3);
    for (let j = 0; j < nl; j++) {
      const p = invProducts[Math.floor(r() * invProducts.length)];
      lines.push({ id: `l${j + 1}`, productId: p.id, description: p.name, quantity: p.name.includes("Hourly") ? 4 + Math.floor(r() * 16) : 1, unitPrice: p.price, taxRate: p.taxRate });
    }
    const terms = pick(r, [15, 30, 30, 45]);
    const due = addDays(issue, terms);
    const discount = r() < 0.15 ? { type: "percent" as const, value: pick(r, [5, 10]) } : { type: "percent" as const, value: 0 };
    const inv: Invoice = {
      id: `${P.id}-inv-${i + 1}`,
      orgId: P.id,
      source: "demo",
      externalId: `INV2-DEMO-${invNo}`,
      number: `${org.settings.invoicePrefix}${invNo++}`,
      customerId: c.id,
      customerName: c.name,
      customerEmail: c.email,
      status: "sent",
      issueDate: issue,
      dueDate: due,
      currency: cur,
      lines,
      discount,
      notes: "Thank you for your business!",
      terms: `Net ${terms}`,
      paymentTermsDays: terms,
      totals: { subtotal: 0, discount: 0, tax: 0, total: 0, paid: 0, balance: 0 },
      payments: [],
      history: [
        { at: iso(issue, 9, 0), event: "Invoice created", by: "Alex Rivera" },
        { at: iso(issue, 9, 5), event: `Sent to ${c.email}`, by: "Alex Rivera" },
      ],
      attachmentIds: [],
      ...ts(issue),
    };
    inv.totals = computeInvoiceTotals(inv);
    const age = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${issue}T00:00:00Z`);
    const roll = r();
    if (i % 23 === 7) {
      inv.status = "cancelled";
      inv.history.push({ at: iso(addDays(issue, 3)), event: "Invoice cancelled", by: "Alex Rivera" });
    } else if (age > 120 * 86400000 ? roll < 0.985 : age > 50 * 86400000 ? roll < 0.9 : roll < 0.5) {
      const payKey = addDays(issue, Math.min(Math.floor(r() * (terms + 12)), Math.max(0, Math.floor(age / 86400000))));
      const partial = r() < 0.12 && age < 120 * 86400000;
      const amt = partial ? Math.round(inv.totals.total * 0.5) : inv.totals.total;
      const t = mkTx({ date: iso(payKey), gross: amt, currency: cur, customerId: c.id, customerName: c.name, customerEmail: c.email, description: `Invoice ${inv.number}`, invoiceId: inv.id, productId: lines[0].productId, paymentMethod: "paypal" });
      transactions.push(t);
      inv.payments.push({ id: nid("pay"), amount: amt, date: t.date, method: "PayPal", transactionId: t.id });
      inv.history.push({ at: t.date, event: `Payment received — ${(amt / 100).toFixed(2)} ${cur}`, by: "PayPal" });
    }
    inv.totals = computeInvoiceTotals(inv);
    inv.status = deriveInvoiceStatus(inv, today);
    if (inv.status === "overdue" && age > 150 * 86400000) {
      inv.status = "cancelled";
      inv.history.push({ at: iso(addDays(due, 90)), event: "Cancelled — written off as uncollectible", by: "Alex Rivera" });
    }
    invoices.push(inv);
  }
  // Drafts
  for (let i = 0; i < 3; i++) {
    const c = customers[customers.length - 1 - i];
    const p = invProducts[i % invProducts.length];
    const inv: Invoice = {
      id: `${P.id}-inv-d${i + 1}`,
      orgId: P.id,
      source: "demo",
      number: `${org.settings.invoicePrefix}${invNo++}`,
      customerId: c.id,
      customerName: c.name,
      customerEmail: c.email,
      status: "draft",
      issueDate: today,
      dueDate: addDays(today, 30),
      currency: cur,
      lines: [{ id: "l1", productId: p.id, description: p.name, quantity: 1, unitPrice: p.price, taxRate: p.taxRate }],
      discount: { type: "percent", value: 0 },
      notes: "",
      terms: "Net 30",
      paymentTermsDays: 30,
      totals: { subtotal: 0, discount: 0, tax: 0, total: 0, paid: 0, balance: 0 },
      payments: [],
      history: [{ at: nowIso, event: "Draft created", by: "Alex Rivera" }],
      attachmentIds: [],
      ...ts(addDays(today, -i)),
    };
    inv.totals = computeInvoiceTotals(inv);
    invoices.push(inv);
  }

  // Outgoing PayPal purchases + linked expenses (demonstrates no double counting)
  const expenses: Expense[] = [];
  let ek = start;
  while (ek <= today) {
    for (const [vendor, category, min, max] of P.vendors) {
      const monthly = ["Software", "Rent", "Utilities", "Payroll fees", "Hosting"].includes(category);
      if (monthly ? ek.slice(8) !== "03" : r() > 0.035) continue;
      const amount = Math.round((min + r() * (max - min)) * 100);
      const viaPaypal = vendor === "Figma" || vendor === "Upwork" || vendor === "Packaging Plus";
      let linkedTransactionId: string | undefined;
      if (viaPaypal) {
        const pt = mkTx({ date: iso(ek, 11, 0), gross: amount, currency: cur, customerName: vendor, description: `PayPal purchase — ${vendor}`, type: "purchase", paymentMethod: "paypal" });
        pt.fee = 0;
        pt.net = pt.gross;
        transactions.push(pt);
        linkedTransactionId = pt.id;
      }
      expenses.push({
        id: nid("exp"),
        orgId: P.id,
        source: "demo",
        name: `${vendor}${monthly ? " — monthly" : ""}`,
        amount,
        currency: cur,
        date: ek,
        category,
        vendor,
        description: "",
        taxAmount: category === "Meals" || category === "Office supplies" ? Math.round(amount * 0.08) : 0,
        taxDeductible: category !== "Meals",
        paymentSource: viaPaypal ? "paypal" : category === "Rent" ? "bank" : "card",
        linkedTransactionId,
        receiptFileId: undefined,
        notes: "",
        ...ts(ek),
      });
    }
    ek = addDays(ek, 1);
  }
  // A foreign-currency expense with estimated conversion
  const fx = P.foreign[0].currency;
  const fxAmt = 64000;
  const fxr = lookup(fx, cur, addDays(today, -12));
  expenses.push({
    id: nid("exp"),
    orgId: P.id,
    source: "demo",
    name: "Conference ticket",
    amount: fxAmt,
    currency: fx,
    reporting: { currency: cur, amount: convertMinor(fxAmt, fx, cur, fxr.rate), rate: fxr.rate, estimated: true, provider: fxr.provider },
    date: addDays(today, -12),
    category: "Travel",
    vendor: "Config Europe",
    description: "Design conference — converted with an estimated rate (no rate for that date yet)",
    taxAmount: 0,
    taxDeductible: true,
    paymentSource: "card",
    notes: "",
    ...ts(addDays(today, -12)),
  });

  // Receipts (sample metadata only — no file content is stored)
  const files: FileRecord[] = expenses.slice(-6).map((e, i) => {
    const f: FileRecord = { id: `${P.id}-file-${i + 1}`, orgId: P.id, name: `receipt-${e.vendor.toLowerCase().replace(/[^a-z]/g, "-")}-${e.date}.pdf`, contentType: "application/pdf", size: 38000 + i * 7100, purpose: "receipt", relatedType: "expense", relatedId: e.id, storageKey: `sample/${e.id}.pdf`, uploadedBy: "Alex Rivera", createdAt: iso(e.date), isSample: true };
    e.receiptFileId = f.id;
    return f;
  });

  // Payment links
  const paymentLinks: PaymentLink[] = activeProducts.slice(0, 7).map((p, i) => {
    const c = i % 2 === 0 ? customers[(i * 5) % customers.length] : undefined;
    const created = addDays(today, -(4 + i * 9));
    const status: PaymentLink["status"] = i === 2 ? "paid" : i === 5 ? "expired" : i === 6 ? "disabled" : "active";
    const id = `${P.id}-pl-${i + 1}`;
    return {
      id,
      orgId: P.id,
      source: "demo",
      description: p.name,
      amount: p.price,
      currency: cur,
      customerId: c?.id,
      customerName: c?.name,
      status,
      url: `https://demo.paypilot.local/pay/${id}`,
      isSample: true,
      expiresAt: i % 3 === 0 ? iso(addDays(created, 30), 23, 59) : undefined,
      views: Math.floor(r() * 60),
      activity: [
        { at: iso(created), event: "Created", detail: "Sample link — cannot accept payments" },
        ...(i % 2 === 0 ? [{ at: iso(addDays(created, 1)), event: "Viewed", detail: "Opened from email" }] : []),
        ...(status === "paid" ? [{ at: iso(addDays(created, 2)), event: "Paid (simulated)" }] : []),
        ...(status === "expired" ? [{ at: iso(addDays(created, 30)), event: "Expired" }] : []),
      ],
      ...ts(created),
    };
  });

  // Automations
  const A = (id: string, name: string, description: string, trigger: Automation["trigger"], conditions: Automation["conditions"], actions: Automation["actions"], enabled = true): Automation => ({
    id: `${P.id}-auto-${id}`,
    orgId: P.id,
    source: "demo",
    name,
    description,
    enabled,
    testMode: false,
    trigger,
    conditions,
    actions,
    runCount: 0,
    errorCount: 0,
    ...ts(addDays(start, 30)),
  });
  const automations: Automation[] = [
    A("overdue", "Overdue invoice reminder", "Draft a reminder and queue it for approval when an invoice is 7+ days overdue.", { type: "invoice_overdue", config: {} }, [{ id: "c1", field: "daysOverdue", operator: "gte", value: "7" }], [
      { id: "a1", type: "send_email", config: { to: "{{customerEmail}}", subject: "Reminder: invoice {{invoiceNumber}} is overdue", body: "Hi {{customerName}},\n\nInvoice {{invoiceNumber}} for {{balanceFormatted}} is now {{daysOverdue}} days overdue. Please let us know if you have any questions.\n\nThanks!" } },
      { id: "a2", type: "create_task", config: { title: "Call {{customerName}} about {{invoiceNumber}}", dueInDays: "2" } },
    ]),
    A("large", "Large payment alert", "Notify admins about unusually large payments.", { type: "large_transaction", config: {} }, [], [{ id: "a1", type: "notify_admin", config: { message: "Large payment of {{amountFormatted}} from {{customerName}}" } }]),
    A("failed", "Failed payment follow-up", "Notify and create a follow-up task when a payment fails.", { type: "payment_failed", config: {} }, [], [
      { id: "a1", type: "create_notification", config: { title: "Payment failed: {{customerName}}", body: "{{amountFormatted}} — {{failureReason}}" } },
      { id: "a2", type: "draft_email", config: { to: "{{customerEmail}}", subject: "Your payment didn't go through", body: "Hi {{customerName}}, your recent payment of {{amountFormatted}} failed. You can retry using the same link." } },
    ]),
    A("briefing", "Morning business briefing", "AI-written summary of yesterday every morning at 8am.", { type: "daily_briefing", config: { hour: "8" } }, [], [{ id: "a1", type: "generate_ai_report", config: { period: "7d" } }]),
    A("welcome", "Welcome new customers", "Draft a welcome email for new business customers.", { type: "new_customer", config: {} }, [{ id: "c1", field: "company", operator: "neq", value: "" }], [{ id: "a1", type: "draft_email", config: { to: "{{email}}", subject: "Welcome to {{orgName}}", body: "Hi {{customerName}}, thanks for choosing us!" } }], false),
  ];

  const automationRuns: AutomationRun[] = [];
  const runAt = (k: number) => new Date(Date.now() - k * 3600000).toISOString();
  const addRun = (a: Automation, hoursAgo: number, status: AutomationRun["status"], summary: string, steps: AutomationRun["steps"], error?: string) => {
    automationRuns.push({ id: nid("run"), orgId: P.id, automationId: a.id, automationName: a.name, triggeredAt: runAt(hoursAgo), triggerSummary: summary, status, steps, error, attempt: 1, test: false });
    a.runCount++;
    if (status === "failed") a.errorCount++;
    if (!a.lastRunAt || a.lastRunAt < runAt(hoursAgo)) a.lastRunAt = runAt(hoursAgo);
  };
  for (let d = 0; d < 14; d++) addRun(automations[3], d * 24 + 3, "success", `Daily briefing for ${addDays(today, -d)}`, [{ actionId: "a1", type: "generate_ai_report", status: "success", detail: "Briefing generated (demo)" }]);
  addRun(automations[1], 4 * 24 - 2, "success", `${big.customerName} paid ${(big.gross / 100).toLocaleString()} ${cur}`, [{ actionId: "a1", type: "notify_admin", status: "success", detail: "Admins notified" }]);
  addRun(automations[2], 20, "success", `${failer.name} — payment failed`, [
    { actionId: "a1", type: "create_notification", status: "success", detail: "Notification created" },
    { actionId: "a2", type: "draft_email", status: "success", detail: "Draft saved" },
  ]);
  addRun(automations[2], 44, "failed", `${failer.name} — payment failed`, [
    { actionId: "a1", type: "create_notification", status: "success", detail: "Notification created" },
    { actionId: "a2", type: "draft_email", status: "failed", detail: "Template variable {{customerEmail}} was empty" },
  ], "Template variable {{customerEmail}} was empty");

  const overdueInv = invoices.filter((i) => i.status === "overdue");
  const approvals: ApprovalRequest[] = [];
  const tasks: InternalTask[] = [];
  for (const inv of overdueInv.slice(0, 2)) {
    const runId = nid("run");
    const appr: ApprovalRequest = {
      id: nid("apr"),
      orgId: P.id,
      kind: "send_email",
      title: `Send overdue reminder to ${inv.customerName}`,
      description: `Invoice ${inv.number} — requested by automation “Overdue invoice reminder”`,
      payload: { to: inv.customerEmail, toName: inv.customerName, subject: `Reminder: invoice ${inv.number} is overdue`, body: `Hi ${inv.customerName.split(" ")[0]},\n\nInvoice ${inv.number} for ${(inv.totals.balance / 100).toFixed(2)} ${cur} is now overdue. Please let us know if you have any questions.\n\nThanks!`, template: "reminder", relatedType: "invoice", relatedId: inv.id },
      status: "pending",
      requestedBy: "automation",
      automationRunId: runId,
      createdAt: runAt(6),
    };
    approvals.push(appr);
    automationRuns.push({ id: runId, orgId: P.id, automationId: automations[0].id, automationName: automations[0].name, triggeredAt: runAt(6), triggerSummary: `${inv.number} overdue`, status: "pending_approval", steps: [{ actionId: "a1", type: "send_email", status: "pending_approval", detail: "Waiting for approval" }, { actionId: "a2", type: "create_task", status: "success", detail: "Task created" }], attempt: 1, test: false });
    automations[0].runCount++;
    automations[0].lastRunAt = runAt(6);
    tasks.push({ id: nid("task"), orgId: P.id, title: `Call ${inv.customerName} about ${inv.number}`, description: "Created by automation", status: "open", source: "automation", dueDate: addDays(today, 2), ...ts(today) });
  }
  automationRuns.sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));

  // Notifications
  const N = (category: AppNotification["category"], severity: AppNotification["severity"], title: string, body: string, hoursAgo: number, read: boolean, link?: string): AppNotification => ({ id: nid("ntf"), orgId: P.id, category, severity, title, body, createdAt: runAt(hoursAgo), read, link });
  const recentPaid = transactions.filter((t) => t.status === "completed" && t.type !== "purchase").sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  const notifications: AppNotification[] = [
    N("payment", "success", `Large payment from ${big.customerName}`, `${(big.gross / 100).toLocaleString()} ${cur} — ${big.description}`, 4 * 24 - 2, false, "/transactions"),
    N("payment_failed", "error", `3 failed payments from ${failer.name}`, `${FAILS[0]}. Consider reaching out.`, 20, false, "/transactions"),
    N("ai_insight", "info", "Possible duplicate charge", `${dupBase.name} was charged twice for ${products[5].name} within 3 minutes. Review before refunding.`, 40, false, "/transactions"),
    ...overdueInv.slice(0, 3).map((i, k) => N("invoice_overdue", "warning", `Invoice ${i.number} is overdue`, `${i.customerName} owes ${(i.totals.balance / 100).toFixed(2)} ${cur}`, 6 + k * 12, k > 0, "/invoices")),
    N("automation_error", "error", "Automation step failed", "“Failed payment follow-up”: template variable {{customerEmail}} was empty", 44, true, "/automations"),
    N("subscription", "info", "Renewals this week", `${subscriptions.filter((s) => s.status === "active").slice(0, 3).length} subscriptions renew in the next 7 days`, 30, true, "/subscriptions"),
    N("customer", "info", `New customer: ${customers.at(-1)!.name}`, customers.at(-1)!.company ?? "Individual", 70, true, "/customers"),
    N("integration", "warning", "Demo Mode", "You're exploring sample data. Switch to Real Mode to connect PayPal Sandbox.", 100, true, "/integrations"),
    ...recentPaid.map((t, k) => N("payment", "success", `Payment received — ${t.customerName}`, `${(t.gross / 100).toFixed(2)} ${t.currency} · ${t.description}`, 8 + k * 9, true, "/transactions")),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const emailLogs: EmailLog[] = invoices
    .filter((i) => i.status !== "draft")
    .slice(-8)
    .map((i) => ({ id: nid("eml"), orgId: P.id, to: i.customerEmail, subject: `Invoice ${i.number} from ${P.name}`, template: "invoice" as const, status: "simulated" as const, relatedType: "invoice", relatedId: i.id, createdAt: iso(i.issueDate, 9, 5) }));

  const syncRuns: SyncRun[] = [];

  const activityLogs: ActivityLog[] = [
    { id: nid("log"), orgId: P.id, actor: "Alex Rivera", action: "Opened demo workspace", target: P.name, createdAt: nowIso },
  ];

  const aiConversations: AiConversation[] = [];

  transactions.sort((a, b) => b.date.localeCompare(a.date));
  // Ensure every customer's createdAt <= first transaction
  const firstTx = new Map<string, string>();
  for (const t of transactions) if (t.customerId) firstTx.set(t.customerId, t.date);
  for (const c of customers) {
    const f = firstTx.get(c.id);
    if (f && f < c.createdAt) c.createdAt = c.updatedAt = f;
  }
  void dateKey;

  return {
    version: DEMO_VERSION,
    org,
    transactions,
    customers,
    invoices,
    products,
    subscriptions,
    expenses: expenses.sort((a, b) => b.date.localeCompare(a.date)),
    paymentLinks,
    notifications,
    automations,
    automationRuns,
    tasks,
    aiConversations,
    approvals,
    emailLogs,
    files,
    activityLogs,
    syncRuns,
    webhookEvents: [],
  };
}
