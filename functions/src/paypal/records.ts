/** Idempotent upserts of PayPal-derived records. Document IDs are deterministic (`pp_<paypal id>`). */
import type { PayPalEnvironment, Transaction, Organization, Customer } from "../../../shared/types";
import { buildReporting } from "../../../shared/money";
import { orgCol, orgRef, nowIso } from "../lib/admin";
import { prepareLookup } from "../fx/rates";

export const txDocId = (externalId: string) => `pp_${externalId.replace(/[^A-Za-z0-9_-]/g, "")}`;

export async function findOrCreateCustomer(orgId: string, email: string | undefined, name: string): Promise<string | undefined> {
  if (!email) return undefined;
  const col = orgCol(orgId, "customers");
  const hit = await col.where("email", "==", email.toLowerCase()).limit(1).get();
  if (!hit.empty) return hit.docs[0].id;
  const now = nowIso();
  const c: Omit<Customer, "id"> = { orgId, source: "paypal", name: name || email, email: email.toLowerCase(), tags: ["paypal"], createdAt: now, updatedAt: now, archivedAt: null };
  return (await col.add(c)).id;
}

/**
 * Resolve many payer emails to customer IDs with ONE read, creating missing
 * customers in a single batch on flush(). Used by bulk sync.
 */
export async function customerResolver(orgId: string) {
  const col = orgCol(orgId, "customers");
  const snap = await col.limit(5000).get();
  const byEmail = new Map<string, string>(snap.docs.map((d) => [String((d.data() as Customer).email ?? "").toLowerCase(), d.id]));
  const pending: { id: string; data: Omit<Customer, "id"> }[] = [];
  return {
    resolve(email: string | undefined, name: string): string | undefined {
      if (!email) return undefined;
      const key = email.toLowerCase();
      const hit = byEmail.get(key);
      if (hit) return hit;
      const id = col.doc().id;
      const now = nowIso();
      byEmail.set(key, id);
      pending.push({ id, data: { orgId, source: "paypal", name: name || email, email: key, tags: ["paypal"], createdAt: now, updatedAt: now, archivedAt: null } });
      return id;
    },
    async flush() {
      for (let i = 0; i < pending.length; i += 400) {
        const b = col.firestore.batch();
        for (const p of pending.slice(i, i + 400)) b.set(col.doc(p.id), p.data);
        await b.commit();
      }
      pending.length = 0;
    },
  };
}

/** Upsert a batch of transactions, adding converted reporting amounts. Original amounts are never modified after creation. */
export async function upsertTransactions(orgId: string, env: PayPalEnvironment, txs: Omit<Transaction, "id" | "orgId" | "createdAt" | "updatedAt" | "reporting">[]) {
  if (!txs.length) return 0;
  const org = (await orgRef(orgId).get()).data() as Organization;
  const rc = org.reportingCurrency;
  const lookup = await prepareLookup(orgId, rc, txs.filter((t) => t.currency !== rc).map((t) => t.date.slice(0, 10)));
  let n = 0;
  const col = orgCol(orgId, "transactions");
  for (let i = 0; i < txs.length; i += 400) {
    const batch = orgCol(orgId, "transactions").firestore.batch();
    for (const t of txs.slice(i, i + 400)) {
      const id = txDocId(t.externalId!);
      const ref = col.doc(id);
      const now = nowIso();
      const reporting = buildReporting(t, rc, lookup);
      // merge: keep original amounts/creation, refresh status, fees, refunds, conversion
      // createdAt = transaction date (stable across re-syncs, unlike "now").
      batch.set(ref, { ...t, orgId, environment: env, source: "paypal", reporting: reporting ?? null, updatedAt: now, createdAt: t.date }, { merge: true });
      n++;
    }
    await batch.commit();
  }
  return n;
}
