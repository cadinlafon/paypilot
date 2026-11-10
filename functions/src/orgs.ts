/** Organization lifecycle, membership and roles. All writes are server-side. */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, orgCol, orgRef, nowIso, FieldValue } from "./lib/admin";
import { requireAuth, requireMember, rateLimit, str, safeError, EMAIL, CURRENCY } from "./lib/guard";
import { audit } from "./lib/audit";
import { SYSTEM_ROLES, isValidPermission } from "../../shared/permissions";
import { SUPPORTED_CURRENCIES } from "../../shared/money";
import type { Member, NotificationCategory, Organization, OrgSettings, Permission, Role } from "../../shared/types";

const CATEGORIES: NotificationCategory[] = ["payment", "payment_failed", "customer", "invoice", "invoice_overdue", "subscription", "automation_error", "ai_insight", "integration"];
const SYNC = ["15m", "30m", "1h", "6h", "24h", "manual"];

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function rolePermissions(orgId: string, roleId: string): Promise<Permission[]> {
  const sys = SYSTEM_ROLES.find((r) => r.id === roleId);
  if (sys) return sys.permissions;
  const s = await orgCol(orgId, "roles").doc(roleId).get();
  if (!s.exists) throw new HttpsError("invalid-argument", "Unknown role.");
  return ((s.data() as Role).permissions ?? []).filter(isValidPermission);
}

async function syncUserOrgs(uid: string, orgId: string, name: string, roleId: string | null) {
  const ref = db.collection("users").doc(uid);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const orgs = ((s.data()?.orgs as { id: string; name: string; roleId: string }[]) ?? []).filter((o) => o.id !== orgId);
    if (roleId) orgs.push({ id: orgId, name, roleId });
    tx.set(ref, { orgs, updatedAt: nowIso() }, { merge: true });
  });
}

export const createOrganization = onCall(async (req) => {
  try {
    const u = requireAuth(req);
    await rateLimit(`createOrg_${u.uid}`, 5, 3600);
    const d = req.data ?? {};
    const name = str(d.name, "Organization name", { min: 2, max: 80 });
    const currency = str(d.reportingCurrency, "Currency", { pattern: CURRENCY });
    if (!SUPPORTED_CURRENCIES.some((c) => c.code === currency)) throw new HttpsError("invalid-argument", "Unsupported currency.");
    const timezone = str(d.timezone, "Timezone", { max: 64 });
    if (!validTimezone(timezone)) throw new HttpsError("invalid-argument", "Invalid timezone.");
    const notifications = Object.fromEntries(CATEGORIES.map((c) => [c, d.notifications?.[c] !== false])) as OrgSettings["notifications"]["categories"];
    const ref = orgRef(db.collection("organizations").doc().id);
    const now = nowIso();
    const org: Omit<Organization, "id"> = {
      name,
      businessType: str(d.businessType ?? "Other", "Business type", { max: 80 }),
      industry: str(d.industry ?? "", "Industry", { max: 80 }),
      country: str(d.country ?? "", "Country", { max: 2 }).toUpperCase(),
      website: str(d.website ?? "", "Website", { max: 200 }),
      reportingCurrency: currency,
      timezone,
      ownerId: u.uid,
      settings: {
        syncInterval: "1h",
        ai: { enabled: d.ai?.enabled !== false, model: typeof d.ai?.model === "string" ? d.ai.model.slice(0, 100) : "nvidia/nemotron-3.5-super-vl:free", monthlyTokenBudget: 2_000_000 },
        notifications: { categories: notifications, emailDigest: "off" },
        invoicePrefix: "INV-",
        defaultPaymentTermsDays: 30,
        largeTransactionThreshold: 500000,
      },
      createdAt: now,
      updatedAt: now,
    };
    const owner = SYSTEM_ROLES.find((r) => r.id === "owner")!;
    const member: Member = { uid: u.uid, email: u.email, displayName: u.name, roleId: "owner", permissions: owner.permissions, status: "active", joinedAt: now };
    const batch = db.batch();
    batch.set(ref, org);
    batch.set(ref.collection("members").doc(u.uid), member);
    for (const r of SYSTEM_ROLES) batch.set(ref.collection("roles").doc(r.id), r);
    await batch.commit();
    await syncUserOrgs(u.uid, ref.id, name, "owner");
    await audit(ref.id, u.email, "Created organization", name);
    return { orgId: ref.id };
  } catch (e) {
    throw safeError(e, "Couldn't create the organization.");
  }
});

