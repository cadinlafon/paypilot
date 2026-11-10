/**
 * Change sweeper — replaces Firestore triggers on Workers.
 *
 * For each collection that has trigger handlers, it reads documents whose
 * `updatedAt` moved past a checkpoint, compares each with a stored "shadow"
 * (the fields triggers care about), and calls the handlers with before/after
 * snapshots. Shadows make it idempotent: a document is processed once per
 * change, no matter how many sweeps see it.
 */
import { getFirestore, DocumentSnapshot } from "./shims/firestore";
import { remaining } from "../../functions/src/lib/budget";

type Trigger = ((e: any) => Promise<unknown> | unknown) & { pattern: string; event: "written" | "created" };
const SHADOW_FIELDS = ["status", "amount", "currency", "date", "gross", "refundedAmount", "updatedAt", "createdAt"];
const PER_COLLECTION = 40;

export async function sweep(triggers: Trigger[]) {
  const db = getFirestore();
  const byCollection = new Map<string, Trigger[]>();
  for (const t of triggers) {
    const parts = t.pattern.split("/");
    const col = parts[parts.length - 2];
    byCollection.set(col, [...(byCollection.get(col) ?? []), t]);
  }
  const cpRef = db.collection("_system").doc("sweep");
  const cp = ((await cpRef.get()).data() ?? {}) as Record<string, string>;
  const now = new Date().toISOString();
  if (!cp.initializedAt) {
    // First run: start from now — never replay history as fresh events.
    await cpRef.set({ initializedAt: now, ...Object.fromEntries([...byCollection.keys()].map((c) => [c, now])) });
    return;
  }
  const next: Record<string, string> = {};
  for (const [col, handlers] of byCollection) {
    if (remaining() < 8) break;
    const since = new Date(Date.parse(cp[col] ?? now) - 2 * 60_000).toISOString(); // overlap for clock skew
    const snap = await db.collectionGroup(col).where("updatedAt", ">", since).orderBy("updatedAt", "asc").limit(PER_COLLECTION).get();
    if (snap.empty) continue;
    const shadowRefs = snap.docs.map((d) => db.collection("_shadows").doc(`${col}__${d.ref.path.split("/")[1]}__${d.id}`));
    const shadows = await db.getAll(...shadowRefs);
    const batch = db.batch();
    let maxSeen = cp[col] ?? since;
    for (let i = 0; i < snap.docs.length; i++) {
      const doc = snap.docs[i];
      const after = doc.data();
      const shadow = shadows[i].exists ? shadows[i].data() : undefined;
      if (after.updatedAt > maxSeen) maxSeen = after.updatedAt;
      if (shadow && shadow.updatedAt === after.updatedAt) continue;
      const params = matchParams(handlers[0].pattern, doc.ref.path);
      // Documents that existed before the sweeper started have no shadow: treat as unchanged history.
      const preexisting = !shadow && (after.createdAt ?? "") < cp.initializedAt;
      const beforeData = shadow ?? (preexisting ? after : undefined);
      const before = beforeData ? { exists: true, id: doc.id, ref: doc.ref, data: () => ({ ...beforeData }) } : { exists: false, id: doc.id, ref: doc.ref, data: () => undefined };
      for (const h of handlers) {
        if (remaining() < 4) break;
        try {
          if (h.event === "created") {
            if (!shadow && !preexisting) await h({ params, data: doc });
          } else await h({ params, data: { before, after: doc as DocumentSnapshot } });
        } catch (e) {
          console.error("trigger failed", h.pattern, doc.ref.path, e);
        }
      }
      batch.set(shadowRefs[i], Object.fromEntries(SHADOW_FIELDS.filter((f) => after[f] !== undefined).map((f) => [f, after[f]])));
    }
    await batch.commit();
    next[col] = maxSeen;
  }
  if (Object.keys(next).length) await cpRef.set(next, { merge: true });
}

function matchParams(pattern: string, path: string): Record<string, string> {
  const p = pattern.split("/"), a = path.split("/");
  const out: Record<string, string> = {};
  p.forEach((seg, i) => {
    const m = /^\{(.+)\}$/.exec(seg);
    if (m) out[m[1]] = a[i];
  });
  return out;
}
