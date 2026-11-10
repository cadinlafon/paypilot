/**
 * A small `firebase-admin/firestore` stand-in for Cloudflare Workers, built on
 * the Firestore REST API (the Node Admin SDK can't run on Workers). It
 * implements exactly the subset PayPilot's server code uses:
 *   collection/doc/collectionGroup, where/orderBy/limit queries, get/getAll,
 *   set (with merge), update, add, delete, batches, transactions and
 *   FieldValue.increment.
 * Like the Admin SDK, it uses a service account and bypasses security rules.
 */
import { counted, emulator, googleToken, projectId } from "../runtime";

// ── Sentinels ──────────────────────────────────────────────────────────────
class Increment {
  constructor(public n: number) {}
}
class DeleteField {}
export const FieldValue = {
  increment: (n: number) => new Increment(n),
  delete: () => new DeleteField(),
};

// ── Value encoding ─────────────────────────────────────────────────────────
type Value = Record<string, unknown>;

function encode(v: unknown): Value {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter((x) => x !== undefined).map(encode) } };
  if (typeof v === "object") return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } };
  throw new Error(`Unsupported Firestore value: ${typeof v}`);
}
function encodeFields(o: Record<string, unknown>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v instanceof Increment || v instanceof DeleteField) continue;
    out[k] = encode(v);
  }
  return out;
}
function decode(v: Value): unknown {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("referenceValue" in v) return v.referenceValue;
  if ("arrayValue" in v) return ((v.arrayValue as { values?: Value[] }).values ?? []).map(decode);
  if ("mapValue" in v) return decodeFields((v.mapValue as { fields?: Record<string, Value> }).fields ?? {});
  return null;
}
function decodeFields(f: Record<string, Value>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) out[k] = decode(v);
  return out;
}
const fieldPath = (p: string) => p.split(".").map((s) => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(s) ? s : "`" + s.replace(/`/g, "\\`") + "`")).join(".");

// ── HTTP ───────────────────────────────────────────────────────────────────
// Resource names (in request bodies) use "(default)"; URL paths percent-encode it —
// production accepts both, but the emulator only routes the encoded form.
const root = () => `projects/${projectId()}/databases/(default)/documents`;
const urlRoot = () => `projects/${projectId()}/databases/%28default%29/documents`;
const api = () => (emulator() ? `http://${emulator()}/v1` : "https://firestore.googleapis.com/v1");
const docName = (path: string) => `${root()}/${path}`;

export class FirestoreError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await counted(url, {
      method,
      headers: { Authorization: `Bearer ${await googleToken()}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = JSON.parse(text).error?.message ?? msg;
      } catch {
        /* keep text */
      }
      throw new FirestoreError(res.status, `Firestore ${res.status}: ${msg}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
}

// ── Snapshots ──────────────────────────────────────────────────────────────
export class DocumentSnapshot {
  constructor(public ref: DocumentReference, private fields: Record<string, unknown> | null) {}
  get exists() {
    return this.fields !== null;
  }
  get id() {
    return this.ref.id;
  }
  data(): any {
    return this.fields === null ? undefined : { ...this.fields };
  }
  get(path: string): any {
    return path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), this.fields);
  }
}
export class QuerySnapshot {
  constructor(public docs: DocumentSnapshot[]) {}
  get empty() {
    return this.docs.length === 0;
  }
  get size() {
    return this.docs.length;
  }
  forEach(fn: (d: DocumentSnapshot) => void) {
    this.docs.forEach(fn);
  }
}

function snapFromDoc(fs: Firestore, d: { name: string; fields?: Record<string, Value> }): DocumentSnapshot {
  const rel = d.name.slice(d.name.indexOf("/documents/") + "/documents/".length);
  return new DocumentSnapshot(fs.doc(rel), decodeFields(d.fields ?? {}));
}

// ── References & queries ───────────────────────────────────────────────────
const AUTO_ID = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function autoId() {
  const b = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(b, (x) => AUTO_ID[x % AUTO_ID.length]).join("");
}

type Op = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "array-contains";
const OPS: Record<Op, string> = { "==": "EQUAL", "!=": "NOT_EQUAL", "<": "LESS_THAN", "<=": "LESS_THAN_OR_EQUAL", ">": "GREATER_THAN", ">=": "GREATER_THAN_OR_EQUAL", in: "IN", "array-contains": "ARRAY_CONTAINS" };

export class Query {
  constructor(
    public firestore: Firestore,
    protected parentPath: string, // "" for root
    protected collectionId: string,
    protected allDescendants = false,
    protected filters: { field: string; op: Op; value: unknown }[] = [],
    protected orders: { field: string; dir: "asc" | "desc" }[] = [],
    protected max?: number,
  ) {}
  where(field: string, op: Op, value: unknown): Query {
    return new Query(this.firestore, this.parentPath, this.collectionId, this.allDescendants, [...this.filters, { field, op, value }], this.orders, this.max);
  }
  orderBy(field: string, dir: "asc" | "desc" = "asc"): Query {
    return new Query(this.firestore, this.parentPath, this.collectionId, this.allDescendants, this.filters, [...this.orders, { field, dir }], this.max);
  }
  limit(n: number): Query {
    return new Query(this.firestore, this.parentPath, this.collectionId, this.allDescendants, this.filters, this.orders, n);
  }
  async get(): Promise<QuerySnapshot> {
    const fieldFilters = this.filters.map((f) => ({ fieldFilter: { field: { fieldPath: fieldPath(f.field) }, op: OPS[f.op], value: encode(f.value) } }));
    const sq: Record<string, unknown> = { from: [{ collectionId: this.collectionId, allDescendants: this.allDescendants }] };
    if (fieldFilters.length === 1) sq.where = fieldFilters[0];
    else if (fieldFilters.length > 1) sq.where = { compositeFilter: { op: "AND", filters: fieldFilters } };
    if (this.orders.length) sq.orderBy = this.orders.map((o) => ({ field: { fieldPath: fieldPath(o.field) }, direction: o.dir === "desc" ? "DESCENDING" : "ASCENDING" }));
    if (this.max) sq.limit = this.max;
    const parent = this.parentPath ? `${urlRoot()}/${this.parentPath}` : urlRoot();
    const rows = await call<{ document?: { name: string; fields?: Record<string, Value> } }[]>("POST", `${api()}/${parent}:runQuery`, { structuredQuery: sq });
    return new QuerySnapshot(rows.filter((r) => r.document).map((r) => snapFromDoc(this.firestore, r.document!)));
  }
}

export class CollectionReference extends Query {
  constructor(firestore: Firestore, public path: string) {
    const i = path.lastIndexOf("/");
    super(firestore, i < 0 ? "" : path.slice(0, i), i < 0 ? path : path.slice(i + 1));
  }
  get id() {
    return this.collectionId;
  }
  get parent(): DocumentReference | null {
    return this.parentPath ? new DocumentReference(this.firestore, this.parentPath) : null;
  }
  doc(id?: string): DocumentReference {
    return new DocumentReference(this.firestore, `${this.path}/${id ?? autoId()}`);
  }
  async add(data: object): Promise<DocumentReference> {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

export class DocumentReference {
  constructor(public firestore: Firestore, public path: string) {}
  get id() {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }
  get parent(): CollectionReference {
    return new CollectionReference(this.firestore, this.path.slice(0, this.path.lastIndexOf("/")));
  }
  collection(name: string) {
    return new CollectionReference(this.firestore, `${this.path}/${name}`);
  }
  async get(transaction?: string): Promise<DocumentSnapshot> {
    try {
      const d = await call<{ name: string; fields?: Record<string, Value> }>("GET", `${api()}/${urlRoot()}/${this.path}${transaction ? `?transaction=${encodeURIComponent(transaction)}` : ""}`);
      return snapFromDoc(this.firestore, d);
    } catch (e) {
      if (e instanceof FirestoreError && e.status === 404) return new DocumentSnapshot(this, null);
      throw e;
    }
  }
  set(data: object, opts?: { merge?: boolean }) {
    return this.firestore._commit([buildWrite(this.path, data, opts?.merge ? "merge" : "set")]);
  }
  update(data: object) {
    return this.firestore._commit([buildWrite(this.path, data, "update")]);
  }
  delete() {
    return this.firestore._commit([{ delete: docName(this.path) }]);
  }
}

// ── Writes ─────────────────────────────────────────────────────────────────
function buildWrite(path: string, data: object, mode: "set" | "merge" | "update") {
  const clean: Record<string, unknown> = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  const transforms = Object.entries(clean)
    .filter(([, v]) => v instanceof Increment)
    .map(([k, v]) => ({ fieldPath: fieldPath(k), increment: encode((v as Increment).n) }));
  const deletes = Object.entries(clean).filter(([, v]) => v instanceof DeleteField).map(([k]) => k);
  const plain = Object.keys(clean).filter((k) => !(clean[k] instanceof Increment));
  const w: Record<string, unknown> = { update: { name: docName(path), fields: encodeFields(clean) } };
  if (mode !== "set") w.updateMask = { fieldPaths: [...plain, ...deletes].filter((v, i, a) => a.indexOf(v) === i).map(fieldPath) };
  if (mode === "update") w.currentDocument = { exists: true };
  if (transforms.length) w.updateTransforms = transforms;
  return w;
}

export class WriteBatch {
  private writes: Record<string, unknown>[] = [];
  constructor(private fs: Firestore, private transaction?: string) {}
  set(ref: DocumentReference, data: object, opts?: { merge?: boolean }) {
    this.writes.push(buildWrite(ref.path, data, opts?.merge ? "merge" : "set"));
    return this;
  }
  update(ref: DocumentReference, data: object) {
    this.writes.push(buildWrite(ref.path, data, "update"));
    return this;
  }
  delete(ref: DocumentReference) {
    this.writes.push({ delete: docName(ref.path) });
    return this;
  }
  async commit() {
    if (!this.writes.length && !this.transaction) return;
    await this.fs._commit(this.writes, this.transaction);
  }
}

class Transaction {
  private batch: WriteBatch;
  constructor(private fs: Firestore, private id: string) {
    this.batch = new WriteBatch(fs, id);
  }
  async get(ref: DocumentReference) {
    return (await this.fs._batchGet([ref], this.id))[0];
  }
  set(ref: DocumentReference, data: object, opts?: { merge?: boolean }) {
    this.batch.set(ref, data, opts);
    return this;
  }
  update(ref: DocumentReference, data: object) {
    this.batch.update(ref, data);
    return this;
  }
  delete(ref: DocumentReference) {
    this.batch.delete(ref);
    return this;
  }
  commit() {
    return this.batch.commit();
  }
}

export class Firestore {
  settings(_: unknown) {}
  collection(path: string) {
    return new CollectionReference(this, path);
  }
  doc(path: string) {
    return new DocumentReference(this, path);
  }
  collectionGroup(id: string) {
    return new Query(this, "", id, true);
  }
  batch() {
    return new WriteBatch(this);
  }
  async getAll(...refs: DocumentReference[]): Promise<DocumentSnapshot[]> {
    return this._batchGet(refs);
  }
  /** @internal batchGet, optionally inside a transaction (used for all transactional reads). */
  async _batchGet(refs: DocumentReference[], transaction?: string): Promise<DocumentSnapshot[]> {
    if (!refs.length) return [];
    const rows = await call<{ found?: { name: string; fields?: Record<string, Value> }; missing?: string }[]>("POST", `${api()}/${urlRoot()}:batchGet`, transaction ? { documents: refs.map((r) => docName(r.path)), transaction } : { documents: refs.map((r) => docName(r.path)) });
    const byName = new Map<string, DocumentSnapshot>();
    for (const r of rows) {
      if (r.found) byName.set(r.found.name, snapFromDoc(this, r.found));
    }
    return refs.map((r) => byName.get(docName(r.path)) ?? new DocumentSnapshot(r, null));
  }
  async runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const { transaction } = await call<{ transaction: string }>("POST", `${api()}/${urlRoot()}:beginTransaction`, {});
      const tx = new Transaction(this, transaction);
      try {
        const result = await fn(tx);
        await tx.commit();
        return result;
      } catch (e) {
        const retryable = e instanceof FirestoreError && (e.status === 409 || e.status === 412) && attempt < 4;
        if (!retryable) {
          await call("POST", `${api()}/${urlRoot()}:rollback`, { transaction }).catch(() => undefined);
          throw e;
        }
      }
    }
  }
  /** @internal */
  async _commit(writes: Record<string, unknown>[], transaction?: string) {
    await call("POST", `${api()}/${urlRoot()}:commit`, transaction ? { writes, transaction } : { writes });
  }
}

let instance: Firestore | null = null;
export function getFirestore(): Firestore {
  return (instance ??= new Firestore());
}
