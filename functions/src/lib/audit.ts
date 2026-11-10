import { orgCol, nowIso } from "./admin";
import type { AppNotification } from "../../../shared/types";

export async function audit(orgId: string, actor: string, action: string, target: string, detail?: string) {
  await orgCol(orgId, "activityLogs").add({ orgId, actor, action, target, detail: detail ?? null, createdAt: nowIso() });
}

/** Create a notification if the org's preferences allow that category. */
export async function notify(orgId: string, n: Omit<AppNotification, "id" | "orgId" | "createdAt" | "read">, prefs?: Record<string, boolean>) {
  if (prefs && prefs[n.category] === false) return;
  await orgCol(orgId, "notifications").add({ ...n, orgId, read: false, createdAt: nowIso() });
}
