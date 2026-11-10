// Firestore security rules tests. Run: npm run test:rules
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc } from "firebase/firestore";

const env = await initializeTestEnvironment({ projectId: "demo-paypilot", firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 } });
const ORG = "org_test_1", OTHER = "org_test_2";
const now = new Date().toISOString();
const ALL = ["transactions.view","transactions.refund","invoices.view","invoices.edit","invoices.send","customers.view","customers.edit","products.view","products.edit","expenses.view","expenses.edit","automations.view","automations.configure","notifications.view","ai.use","reports.view","settings.manage","users.manage","integrations.manage"];
const VIEWER = ALL.filter((p) => p.endsWith(".view"));

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const o of [ORG, OTHER]) await setDoc(doc(db, "organizations", o), { name: o, reportingCurrency: "USD", timezone: "UTC" });
  await setDoc(doc(db, `organizations/${ORG}/members/owner`), { status: "active", roleId: "owner", permissions: ALL });
  await setDoc(doc(db, `organizations/${ORG}/members/viewer`), { status: "active", roleId: "viewer", permissions: VIEWER });
  await setDoc(doc(db, `organizations/${ORG}/members/suspended`), { status: "suspended", roleId: "owner", permissions: ALL });
  await setDoc(doc(db, `organizations/${ORG}/private/paypal_sandbox`), { secretEnc: "x" });
  await setDoc(doc(db, `organizations/${ORG}/transactions/t1`), { gross: 100 });
  await setDoc(doc(db, `organizations/${ORG}/invoices/draft1`), { orgId: ORG, source: "manual", status: "draft", number: "INV-1", lines: [{}], payments: [], currency: "USD", createdAt: now, createdBy: "owner" });
  await setDoc(doc(db, `organizations/${ORG}/invoices/sent1`), { orgId: ORG, source: "manual", status: "sent", number: "INV-2", lines: [{}], payments: [], currency: "USD", createdAt: now, createdBy: "owner" });
  await setDoc(doc(db, `organizations/${ORG}/notifications/n1`), { read: false, title: "x" });
  await setDoc(doc(db, `organizations/${OTHER}/transactions/t9`), { gross: 1 });
});

const as = (uid) => env.authenticatedContext(uid, { email_verified: true }).firestore();
const owner = as("owner"), viewer = as("viewer"), suspended = as("suspended"), stranger = as("stranger"), anon = env.unauthenticatedContext().firestore();
const base = (uid) => ({ orgId: ORG, source: "manual", createdBy: uid, createdAt: now, updatedAt: now, archivedAt: null });

let passed = 0, failed = 0;
async function t(name, p) {
  try { await p; passed++; console.log("  ✓", name); } catch (e) { failed++; console.log("  ✗", name, "—", e.message?.split("\n")[0]); }
}

console.log("Isolation");
await t("member reads own org transactions", assertSucceeds(getDoc(doc(owner, `organizations/${ORG}/transactions/t1`))));
await t("member cannot read another org", assertFails(getDoc(doc(owner, `organizations/${OTHER}/transactions/t9`))));
await t("stranger cannot read org", assertFails(getDoc(doc(stranger, `organizations/${ORG}`))));
await t("anonymous cannot read", assertFails(getDoc(doc(anon, `organizations/${ORG}/transactions/t1`))));
await t("suspended member denied", assertFails(getDoc(doc(suspended, `organizations/${ORG}/transactions/t1`))));
await t("credentials never readable (even owner)", assertFails(getDoc(doc(owner, `organizations/${ORG}/private/paypal_sandbox`))));

console.log("Server-only data");
await t("client cannot write transactions", assertFails(setDoc(doc(owner, `organizations/${ORG}/transactions/t2`), { gross: 1 })));
await t("client cannot change own permissions", assertFails(updateDoc(doc(viewer, `organizations/${ORG}/members/viewer`), { permissions: ALL })));
await t("client cannot create approvals", assertFails(addDoc(collection(owner, `organizations/${ORG}/aiActions`), { status: "approved" })));
await t("client cannot create payment links", assertFails(addDoc(collection(owner, `organizations/${ORG}/paymentLinks`), { url: "x" })));
await t("client cannot write org doc", assertFails(updateDoc(doc(owner, `organizations/${ORG}`), { name: "hack" })));

console.log("Permissions");
await t("editor creates customer", assertSucceeds(addDoc(collection(owner, `organizations/${ORG}/customers`), { ...base("owner"), name: "A", email: "a@b.co", tags: [] })));
await t("viewer cannot create customer", assertFails(addDoc(collection(viewer, `organizations/${ORG}/customers`), { ...base("viewer"), name: "A", email: "a@b.co", tags: [] })));
await t("customer orgId must match path", assertFails(addDoc(collection(owner, `organizations/${ORG}/customers`), { ...base("owner"), orgId: OTHER, name: "A", email: "a@b.co", tags: [] })));
await t("cannot spoof source=paypal", assertFails(addDoc(collection(owner, `organizations/${ORG}/customers`), { ...base("owner"), source: "paypal", name: "A", email: "a@b.co", tags: [] })));
await t("no hard deletes", assertFails(deleteDoc(doc(owner, `organizations/${ORG}/invoices/draft1`))));

console.log("Invoices");
await t("create draft invoice", assertSucceeds(addDoc(collection(owner, `organizations/${ORG}/invoices`), { ...base("owner"), status: "draft", number: "INV-9", currency: "USD", lines: [{}], payments: [] })));
await t("cannot create invoice as sent", assertFails(addDoc(collection(owner, `organizations/${ORG}/invoices`), { ...base("owner"), status: "sent", number: "INV-8", currency: "USD", lines: [{}], payments: [] })));
await t("cannot move draft to sent from client", assertFails(updateDoc(doc(owner, `organizations/${ORG}/invoices/draft1`), { status: "sent" })));
await t("can cancel draft", assertSucceeds(updateDoc(doc(owner, `organizations/${ORG}/invoices/draft1`), { status: "cancelled" })));
await t("can record payment on sent invoice", assertSucceeds(updateDoc(doc(owner, `organizations/${ORG}/invoices/sent1`), { status: "paid", payments: [{ amount: 1 }] })));
await t("cannot edit lines of sent invoice", assertFails(updateDoc(doc(owner, `organizations/${ORG}/invoices/sent1`), { lines: [{}, {}] })));

console.log("Expenses & notifications");
await t("create expense", assertSucceeds(addDoc(collection(owner, `organizations/${ORG}/expenses`), { ...base("owner"), name: "Rent", amount: 1000, currency: "USD", date: "2026-01-01", taxAmount: 0 })));
await t("cannot set FX conversion from client", assertFails(addDoc(collection(owner, `organizations/${ORG}/expenses`), { ...base("owner"), name: "Rent", amount: 1000, currency: "EUR", date: "2026-01-01", taxAmount: 0, reporting: { amount: 1 } })));
await t("negative expense rejected", assertFails(addDoc(collection(owner, `organizations/${ORG}/expenses`), { ...base("owner"), name: "Rent", amount: -5, currency: "USD", date: "2026-01-01", taxAmount: 0 })));
await t("mark notification read", assertSucceeds(updateDoc(doc(viewer, `organizations/${ORG}/notifications/n1`), { read: true })));
await t("cannot rewrite notification body", assertFails(updateDoc(doc(viewer, `organizations/${ORG}/notifications/n1`), { title: "phish" })));

await env.cleanup();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