export const updateOrganization = onCall(async (req) => {
  try {
    const c = await requireMember(req, "settings.manage");
    const p = req.data?.patch ?? {};
    const cur = (await orgRef(c.orgId).get()).data() as Organization;
    const patch: Partial<Organization> = {};
    if (p.name !== undefined) patch.name = str(p.name, "Name", { min: 2, max: 80 });
    for (const k of ["businessType", "industry", "email", "website", "address"] as const) if (p[k] !== undefined) (patch as Record<string, string>)[k] = str(p[k], k, { max: 200 });
    if (p.country !== undefined) patch.country = str(p.country, "Country", { max: 2 }).toUpperCase();
    if (p.reportingCurrency !== undefined) {
      const rc = str(p.reportingCurrency, "Currency", { pattern: CURRENCY });
      if (!SUPPORTED_CURRENCIES.some((x) => x.code === rc)) throw new HttpsError("invalid-argument", "Unsupported currency.");
      patch.reportingCurrency = rc;
    }
    if (p.timezone !== undefined) {
      if (!validTimezone(p.timezone)) throw new HttpsError("invalid-argument", "Invalid timezone.");
      patch.timezone = p.timezone;
    }
    if (p.settings) {
      const s = p.settings as Partial<OrgSettings>;
      const next: OrgSettings = { ...cur.settings };
      if (s.syncInterval && SYNC.includes(s.syncInterval)) next.syncInterval = s.syncInterval;
      if (s.ai) next.ai = { enabled: !!s.ai.enabled, model: String(s.ai.model ?? next.ai.model).slice(0, 100), monthlyTokenBudget: Math.min(Math.max(Number(s.ai.monthlyTokenBudget) || next.ai.monthlyTokenBudget, 10_000), 100_000_000) };
      if (s.notifications) next.notifications = { categories: Object.fromEntries(CATEGORIES.map((k) => [k, s.notifications!.categories?.[k] !== false])) as OrgSettings["notifications"]["categories"], emailDigest: ["off", "daily", "weekly"].includes(s.notifications.emailDigest) ? s.notifications.emailDigest : "off" };
      if (typeof s.invoicePrefix === "string") next.invoicePrefix = s.invoicePrefix.replace(/[^A-Za-z0-9-_]/g, "").slice(0, 10);
      if (s.defaultPaymentTermsDays !== undefined) next.defaultPaymentTermsDays = Math.min(Math.max(Math.round(Number(s.defaultPaymentTermsDays) || 0), 0), 365);
      if (s.largeTransactionThreshold !== undefined) next.largeTransactionThreshold = Math.max(Math.round(Number(s.largeTransactionThreshold) || 0), 0);
      patch.settings = next;
    }
    await orgRef(c.orgId).update({ ...patch, updatedAt: nowIso() });
    if (patch.name) {
      const members = await orgCol(c.orgId, "members").get();
      await Promise.all(members.docs.map((m) => syncUserOrgs(m.id, c.orgId, patch.name!, (m.data() as Member).roleId)));
    }
    await audit(c.orgId, c.email, "Updated organization settings", Object.keys(patch).join(", "));
    return { ok: true };
  } catch (e) {
    throw safeError(e);
  }
});

export const inviteMember = onCall(async (req) => {
  try {
    const c = await requireMember(req, "users.manage");
    await rateLimit(`invite_${c.uid}`, 30, 3600);
    const email = str(req.data?.email, "Email", { pattern: EMAIL, max: 254 }).toLowerCase();
    const roleId = str(req.data?.roleId, "Role", { max: 64 });
    if (roleId === "owner") throw new HttpsError("invalid-argument", "Ownership can't be granted by invitation.");
    await rolePermissions(c.orgId, roleId);
    await db.collection("invites").doc(`${c.orgId}_${email}`).set({ orgId: c.orgId, email, roleId, invitedBy: c.uid, createdAt: nowIso() });
    await audit(c.orgId, c.email, "Invited member", email, roleId);
    return { ok: true, message: `Invitation created for ${email}. They'll join when they sign in with that email.` };
  } catch (e) {
    throw safeError(e);
  }
});

