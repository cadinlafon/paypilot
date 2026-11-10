import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, CreditCard, AlertOctagon, UserPlus, FileText, Clock, Repeat, Workflow, Sparkles, PlugZap, Settings2 } from "lucide-react";
import { useCollection, useWorkspace } from "@/context/WorkspaceContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Switch, Select } from "@/components/ui/Form";
import { Segmented } from "@/components/ui/Tabs";
import { EmptyState, SkeletonRows } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { NOTIFICATION_CATEGORIES } from "@/lib/defaults";
import type { NotificationCategory } from "@shared/types";
import { cn, errorMessage, relativeTime } from "@/lib/utils";

const ICONS: Record<NotificationCategory, typeof Bell> = { payment: CreditCard, payment_failed: AlertOctagon, customer: UserPlus, invoice: FileText, invoice_overdue: Clock, subscription: Repeat, automation_error: Workflow, ai_insight: Sparkles, integration: PlugZap };
const SEV = { info: "text-sky-300 bg-sky-500/10", success: "text-accent bg-accent-soft", warning: "text-amber-300 bg-amber-500/10", error: "text-rose-300 bg-rose-500/10" };

export default function Notifications() {
  const { repo, org, can } = useWorkspace();
  const { rows, loading } = useCollection("notifications");
  const toast = useToast();
  const nav = useNavigate();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [cat, setCat] = useState<"all" | NotificationCategory>("all");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const list = useMemo(() => rows.filter((n) => (filter === "all" || !n.read) && (cat === "all" || n.category === cat)), [rows, filter, cat]);
  const unread = rows.filter((n) => !n.read);

  const markAll = async () => {
    try {
      await Promise.all(unread.map((n) => repo!.update("notifications", n.id, { read: true })));
      toast.success("All caught up", `${unread.length} marked as read`);
    } catch (e) {
      toast.error("Couldn't update", errorMessage(e));
    }
  };
  const prefs = org?.settings.notifications;

  return (
    <div>
      <PageHeader title="Notifications" description={`${unread.length} unread`} actions={<><Button icon={<Settings2 className="size-4" />} onClick={() => setPrefsOpen((p) => !p)}>Preferences</Button><Button icon={<CheckCheck className="size-4" />} disabled={!unread.length} onClick={markAll}>Mark all as read</Button></>} />
      {prefsOpen && prefs && (
        <Card className="mb-4">
          <CardHeader title="Notification preferences" subtitle={can("settings.manage") ? "Applies to everyone in this organization" : "Only administrators can change these"} />
          <CardBody>
            <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
              {NOTIFICATION_CATEGORIES.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-4">
                  <div><div className="text-sm">{c.label}</div><div className="text-xs text-muted">{c.description}</div></div>
                  <Switch checked={prefs.categories[c.id]} disabled={!can("settings.manage")} label={c.label} onChange={(v) => repo!.updateOrg({ settings: { ...org!.settings, notifications: { ...prefs, categories: { ...prefs.categories, [c.id]: v } } } }).catch((e) => toast.error("Couldn't save", errorMessage(e)))} />
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-3 text-sm">
              <span className="text-muted">Email digest</span>
              <Select aria-label="Email digest" className="w-40" value={prefs.emailDigest} disabled={!can("settings.manage")} onChange={(e) => repo!.updateOrg({ settings: { ...org!.settings, notifications: { ...prefs, emailDigest: e.target.value as "off" } } })}><option value="off">Off</option><option value="daily">Daily</option><option value="weekly">Weekly</option></Select>
            </div>
          </CardBody>
        </Card>
      )}
      <Card>
        <div className="flex flex-col md:flex-row md:items-center gap-3 p-4 border-b border-line">
          <Segmented value={filter} onChange={setFilter} items={[{ id: "all", label: "All" }, { id: "unread", label: `Unread (${unread.length})` }]} />
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setCat("all")} className={cn("rounded-full border px-2.5 py-1 text-xs", cat === "all" ? "border-accent/50 bg-accent-soft text-accent-strong" : "border-line text-muted hover:text-fg")}>All</button>
            {NOTIFICATION_CATEGORIES.map((c) => <button key={c.id} onClick={() => setCat(c.id)} className={cn("rounded-full border px-2.5 py-1 text-xs", cat === c.id ? "border-accent/50 bg-accent-soft text-accent-strong" : "border-line text-muted hover:text-fg")}>{c.label}</button>)}
          </div>
        </div>
        {loading ? <SkeletonRows rows={5} cols={2} /> : list.length ? (
          <ul className="divide-y divide-line">
            {list.map((n) => {
              const I = ICONS[n.category] ?? Bell;
              return (
                <li key={n.id} className={cn("flex gap-3 px-5 py-3.5 transition-colors", !n.read && "bg-accent-soft/[0.15]")}>
                  <span className={cn("grid place-items-center size-8 rounded-lg shrink-0", SEV[n.severity])}><I className="size-4" /></span>
                  <button className="min-w-0 flex-1 text-left" onClick={() => { if (!n.read) repo!.update("notifications", n.id, { read: true }); if (n.link) nav(n.link); }}>
                    <div className="flex items-center gap-2"><span className={cn("text-sm", !n.read && "font-medium")}>{n.title}</span>{!n.read && <span className="size-1.5 rounded-full bg-accent" />}</div>
                    <p className="text-xs text-muted mt-0.5">{n.body}</p>
                    <p className="text-[11px] text-faint mt-1">{relativeTime(n.createdAt)}</p>
                  </button>
                  <button className="self-start text-xs text-faint hover:text-fg" onClick={() => repo!.update("notifications", n.id, { read: !n.read })}>{n.read ? "Mark unread" : "Mark read"}</button>
                </li>
              );
            })}
          </ul>
        ) : <EmptyState icon={<Bell className="size-5" />} title={filter === "unread" ? "No unread notifications" : "No notifications"} />}
      </Card>
    </div>
  );
}
