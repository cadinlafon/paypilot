import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Mail, Phone, Building2, MapPin, FilePlus2, Link2, Archive, Bot, Activity, FileText, StickyNote, UserPlus } from "lucide-react";
import { useDataset, useWorkspace } from "@/context/WorkspaceContext";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Stat } from "@/components/ui/PageHeader";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { Tabs } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState, FullPageLoader } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { CustomerForm } from "./customers/CustomerForm";
import { customerLifetime } from "@shared/analytics";
import { formatMoney } from "@shared/money";
import { formatDate } from "@shared/dates";
import { errorMessage, initials } from "@/lib/utils";

export default function CustomerProfile() {
  const { id } = useParams();
  const { ds, loading } = useDataset();
  const { org, can, repo } = useWorkspace();
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<"timeline" | "transactions" | "invoices">("timeline");
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const c = ds?.customers.find((x) => x.id === id);
  const tz = org?.timezone ?? "UTC";
  const rc = org?.reportingCurrency ?? "USD";
  const txs = useMemo(() => (ds?.transactions ?? []).filter((t) => t.customerId === id && !t.archivedAt), [ds, id]);
  const invs = useMemo(() => (ds?.invoices ?? []).filter((i) => i.customerId === id && !i.archivedAt), [ds, id]);
  const subs = useMemo(() => (ds?.subscriptions ?? []).filter((s) => s.customerId === id), [ds, id]);
  const lt = useMemo(() => (ds && id ? customerLifetime(ds, id) : null), [ds, id]);
  const timeline = useMemo(() => {
    if (!c) return [];
    const ev: { at: string; icon: typeof Activity; text: string; sub?: string; to?: string }[] = [{ at: c.createdAt, icon: UserPlus, text: "Became a customer" }];
    for (const t of txs) ev.push({ at: t.date, icon: Activity, text: `${t.status === "failed" || t.status === "denied" ? "Failed payment" : "Payment"} — ${formatMoney(t.gross, t.currency)}`, sub: t.description, to: `/transactions?open=${t.id}` });
    for (const t of txs) for (const r of t.refunds) ev.push({ at: r.date, icon: Activity, text: `Refund — ${formatMoney(r.amount, t.currency)}`, sub: r.reason });
    for (const i of invs) ev.push({ at: i.history[0]?.at ?? i.createdAt, icon: FileText, text: `Invoice ${i.number} ${i.status === "draft" ? "drafted" : "issued"} — ${formatMoney(i.totals.total, i.currency)}`, sub: i.status, to: `/invoices?open=${i.id}` });
    return ev.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
  }, [c, txs, invs]);

  if (loading) return <FullPageLoader label="Loading customer…" />;
  if (!c) return <EmptyState title="Customer not found" description="It may have been archived or belongs to a different organization." action={<Button onClick={() => nav("/customers")}>Back to customers</Button>} />;
  const outstanding = invs.filter((i) => i.status !== "draft" && i.status !== "cancelled").reduce((a, i) => a + (i.currency === rc ? i.totals.balance : 0), 0);
  const addr = c.billingAddress && [c.billingAddress.line1, c.billingAddress.city, c.billingAddress.state, c.billingAddress.postalCode, c.billingAddress.country].filter(Boolean).join(", ");

  return (
    <div>
      <Link to="/customers" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg mb-4"><ArrowLeft className="size-4" />Customers</Link>
      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
        <span className="grid grid-cols-1 place-items-center size-14 rounded-2xl bg-accent-soft text-accent-strong text-lg font-semibold shrink-0">{initials(c.name)}</span>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold flex items-center gap-2 flex-wrap">{c.name}{c.tags.map((t) => <Badge key={t} tone={t === "vip" ? "green" : "neutral"}>{t}</Badge>)}{c.source === "demo" && <Badge tone="amber">Sample</Badge>}</h1>
          <p className="text-sm text-muted">{c.company ?? "Individual"} · customer since {formatDate(c.createdAt, tz)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("invoices.edit") && <Link to="/invoices?new=1"><Button icon={<FilePlus2 className="size-4" />}>Invoice</Button></Link>}
          {can("paymentLinks.create") && <Link to="/payment-links?new=1"><Button icon={<Link2 className="size-4" />}>Payment link</Button></Link>}
          {can("ai.use") && <Link to={`/assistant?prompt=${encodeURIComponent(`Tell me about ${c.name}`)}`}><Button icon={<Bot className="size-4" />}>Ask AI</Button></Link>}
          {can("customers.edit") && <Button icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>Edit</Button>}
          {can("customers.edit") && <Button variant="ghost" icon={<Archive className="size-4" />} onClick={() => setArchiveOpen(true)} aria-label="Archive customer" />}
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Lifetime paid (gross)" value={formatMoney(lt?.total ?? 0, rc)} sub={`${lt?.count ?? 0} payment(s)`} />
        <Stat label="Refunded" value={formatMoney(-(lt?.refunds ?? 0), rc)} tone={lt?.refunds ? "negative" : undefined} />
        <Stat label="Net lifetime" value={formatMoney(lt?.net ?? 0, rc)} tone="positive" />
        <Stat label="Outstanding" value={formatMoney(outstanding, rc)} tone={outstanding ? "negative" : undefined} sub={`${subs.filter((s) => s.status === "active").length} active subscription(s)`} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <CardHeader title="Profile" />
          <CardBody className="space-y-3 text-sm">
            <div className="flex gap-2.5"><Mail className="size-4 text-faint mt-0.5" /><a href={`mailto:${c.email}`} className="hover:text-accent-strong break-all">{c.email}</a></div>
            {c.phone && <div className="flex gap-2.5"><Phone className="size-4 text-faint mt-0.5" />{c.phone}</div>}
            {c.company && <div className="flex gap-2.5"><Building2 className="size-4 text-faint mt-0.5" />{c.company}</div>}
            {addr && <div className="flex gap-2.5"><MapPin className="size-4 text-faint mt-0.5" /><span className="text-muted">{addr}</span></div>}
            {c.notes && <div className="flex gap-2.5"><StickyNote className="size-4 text-faint mt-0.5" /><span className="text-muted whitespace-pre-wrap">{c.notes}</span></div>}
          </CardBody>
        </Card>
        <Card>
          <div className="px-4 pt-2"><Tabs value={tab} onChange={setTab} items={[{ id: "timeline", label: "Activity" }, { id: "transactions", label: "Transactions", count: txs.length }, { id: "invoices", label: "Invoices", count: invs.length }]} /></div>
          <div className="p-4">
            {tab === "timeline" && (
              <ol className="relative border-l border-line ml-3 space-y-4">
                {timeline.map((e, i) => (
                  <li key={i} className="pl-6">
                    <span className="absolute -left-3 grid grid-cols-1 place-items-center size-6 rounded-full bg-surface-2 border border-line"><e.icon className="size-3 text-muted" /></span>
                    {e.to ? <Link to={e.to} className="text-sm hover:text-accent-strong">{e.text}</Link> : <div className="text-sm">{e.text}</div>}
                    <div className="text-xs text-faint">{formatDate(e.at, tz, true)}{e.sub ? ` · ${e.sub}` : ""}</div>
                  </li>
                ))}
              </ol>
            )}
            {tab === "transactions" && (txs.length ? (
              <ul className="divide-y divide-line">
                {txs.slice(0, 100).map((t) => (
                  <li key={t.id}><Link to={`/transactions?open=${t.id}`} className="flex items-center gap-3 py-2.5 hover:bg-surface-2 -mx-2 px-2 rounded-lg"><span className="text-xs text-muted w-24 shrink-0">{formatDate(t.date, tz)}</span><span className="flex-1 truncate text-sm">{t.description}</span><StatusBadge status={t.status} /><Money amount={t.gross} currency={t.currency} className="w-24 text-right text-sm" /></Link></li>
                ))}
              </ul>
            ) : <EmptyState title="No transactions" />)}
            {tab === "invoices" && (invs.length ? (
              <ul className="divide-y divide-line">
                {invs.map((i) => (
                  <li key={i.id}><Link to={`/invoices?open=${i.id}`} className="flex items-center gap-3 py-2.5 hover:bg-surface-2 -mx-2 px-2 rounded-lg"><span className="text-sm font-medium w-24 shrink-0">{i.number}</span><span className="flex-1 text-xs text-muted">Due {formatDate(i.dueDate, tz)}</span><StatusBadge status={i.status} /><Money amount={i.totals.total} currency={i.currency} className="w-24 text-right text-sm" /></Link></li>
                ))}
              </ul>
            ) : <EmptyState title="No invoices" />)}
          </div>
        </Card>
      </div>
      <CustomerForm open={editOpen} onClose={() => setEditOpen(false)} customer={c} />
      <ConfirmDialog open={archiveOpen} onClose={() => setArchiveOpen(false)} danger title={`Archive ${c.name}?`} description="The customer is hidden from lists. Their transactions and invoices are kept for your records." confirmLabel="Archive" onConfirm={async () => { try { await repo!.archive("customers", c.id); toast.success("Customer archived"); nav("/customers"); } catch (e) { toast.error("Couldn't archive", errorMessage(e)); } }} />
    </div>
  );
}
