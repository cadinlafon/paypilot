/** Keep converted reporting amounts on expenses in sync with their original amounts. */
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { orgRef } from "../lib/admin";
import { prepareLookup } from "./rates";
import { convertMinor } from "../../../shared/money";
import type { Expense, Organization } from "../../../shared/types";

export const convertExpense = onDocumentWritten("organizations/{orgId}/expenses/{id}", async (ev) => {
  const after = ev.data?.after;
  if (!after?.exists) return;
  const e = after.data() as Expense;
  const org = (await orgRef(ev.params.orgId).get()).data() as Organization | undefined;
  if (!org) return;
  const rc = org.reportingCurrency;
  if (e.currency === rc) {
    if (e.reporting) await after.ref.update({ reporting: null });
    return;
  }
  // Only (re)convert when the original amount, currency or date changed, or no conversion exists yet.
  // Comparing to `before` also prevents this function's own write from re-triggering it forever.
  const before = ev.data?.before?.data() as Expense | undefined;
  const unchanged = before && before.amount === e.amount && before.currency === e.currency && before.date === e.date;
  if (e.reporting && e.reporting.currency === rc && unchanged) return;
  const lookup = await prepareLookup(ev.params.orgId, rc, [e.date]);
  const r = lookup(e.currency, rc, e.date);
  if (!r) return;
  await after.ref.update({ reporting: { currency: rc, amount: convertMinor(e.amount, e.currency, rc, r.rate), rate: r.rate, estimated: r.estimated, provider: r.provider } });
});