/** Called by the client after sign-in: joins any organizations the verified email was invited to. */
export const claimInvites = onCall(async (req) => {
  try {
    const u = requireAuth(req);
    if (!req.auth?.token.email_verified) return { joined: 0 };
    const snap = await db.collection("invites").where("email", "==", u.email.toLowerCase()).limit(20).get();
    let joined = 0;
    for (const inv of snap.docs) {
      const { orgId, roleId } = inv.data() as { orgId: string; roleId: string };
      const org = await orgRef(orgId).get();
      if (!org.exists) {
        await inv.ref.delete();
        continue;
      }
      const m: Member = { uid: u.uid, email: u.email, displayName: u.name, roleId, permissions: await rolePermissions(orgId, roleId), status: "active", joinedAt: nowIso() };
      await orgCol(orgId, "members").doc(u.uid).set(m);
      await syncUserOrgs(u.uid, orgId, (org.data() as Organization).name, roleId);
      await inv.ref.delete();
      await audit(orgId, u.email, "Joined organization", u.email, roleId);
      joined++;
    }
    return { joined };
  } catch (e) {
    throw safeError(e);
  }
});

export const updateMemberRole = onCall(async (req) => {
  try {
    const c = await requireMember(req, "users.manage");
    const uid = str(req.data?.uid, "Member", { max: 128 });
    const roleId = str(req.data?.roleId, "Role", { max: 64 });
    if (uid === c.uid) throw new HttpsError("failed-precondition", "You can't change your own role.");
    if (roleId === "owner") throw new HttpsError("invalid-argument", "Ownership transfer isn't supported here.");
    const ref = orgCol(c.orgId, "members").doc(uid);
    const target = await ref.get();
    if (!target.exists) throw new HttpsError("not-found", "Member not found.");
    if ((target.data() as Member).roleId === "owner") throw new HttpsError("permission-denied", "The owner's role can't be changed.");
    await ref.update({ roleId, permissions: await rolePermissions(c.orgId, roleId) });
    const org = (await orgRef(c.orgId).get()).data() as Organization;
    await syncUserOrgs(uid, c.orgId, org.name, roleId);
    await audit(c.orgId, c.email, "Changed member role", (target.data() as Member).email, roleId);
    return { ok: true };
  } catch (e) {
    throw safeError(e);
  }
});

export const removeMember = onCall(async (req) => {
  try {
    const c = await requireMember(req, "users.manage");
    const uid = str(req.data?.uid, "Member", { max: 128 });
    const ref = orgCol(c.orgId, "members").doc(uid);
    const target = await ref.get();
    if (!target.exists) {
      // Might be a pending invite id
      return { ok: true };
    }
    if ((target.data() as Member).roleId === "owner" || uid === c.uid) throw new HttpsError("permission-denied", "This member can't be removed.");
    await ref.delete();
    await syncUserOrgs(uid, c.orgId, "", null);
    await audit(c.orgId, c.email, "Removed member", (target.data() as Member).email);
    return { ok: true };
  } catch (e) {
    throw safeError(e);
  }
});

export const saveRole = onCall(async (req) => {
  try {
    const c = await requireMember(req, "users.manage");
    const r = req.data?.role ?? {};
    const id = str(r.id, "Role id", { pattern: /^custom_[a-z0-9]{1,24}$/ });
    const role: Role = {
      id,
      name: str(r.name, "Role name", { min: 1, max: 40 }),
      description: str(r.description ?? "", "Description", { max: 120 }),
      permissions: (Array.isArray(r.permissions) ? r.permissions : []).filter(isValidPermission),
      system: false,
    };
    await orgCol(c.orgId, "roles").doc(id).set(role);
    // Re-denormalize permissions for members holding this role.
    const holders = await orgCol(c.orgId, "members").where("roleId", "==", id).get();
    await Promise.all(holders.docs.map((d) => d.ref.update({ permissions: role.permissions })));
    await audit(c.orgId, c.email, "Saved custom role", role.name, role.permissions.join(","));
    return { ok: true };
  } catch (e) {
    throw safeError(e);
  }
});

export { FieldValue };
