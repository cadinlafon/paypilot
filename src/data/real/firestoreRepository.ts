/**
 * Real Mode repository — the authenticated user's actual organization.
 *
 * Reads: live Firestore listeners scoped to organizations/{orgId}/…
 *        (Firestore rules enforce membership + per-collection permissions).
 * Writes: only internal business records (customers, products, invoice
 *        drafts, expenses, automations, tasks, notification read-state) are
 *        written directly, and rules re-check permissions.
 * Everything privileged or external (PayPal, email, AI, files, approvals,
 *        sync) is a Cloud Function call; the server re-validates the caller.
 */
import { addDoc, collection, doc, limit as qlimit, onSnapshot, orderBy, query, updateDoc, type Firestore } from "firebase/firestore";
import type { AutomationRun, FileRecord, Organization, PaymentLink, PayPalConnectionPublic } from "@shared/types";
import type { ActionResult, AiChatResponse, CollectionName, Repository, SendEmailInput } from "../repository";
import { CLIENT_WRITABLE } from "../repository";
import { callFn, nudgeServer } from "@/lib/firebase";

const PATH: Partial<Record<CollectionName, string>> = { approvals: "aiActions", syncRuns: "syncHistory" };
const ORDER: Partial<Record<CollectionName, [string, number]>> = {
  transactions: ["date", 5000],
  automationRuns: ["triggeredAt", 300],
  activityLogs: ["createdAt", 300],
  emailLogs: ["createdAt", 300],
  syncRuns: ["startedAt", 100],
  webhookEvents: ["receivedAt", 200],
  notifications: ["createdAt", 300],
};

function stripUndefined<T extends object>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export function createFirestoreRepository(db: Firestore, orgId: string, uid: string): Repository {
  const col = (n: CollectionName) => collection(db, "organizations", orgId, PATH[n] ?? n);
  const now = () => new Date().toISOString();

  return {
    mode: "real",
    orgId,

    subscribe(name, cb, onError) {
      const [field, n] = ORDER[name] ?? ["createdAt", 2000];
      const q = query(col(name), orderBy(field, "desc"), qlimit(n));
      return onSnapshot(
        q,
        (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as object), id: d.id })) as any),
        (err) => onError?.(err),
      );
    },

    async create(name, data) {
      if (!CLIENT_WRITABLE.includes(name)) throw new Error(`${name} can only be created by the server`);
      const rec = stripUndefined({ ...(data as object), orgId, source: "manual", createdAt: now(), updatedAt: now(), archivedAt: null, createdBy: uid });
      const ref = await addDoc(col(name), rec);
      if (name === "customers" || name === "expenses") nudgeServer();
      return { ...rec, id: ref.id } as any;
    },

    async update(name, id, patch) {
      if (!CLIENT_WRITABLE.includes(name)) throw new Error(`${name} can only be changed by the server`);
      await updateDoc(doc(col(name), id), stripUndefined({ ...(patch as object), updatedAt: now(), updatedBy: uid }) as any);
      if (name === "expenses") nudgeServer();
    },

    async archive(name, id) {
      if (!CLIENT_WRITABLE.includes(name)) throw new Error(`${name} can only be archived by the server`);
      await updateDoc(doc(col(name), id), { archivedAt: now(), updatedAt: now(), updatedBy: uid });
    },

    subscribeOrg(cb) {
      return onSnapshot(
        doc(db, "organizations", orgId),
        (d) => cb(d.exists() ? ({ ...(d.data() as object), id: d.id } as Organization) : null),
        () => cb(null),
      );
    },

    async updateOrg(patch) {
      await callFn("updateOrganization", { orgId, patch });
    },

    subscribePayPal(cb) {
      const state: Record<string, PayPalConnectionPublic | null> = { sandbox: null, live: null };
      const pick = () => cb(state.live?.status === "connected" ? state.live : state.sandbox ?? state.live);
      const unsubs = (["sandbox", "live"] as const).map((env) =>
        onSnapshot(
          doc(db, "organizations", orgId, "paypalConnections", env),
          (d) => {
            state[env] = d.exists() ? (d.data() as PayPalConnectionPublic) : null;
            pick();
          },
          () => pick(),
        ),
      );
      return () => unsubs.forEach((u) => u());
    },

    refund: (transactionId: string, amount: number, reason: string) => callFn<object, ActionResult>("paypalRefund", { orgId, transactionId, amount, reason }),
    capture: (transactionId: string) => callFn<object, ActionResult>("paypalCapture", { orgId, transactionId }),
    sendInvoice: (invoiceId: string) => callFn<object, ActionResult>("sendInvoice", { orgId, invoiceId }),
    sendEmail: (input: SendEmailInput) => callFn<object, ActionResult>("requestEmail", { orgId, ...input }),
    createPaymentLink: (input) => callFn<object, PaymentLink>("createPaymentLink", { orgId, ...input }),
    setPaymentLinkStatus: async (id, status) => {
      await callFn("setPaymentLinkStatus", { orgId, id, status });
    },
    syncNow: (kind = "manual") => callFn<object, ActionResult>("paypalSyncNow", { orgId, kind }),

    async uploadFile(file, purpose, related) {
      const data = await fileToBase64(file);
      return callFn<object, FileRecord>("uploadFile", { orgId, name: file.name, contentType: file.type, size: file.size, purpose, related, data });
    },
    async getFileUrl(fileId) {
      const r = await callFn<object, { url: string }>("getFileUrl", { orgId, fileId });
      return r.url;
    },

    aiChat: (conversationId, message, model) => callFn<object, AiChatResponse>("aiChat", { orgId, conversationId, message, model }),
    decideApproval: (id, approve) => callFn<object, ActionResult>("decideApproval", { orgId, id, approve }),
    runAutomation: (automationId, { test }) => callFn<object, AutomationRun>("runAutomation", { orgId, automationId, test }),
    retryAutomationRun: (runId) => callFn<object, AutomationRun>("retryAutomationRun", { orgId, runId }),
  };
}
