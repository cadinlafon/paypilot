import type { Dataset, Organization } from "../../../shared/types";
import { orgCol, orgRef } from "./admin";
import { DATASET_TX_LIMIT } from "./params";

/** Load an organization's data for analytics/AI tools (bounded). */
export async function loadDataset(orgId: string): Promise<Dataset> {
  const [org, tx, cu, inv, pr, su, ex, pl] = await Promise.all([
    orgRef(orgId).get(),
    orgCol(orgId, "transactions").orderBy("date", "desc").limit(Math.max(100, Number(DATASET_TX_LIMIT.value()) || 5000)).get(),
    orgCol(orgId, "customers").limit(5000).get(),
    orgCol(orgId, "invoices").limit(3000).get(),
    orgCol(orgId, "products").limit(1000).get(),
    orgCol(orgId, "subscriptions").limit(2000).get(),
    orgCol(orgId, "expenses").limit(5000).get(),
    orgCol(orgId, "paymentLinks").limit(1000).get(),
  ]);
  const rows = <T>(s: { docs: { id: string; data(): unknown }[] }) => s.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T);
  return {
    org: { ...(org.data() as Organization), id: orgId },
    transactions: rows(tx),
    customers: rows(cu),
    invoices: rows(inv),
    products: rows(pr),
    subscriptions: rows(su),
    expenses: rows(ex),
    paymentLinks: rows(pl),
  };
}
