/**
 * Outbound-request budget. Cloudflare Workers (free) allow ~50 subrequests per
 * invocation; Node/Firebase Functions has no such limit (budget = Infinity).
 * Long loops check `remaining()` and stop early, resuming next run via a cursor.
 */
import { db, nowIso } from "./admin";

let used = 0;
let limit = Number.POSITIVE_INFINITY;

export function startBudget(max: number) {
  used = 0;
  limit = max;
}
export function spend(n = 1) {
  used += n;
}
export function remaining() {
  return limit - used;
}

/** Reorder `ids` to start after the saved cursor so every item gets a turn across runs. */
export async function rotate(key: string, ids: string[]): Promise<string[]> {
  if (!Number.isFinite(limit) || ids.length < 2) return ids;
  const c = (await db.collection("_system").doc(`cursor_${key}`).get()).data()?.last as string | undefined;
  const i = c ? ids.indexOf(c) : -1;
  return i < 0 ? ids : [...ids.slice(i + 1), ...ids.slice(0, i + 1)];
}
export async function saveCursor(key: string, last: string) {
  if (!Number.isFinite(limit)) return;
  await db.collection("_system").doc(`cursor_${key}`).set({ last, at: nowIso() });
}
