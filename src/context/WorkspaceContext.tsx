/**
 * Workspace = (mode, organization, repository, permissions).
 *
 * Demo and Real are entirely separate data sources: switching mode swaps the
 * repository object, which tears down every listener and cache. Demo records
 * can never appear in Real Mode and vice-versa.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import type { AppMode, Dataset, Member, Organization, Permission, PayPalConnectionPublic, PayPalConnectionState } from "@shared/types";
import { ALL_PERMISSIONS, hasPermission } from "@shared/permissions";
import type { CollectionMap, CollectionName, Repository } from "@/data/repository";
import { createDemoRepository } from "@/data/demo/demoRepository";
import { createFirestoreRepository } from "@/data/real/firestoreRepository";
import { DEMO_PROFILES } from "@/data/demo/seed";
import { db, callFn } from "@/lib/firebase";
import { firebaseConfigured } from "@/lib/config";
import { useAuth } from "./AuthContext";

export interface OrgSummary {
  id: string;
  name: string;
  roleId?: string;
}

type CacheEntry = { rows: unknown[]; loading: boolean; error: Error | null; listeners: Set<() => void>; unsub?: () => void };

class CollectionCache {
  entries = new Map<string, CacheEntry>();
  constructor(public repo: Repository) {}
  entry(name: CollectionName): CacheEntry {
    let e = this.entries.get(name);
    if (!e) {
      e = { rows: [], loading: true, error: null, listeners: new Set() };
      this.entries.set(name, e);
      const ent = e;
      ent.unsub = this.repo.subscribe(
        name,
        (rows) => {
          ent.rows = rows;
          ent.loading = false;
          ent.error = null;
          ent.listeners.forEach((l) => l());
        },
        (err) => {
          ent.error = err;
          ent.loading = false;
          ent.listeners.forEach((l) => l());
        },
      );
    }
    return e;
  }
  dispose() {
    this.entries.forEach((e) => e.unsub?.());
    this.entries.clear();
  }
}

interface WorkspaceCtx {
  mode: AppMode;
  requestMode(m: AppMode): void;
  /** Register/unregister an unsaved-changes guard (e.g. an open invoice editor). */
  setDirty(key: string, dirty: boolean): void;
  pendingMode: AppMode | null;
  confirmPendingMode(confirm: boolean): void;

  org: Organization | null;
  orgs: OrgSummary[];
  orgId: string | null;
  switchOrg(id: string): void;
  orgsLoading: boolean;
  refreshOrgs(): void;

  repo: Repository | null;
  cache: CollectionCache | null;
  member: Member | null;
  permissions: Permission[];
  can(p: Permission): boolean;

  paypal: PayPalConnectionPublic | null;
  paypalState: PayPalConnectionState;
  /** Why Real Mode can't load data, if it can't. */
  realBlocker: null | "firebase_not_configured" | "guest" | "no_org" | "email_unverified";
}

