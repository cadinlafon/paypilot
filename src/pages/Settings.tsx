import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, onSnapshot } from "firebase/firestore";
import { Building2, Users, ShieldCheck, Bot, Bell, User, ScrollText, FlaskConical, Plus, Trash2, Lock, RotateCcw } from "lucide-react";
import { useWorkspace, useCollection } from "@/context/WorkspaceContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Switch, Checkbox } from "@/components/ui/Form";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Dialog, ConfirmDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { db, callFn } from "@/lib/firebase";
import { ALL_PERMISSIONS, SYSTEM_ROLES } from "@shared/permissions";
import { SUPPORTED_CURRENCIES, formatMoney, parseMoneyInput, toMajor } from "@shared/money";
import { formatDate } from "@shared/dates";
import type { Member, Permission, Role } from "@shared/types";
import { AI_MODELS, BUSINESS_TYPES, NOTIFICATION_CATEGORIES, TIMEZONES } from "@/lib/defaults";
import { cn, errorMessage, initials, isEmail, relativeTime } from "@/lib/utils";

type Tab = "organization" | "team" | "roles" | "ai" | "notifications" | "profile" | "audit" | "demo";
const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "roles", label: "Roles & permissions", icon: ShieldCheck },
  { id: "ai", label: "AI assistant", icon: Bot },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "profile", label: "Profile", icon: User },
  { id: "audit", label: "Audit log", icon: ScrollText },
  { id: "demo", label: "Demo data", icon: FlaskConical },
];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "organization";
  const { mode } = useWorkspace();
  return (
    <div>
      <PageHeader title="Settings" description="Organization configuration, team access and preferences." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible -mx-1 px-1" aria-label="Settings sections">
          {TABS.filter((t) => t.id !== "demo" || mode === "demo").map((t) => (
            <button key={t.id} onClick={() => setParams({ tab: t.id })} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap", tab === t.id ? "bg-surface-3 text-fg" : "text-muted hover:text-fg hover:bg-surface-2")}>
              <t.icon className="size-4" />{t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {tab === "organization" && <OrgSettings />}
          {tab === "team" && <TeamSettings />}
          {tab === "roles" && <RolesSettings />}
          {tab === "ai" && <AiSettings />}
          {tab === "notifications" && <NotificationSettings />}
          {tab === "profile" && <ProfileSettings />}
          {tab === "audit" && <AuditLog />}
          {tab === "demo" && <DemoSettings />}
        </div>
      </div>
    </div>
  );
}

function Locked() {
  return <p className="mb-4 flex items-center gap-2 text-xs text-muted"><Lock className="size-3.5" />Read-only — your role can't change organization settings.</p>;
}

function OrgSettings() {
  const { org, repo, can, mode } = useWorkspace();
  const toast = useToast();
  const [f, setF] = useState(() => ({ name: "", businessType: "", industry: "", country: "", email: "", website: "", address: "", reportingCurrency: "USD", timezone: "UTC", invoicePrefix: "", defaultPaymentTermsDays: "30", largeTx: "" }));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (org) setF({ name: org.name, businessType: org.businessType, industry: org.industry, country: org.country, email: org.email ?? "", website: org.website ?? "", address: org.address ?? "", reportingCurrency: org.reportingCurrency, timezone: org.timezone, invoicePrefix: org.settings.invoicePrefix, defaultPaymentTermsDays: String(org.settings.defaultPaymentTermsDays), largeTx: toMajor(org.settings.largeTransactionThreshold, org.reportingCurrency).toFixed(2) });
  }, [org]);
  if (!org) return null;
  const ro = !can("settings.manage");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const threshold = parseMoneyInput(f.largeTx, f.reportingCurrency);
  const save = async () => {
    if (!f.name.trim() || !(threshold >= 0)) return toast.error("Check the form", "Name and threshold are required.");
    setBusy(true);
    try {
      await repo!.updateOrg({ name: f.name.trim(), businessType: f.businessType, industry: f.industry, country: f.country.toUpperCase().slice(0, 2), email: f.email, website: f.website, address: f.address, reportingCurrency: f.reportingCurrency, timezone: f.timezone, settings: { ...org.settings, invoicePrefix: f.invoicePrefix.slice(0, 10), defaultPaymentTermsDays: Math.max(0, Number(f.defaultPaymentTermsDays) || 0), largeTransactionThreshold: threshold } });
      toast.success("Settings saved", f.reportingCurrency !== org.reportingCurrency ? (mode === "demo" ? "Demo sample conversions were generated for the original currency; reset demo data to regenerate." : "Historical conversions will be recalculated in the background.") : undefined);
    } catch (e) {
      toast.error("Couldn't save", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Organization" subtitle={mode === "demo" ? "Demo organization — changes stay in this browser" : `ID ${org.id}`} />
      <CardBody>
        {ro && <Locked />}
        <fieldset disabled={ro} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Organization name" required>{(id) => <Input id={id} value={f.name} onChange={set("name")} maxLength={80} />}</Field>
          <Field label="Business type">{(id) => <Select id={id} value={f.businessType} onChange={set("businessType")}>{[...new Set([f.businessType, ...BUSINESS_TYPES])].map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
          <Field label="Industry">{(id) => <Input id={id} value={f.industry} onChange={set("industry")} />}</Field>
          <Field label="Country">{(id) => <Input id={id} value={f.country} onChange={set("country")} maxLength={2} />}</Field>
          <Field label="Business email">{(id) => <Input id={id} type="email" value={f.email} onChange={set("email")} />}</Field>
          <Field label="Website">{(id) => <Input id={id} value={f.website} onChange={set("website")} />}</Field>
          <Field label="Address" className="sm:col-span-2">{(id) => <Input id={id} value={f.address} onChange={set("address")} />}</Field>
          <Field label="Reporting currency" hint="All totals convert to this currency. Original amounts never change.">{(id) => <Select id={id} value={f.reportingCurrency} onChange={set("reportingCurrency")}>{SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}</Select>}</Field>
          <Field label="Business timezone" hint="Used for daily totals and scheduled automations.">{(id) => <Select id={id} value={f.timezone} onChange={set("timezone")}>{[...new Set([f.timezone, ...TIMEZONES])].map((t) => <option key={t}>{t}</option>)}</Select>}</Field>
          <Field label="Invoice number prefix">{(id) => <Input id={id} value={f.invoicePrefix} onChange={set("invoicePrefix")} maxLength={10} />}</Field>
          <Field label="Default payment terms (days)">{(id) => <Input id={id} type="number" min={0} value={f.defaultPaymentTermsDays} onChange={set("defaultPaymentTermsDays")} />}</Field>
          <Field label={`Large transaction threshold (${f.reportingCurrency})`} hint={`Triggers “Large transaction detected” — currently ${formatMoney(org.settings.largeTransactionThreshold, org.reportingCurrency)}`}>{(id) => <Input id={id} inputMode="decimal" value={f.largeTx} onChange={set("largeTx")} />}</Field>
        </fieldset>
        {!ro && <div className="mt-6 flex justify-end"><Button variant="primary" loading={busy} onClick={save}>Save changes</Button></div>}
      </CardBody>
    </Card>
  );
}

const DEMO_TEAM: Member[] = [
  { uid: "demo-guest", email: "alex.rivera@demo.paypilot.local", displayName: "Alex Rivera", roleId: "owner", permissions: [], status: "active", joinedAt: "2025-01-04T10:00:00Z" },
  { uid: "d2", email: "sam.okafor@demo.paypilot.local", displayName: "Sam Okafor", roleId: "finance_manager", permissions: [], status: "active", joinedAt: "2025-02-11T10:00:00Z" },
  { uid: "d3", email: "jun.park@demo.paypilot.local", displayName: "Jun Park", roleId: "accountant", permissions: [], status: "active", joinedAt: "2025-04-02T10:00:00Z" },
  { uid: "d4", email: "maya.lopez@demo.paypilot.local", displayName: "Maya Lopez", roleId: "employee", permissions: [], status: "active", joinedAt: "2025-06-20T10:00:00Z" },
  { uid: "d5", email: "investor@demo.paypilot.local", displayName: "Board Observer", roleId: "viewer", permissions: [], status: "invited", joinedAt: "2025-09-01T10:00:00Z" },
];

function useTeam() {
  const { mode, orgId } = useWorkspace();
  const [members, setMembers] = useState<Member[]>(mode === "demo" ? DEMO_TEAM : []);
  const [roles, setRoles] = useState<Role[]>(SYSTEM_ROLES);
  useEffect(() => {
    if (mode === "demo" || !db || !orgId) {
      setMembers(DEMO_TEAM);
      setRoles(SYSTEM_ROLES);
      return;
    }
    const a = onSnapshot(collection(db, "organizations", orgId, "members"), (s) => setMembers(s.docs.map((d) => ({ ...(d.data() as Member), uid: d.id }))));
    const b = onSnapshot(collection(db, "organizations", orgId, "roles"), (s) => setRoles([...SYSTEM_ROLES, ...s.docs.map((d) => ({ ...(d.data() as Role), id: d.id })).filter((r) => !r.system)]));
    return () => { a(); b(); };
  }, [mode, orgId]);
  return { members, setMembers, roles, setRoles };
}

function TeamSettings() {
  const { can, mode, orgId } = useWorkspace();
  const { user } = useAuth();
  const toast = useToast();
  const { members, setMembers, roles } = useTeam();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("employee");
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const manage = can("users.manage");
  const call = async (fn: string, data: object, demoApply: () => void, msg: string) => {
    if (mode === "demo") {
      demoApply();
      toast.demo(msg, "Demo team — no invitation emails are sent.");
      return;
    }
    await callFn(fn, { orgId, ...data });
    toast.success(msg);
  };
  return (
    <Card>
      <CardHeader title="Team members" subtitle="Roles are enforced by Firestore rules and Cloud Functions, not just the UI." action={manage && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setInviteOpen(true)}>Invite</Button>} />
      <ul className="divide-y divide-line">
        {members.map((m) => (
          <li key={m.uid} className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="grid grid-cols-1 place-items-center size-8 rounded-full bg-surface-3 text-[11px] font-semibold shrink-0">{initials(m.displayName || m.email)}</span>
              <div className="min-w-0"><div className="text-sm truncate">{m.displayName || m.email}{m.uid === user?.uid && <span className="text-faint"> (you)</span>}</div><div className="text-xs text-muted truncate">{m.email} · joined {formatDate(m.joinedAt, "UTC")}</div></div>
            </div>
            <div className="flex items-center gap-2">
              {m.status !== "active" && <StatusBadge status={m.status === "invited" ? "pending" : "disabled"} label={m.status} />}
              <Select aria-label={`Role for ${m.email}`} className="h-8 text-xs w-44" disabled={!manage || m.roleId === "owner" || m.uid === user?.uid} value={m.roleId} onChange={(e) => call("updateMemberRole", { uid: m.uid, roleId: e.target.value }, () => setMembers(members.map((x) => (x.uid === m.uid ? { ...x, roleId: e.target.value } : x))), "Role updated").catch((er) => toast.error("Couldn't change role", errorMessage(er)))}>
                {roles.filter((r) => r.id !== "owner" || m.roleId === "owner").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
              {manage && m.roleId !== "owner" && m.uid !== user?.uid && <button className="p-1.5 text-faint hover:text-rose-300" onClick={() => setRemoving(m)} aria-label={`Remove ${m.email}`}><Trash2 className="size-4" /></button>}
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} size="sm" title="Invite a team member" description={mode === "demo" ? "Demo: adds a sample member. No email is sent." : "They'll join this organization when they sign in with this email."} footer={<><Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!isEmail(email)} onClick={async () => { setBusy(true); try { await call("inviteMember", { email: email.trim().toLowerCase(), roleId }, () => setMembers([...members, { uid: `inv-${Date.now()}`, email, displayName: "", roleId, permissions: [], status: "invited", joinedAt: new Date().toISOString() }]), "Invitation created"); setInviteOpen(false); setEmail(""); } catch (e) { toast.error("Couldn't invite", errorMessage(e)); } finally { setBusy(false); } }}>Send invite</Button></>}>
        <div className="space-y-4">
          <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Role">{(id) => <Select id={id} value={roleId} onChange={(e) => setRoleId(e.target.value)}>{roles.filter((r) => r.id !== "owner").map((r) => <option key={r.id} value={r.id}>{r.name} — {r.description}</option>)}</Select>}</Field>
        </div>
      </Dialog>
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} danger title={`Remove ${removing?.email}?`} description="They immediately lose access to this organization." confirmLabel="Remove" onConfirm={() => call("removeMember", { uid: removing!.uid }, () => setMembers(members.filter((x) => x.uid !== removing!.uid)), "Member removed").catch((e) => toast.error("Couldn't remove", errorMessage(e))).finally(() => setRemoving(null))} />
    </Card>
  );
}

function RolesSettings() {
  const { can, mode, orgId } = useWorkspace();
  const toast = useToast();
  const { roles, setRoles } = useTeam();
  const [editing, setEditing] = useState<Role | null>(null);
  const groups = useMemo(() => [...new Set(ALL_PERMISSIONS.map((p) => p.group))], []);
  const manage = can("users.manage");
  const save = async (r: Role) => {
    try {
      if (mode === "demo") {
        setRoles(roles.some((x) => x.id === r.id) ? roles.map((x) => (x.id === r.id ? r : x)) : [...roles, r]);
        toast.demo("Custom role saved", "Demo only");
      } else {
        await callFn("saveRole", { orgId, role: r });
        toast.success("Custom role saved");
      }
      setEditing(null);
    } catch (e) {
      toast.error("Couldn't save role", errorMessage(e));
    }
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Roles" subtitle="System roles can't be edited. Create custom roles for granular access." action={manage && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ id: `custom_${Date.now().toString(36)}`, name: "", description: "", permissions: [], system: false })}>Custom role</Button>} />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-y border-line text-muted"><th className="text-left font-medium px-5 py-2 sticky left-0 bg-surface">Permission</th>{roles.map((r) => <th key={r.id} className="px-2 font-medium whitespace-nowrap">{r.system ? r.name : <button className="text-accent-strong hover:underline" onClick={() => manage && setEditing(r)}>{r.name}</button>}</th>)}</tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <tr><td colSpan={roles.length + 1} className="px-5 pt-3 pb-1 text-[10px] uppercase tracking-wider text-faint">{g}</td></tr>
                  {ALL_PERMISSIONS.filter((p) => p.group === g).map((p) => (
                    <tr key={p.id} className="border-b border-line/40">
                      <td className="px-5 py-1.5 sticky left-0 bg-surface whitespace-nowrap">{p.label}{p.sensitive && <Badge tone="amber" className="ml-1.5">sensitive</Badge>}</td>
                      {roles.map((r) => <td key={r.id} className="text-center">{r.permissions.includes(p.id) ? <span className="text-accent">●</span> : <span className="text-line-strong">·</span>}</td>)}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {editing && <RoleEditor role={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function RoleEditor({ role, onClose, onSave }: { role: Role; onClose: () => void; onSave: (r: Role) => void }) {
  const [r, setR] = useState(role);
  const toggle = (p: Permission, on: boolean) => setR({ ...r, permissions: on ? [...r.permissions, p] : r.permissions.filter((x) => x !== p) });
  return (
    <Dialog open onClose={onClose} size="lg" title={role.name ? `Edit ${role.name}` : "New custom role"} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!r.name.trim()} onClick={() => onSave({ ...r, name: r.name.trim() })}>Save role</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-5">
        <Field label="Role name" required>{(id) => <Input id={id} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} maxLength={40} />}</Field>
        <Field label="Description">{(id) => <Input id={id} value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} maxLength={120} />}</Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ALL_PERMISSIONS.map((p) => <Checkbox key={p.id} checked={r.permissions.includes(p.id)} onChange={(v) => toggle(p.id, v)} label={p.label} description={`${p.group}${p.sensitive ? " · sensitive" : ""}`} />)}
      </div>
    </Dialog>
  );
}

function AiSettings() {
  const { org, repo, can, mode } = useWorkspace();
  const toast = useToast();
  const convs = useCollection("aiConversations").rows;
  if (!org) return null;
  const ro = !can("settings.manage");
  const upd = (patch: Partial<typeof org.settings.ai>) => repo!.updateOrg({ settings: { ...org.settings, ai: { ...org.settings.ai, ...patch } } }).then(() => toast.success("AI settings saved")).catch((e) => toast.error("Couldn't save", errorMessage(e)));
  const tokens = convs.flatMap((c) => c.messages).reduce((a, m) => a + (m.usage ? m.usage.promptTokens + m.usage.completionTokens : 0), 0);
  return (
    <Card>
      <CardHeader title="AI assistant" subtitle={mode === "demo" ? "Demo uses a simulated assistant over sample data — no OpenRouter calls." : "Requests are made server-side through OpenRouter. Keys never reach the browser."} />
      <CardBody className="space-y-5">
        {ro && <Locked />}
        <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3"><div><div className="text-sm">Enable assistant</div><div className="text-xs text-muted">Turns the AI Assistant page and AI automations on or off for everyone.</div></div><Switch checked={org.settings.ai.enabled} disabled={ro} onChange={(v) => upd({ enabled: v })} label="Enable AI" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Model">{(id) => <Select id={id} disabled={ro} value={org.settings.ai.model} onChange={(e) => upd({ model: e.target.value })}>{AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.note}</option>)}</Select>}</Field>
          <Field label="Monthly token budget" hint="Requests are refused once the budget is reached.">{(id) => <Input id={id} type="number" disabled={ro} defaultValue={org.settings.ai.monthlyTokenBudget} onBlur={(e) => Number(e.target.value) > 0 && upd({ monthlyTokenBudget: Math.round(Number(e.target.value)) })} />}</Field>
        </div>
        <div className="rounded-xl border border-line bg-surface-2/40 p-4 text-sm">
          <div className="flex justify-between"><span className="text-muted">Conversations</span><span className="tabular">{convs.length}</span></div>
          <div className="flex justify-between mt-1"><span className="text-muted">Tokens used (stored conversations)</span><span className="tabular">{tokens.toLocaleString()}</span></div>
        </div>
        <div className="text-xs text-muted space-y-1">
          <p><strong className="text-fg">Safety:</strong> the assistant can read data and create internal drafts. Emails, payment links, refunds and captures always become approval requests.</p>
          <p>All tool calls and approvals are stored for auditing.</p>
        </div>
      </CardBody>
    </Card>
  );
}

function NotificationSettings() {
  const { org, repo, can } = useWorkspace();
  const toast = useToast();
  if (!org) return null;
  const prefs = org.settings.notifications;
  const ro = !can("settings.manage");
  return (
    <Card>
      <CardHeader title="Notification preferences" subtitle="Choose which events create notifications for this organization." />
      <CardBody>
        {ro && <Locked />}
        <ul className="divide-y divide-line rounded-xl border border-line">
          {NOTIFICATION_CATEGORIES.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div><div className="text-sm">{c.label}</div><div className="text-xs text-muted">{c.description}</div></div>
              <Switch checked={prefs.categories[c.id]} disabled={ro} label={c.label} onChange={(v) => repo!.updateOrg({ settings: { ...org.settings, notifications: { ...prefs, categories: { ...prefs.categories, [c.id]: v } } } }).catch((e) => toast.error("Couldn't save", errorMessage(e)))} />
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function ProfileSettings() {
  const { user, logout } = useAuth();
  const { member, mode } = useWorkspace();
  return (
    <Card>
      <CardHeader title="Your profile" />
      <CardBody className="space-y-3 text-sm">
        <div className="flex items-center gap-3"><span className="grid grid-cols-1 place-items-center size-12 rounded-full bg-surface-3 font-semibold">{initials(user?.displayName ?? "")}</span><div><div className="font-medium">{user?.displayName}</div><div className="text-muted">{user?.email}</div></div></div>
        <div className="flex justify-between"><span className="text-muted">Account</span><span>{user?.isGuest ? "Guest (Demo only)" : "Firebase Authentication"}</span></div>
        <div className="flex justify-between"><span className="text-muted">Email verified</span><span>{user?.emailVerified ? "Yes" : "No"}</span></div>
        <div className="flex justify-between"><span className="text-muted">Role in this {mode === "demo" ? "demo " : ""}organization</span><span>{member?.roleId.replace("_", " ")}</span></div>
        <div className="pt-3"><Button variant="ghost" onClick={() => logout()}>Sign out</Button></div>
      </CardBody>
    </Card>
  );
}

function AuditLog() {
  const { org } = useWorkspace();
  const logs = useCollection("activityLogs").rows;
  const approvals = useCollection("approvals").rows.filter((a) => a.status !== "pending");
  const entries = [...logs.map((l) => ({ at: l.createdAt, who: l.actor, what: l.action, detail: [l.target, l.detail].filter(Boolean).join(" · ") })), ...approvals.map((a) => ({ at: a.decidedAt ?? a.createdAt, who: a.decidedBy ?? "—", what: `${a.status === "rejected" ? "Rejected" : "Approved"}: ${a.title}`, detail: a.result ?? "" }))].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Card>
      <CardHeader title="Audit log" subtitle="Who did what, including every approval decision. Server-written in Real Mode." />
      {entries.length ? (
        <ul className="divide-y divide-line">
          {entries.slice(0, 200).map((e, i) => (
            <li key={i} className="flex gap-3 px-5 py-2.5 text-sm">
              <span className="text-xs text-faint w-28 shrink-0" title={formatDate(e.at, org?.timezone ?? "UTC", true)}>{relativeTime(e.at)}</span>
              <span className="min-w-0"><span className="text-fg">{e.who}</span> <span className="text-muted">{e.what}</span>{e.detail && <span className="block text-xs text-faint truncate">{e.detail}</span>}</span>
            </li>
          ))}
        </ul>
      ) : <CardBody><p className="text-sm text-muted">No activity yet.</p></CardBody>}
    </Card>
  );
}

function DemoSettings() {
  const { repo, org } = useWorkspace();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader title="Demo data" subtitle="Sample data lives only in this browser and is never sent to PayPilot's servers." />
      <CardBody className="space-y-4 text-sm text-muted">
        <p>Reset {org?.name} to a fresh set of sample customers, transactions, invoices and automations. Anything you created in the demo will be removed.</p>
        <Button icon={<RotateCcw className="size-4" />} onClick={() => setOpen(true)}>Reset demo data</Button>
      </CardBody>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} danger title="Reset demo data?" description="This regenerates the sample organization. Real Mode data is not affected." confirmLabel="Reset" onConfirm={async () => { await repo?.resetDemo?.(); setOpen(false); toast.demo("Demo data reset"); }} />
    </Card>
  );
}