const Ctx = createContext<WorkspaceCtx | null>(null);
const LS = { mode: "paypilot:mode", demoOrg: "paypilot:demoOrg", realOrg: "paypilot:realOrg" };
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [mode, setMode] = useState<AppMode>(() => (read(LS.mode) === "real" ? "real" : "demo"));
  const [pendingMode, setPendingMode] = useState<AppMode | null>(null);
  const dirty = useRef(new Set<string>());
  const [demoOrgId, setDemoOrgId] = useState(() => read(LS.demoOrg) ?? DEMO_PROFILES[0].id);
  const [realOrgId, setRealOrgId] = useState<string | null>(() => read(LS.realOrg));
  const [realOrgs, setRealOrgs] = useState<OrgSummary[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgsNonce, setOrgsNonce] = useState(0);
  const [org, setOrg] = useState<Organization | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [paypal, setPaypal] = useState<PayPalConnectionPublic | null>(null);

  // Join any organizations this verified email was invited to (server validates).
  useEffect(() => {
    if (!firebaseConfigured || !user || user.isGuest || !user.emailVerified) return;
    callFn<object, { joined: number }>("claimInvites", {}).catch(() => undefined);
  }, [user]);

  // Real orgs: users/{uid}.orgs is maintained server-side on create/invite.
  useEffect(() => {
    if (!db || !user || user.isGuest) {
      setRealOrgs([]);
      return;
    }
    setOrgsLoading(true);
    return onSnapshot(
      doc(db, "users", user.uid),
      (d) => {
        const list = ((d.data()?.orgs as OrgSummary[] | undefined) ?? []).filter((o) => o && o.id);
        setRealOrgs(list);
        setOrgsLoading(false);
        setRealOrgId((cur) => (cur && list.some((o) => o.id === cur) ? cur : (list[0]?.id ?? null)));
      },
      () => setOrgsLoading(false),
    );
  }, [user, orgsNonce]);

  const realBlocker: WorkspaceCtx["realBlocker"] = !firebaseConfigured ? "firebase_not_configured" : !user || user.isGuest ? "guest" : !user.emailVerified ? "email_unverified" : !realOrgId ? "no_org" : null;

  const repo = useMemo<Repository | null>(() => {
    if (!user) return null;
    if (mode === "demo") return createDemoRepository(demoOrgId, user.displayName);
    if (realBlocker || !db || !realOrgId) return null;
    return createFirestoreRepository(db, realOrgId, user.uid);
  }, [mode, demoOrgId, realOrgId, user, realBlocker]);

  const cache = useMemo(() => (repo ? new CollectionCache(repo) : null), [repo]);
  useEffect(() => () => cache?.dispose(), [cache]);

  useEffect(() => {
    setOrg(null);
    setPaypal(null);
    if (!repo) return;
    const a = repo.subscribeOrg(setOrg);
    const b = repo.subscribePayPal(setPaypal);
    return () => {
      a();
      b();
    };
  }, [repo]);

  useEffect(() => {
    setMember(null);
    if (!repo || !user) return;
    if (repo.mode === "demo") {
      setMember({ uid: user.uid, email: user.email, displayName: user.displayName, roleId: "owner", permissions: ALL_PERMISSIONS.map((p) => p.id), status: "active", joinedAt: new Date().toISOString() });
      return;
    }
    return onSnapshot(doc(db!, "organizations", repo.orgId, "members", user.uid), (d) => setMember(d.exists() ? ({ ...(d.data() as Member), uid: d.id }) : null), () => setMember(null));
  }, [repo, user]);

  const applyMode = useCallback((m: AppMode) => {
    setMode(m);
    write(LS.mode, m);
    dirty.current.clear();
  }, []);

  const requestMode = useCallback(
    (m: AppMode) => {
      if (m === mode) return;
      if (dirty.current.size > 0) setPendingMode(m);
      else applyMode(m);
    },
    [mode, applyMode],
  );

  const switchOrg = useCallback(
    (id: string) => {
      if (mode === "demo") {
        setDemoOrgId(id);
        write(LS.demoOrg, id);
      } else {
        setRealOrgId(id);
        write(LS.realOrg, id);
      }
    },
    [mode],
  );

  const permissions = member?.status === "active" ? member.permissions : [];
  const paypalState: PayPalConnectionState = mode === "demo" || !paypal || paypal.status !== "connected" ? "not_connected" : paypal.environment;

  const value: WorkspaceCtx = {
    mode,
    requestMode,
    setDirty: (k, d) => (d ? dirty.current.add(k) : dirty.current.delete(k)),
    pendingMode,
    confirmPendingMode: (ok) => {
      if (ok && pendingMode) applyMode(pendingMode);
      setPendingMode(null);
    },
    org,
    orgs: mode === "demo" ? DEMO_PROFILES.map((p) => ({ id: p.id, name: p.name, roleId: "owner" })) : realOrgs,
    orgId: mode === "demo" ? demoOrgId : realOrgId,
    switchOrg,
    orgsLoading,
    refreshOrgs: () => setOrgsNonce((n) => n + 1),
    repo,
    cache,
    member,
    permissions,
    can: (p) => hasPermission(permissions, p),
    paypal: mode === "demo" ? null : paypal,
    paypalState,
    realBlocker: mode === "real" ? realBlocker : null,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWorkspace outside WorkspaceProvider");
  return c;
}

const EMPTY: never[] = [];
const noop = () => () => {};

export function useCollection<K extends CollectionName>(name: K): { rows: CollectionMap[K][]; loading: boolean; error: Error | null } {
  const { cache } = useWorkspace();
  const entry = cache?.entry(name);
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!entry) return noop();
      entry.listeners.add(cb);
      return () => entry.listeners.delete(cb);
    },
    [entry],
  );
  const rows = useSyncExternalStore(subscribe, () => (entry?.rows ?? EMPTY) as CollectionMap[K][]);
  const loading = useSyncExternalStore(subscribe, () => entry?.loading ?? true);
  const error = useSyncExternalStore(subscribe, () => entry?.error ?? null);
  return { rows, loading, error };
}

/** Active (non-archived) rows. */
export function useActive<K extends CollectionName>(name: K) {
  const r = useCollection(name);
  const rows = useMemo(() => r.rows.filter((x: any) => !x.archivedAt), [r.rows]);
  return { ...r, rows };
}

export function useDataset(): { ds: Dataset | null; loading: boolean; error: Error | null } {
  const { org } = useWorkspace();
  const t = useCollection("transactions");
  const c = useCollection("customers");
  const i = useCollection("invoices");
  const p = useCollection("products");
  const s = useCollection("subscriptions");
  const e = useCollection("expenses");
  const l = useCollection("paymentLinks");
  const loading = !org || [t, c, i, p, s, e, l].some((x) => x.loading);
  const error = [t, c, i, p, s, e, l].find((x) => x.error)?.error ?? null;
  const ds = useMemo<Dataset | null>(
    () => (org ? { org, transactions: t.rows, customers: c.rows, invoices: i.rows, products: p.rows, subscriptions: s.rows, expenses: e.rows, paymentLinks: l.rows } : null),
    [org, t.rows, c.rows, i.rows, p.rows, s.rows, e.rows, l.rows],
  );
  return { ds, loading, error };
}
