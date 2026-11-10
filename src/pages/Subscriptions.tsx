import { useMemo, useState } from "react";
import { Repeat, CalendarClock, Info } from "lucide-react";
import { useActive, useWorkspace } from "@/context/WorkspaceContext";
import { PageHeader, Stat } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { SearchInput, Select } from "@/components/ui/Form";
import { DataTable, type Column } from "@/components/ui/Table";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { Drawer } from "@/components/ui/Dialog";
import { SkeletonRows, EmptyState, ErrorState } from "@/components/ui/Feedback";
import { PayPalBanner } from "@/components/layout/AppShell";
import { upcomingRenewals } from "@shared/analytics";
import { formatMoney } from "@shared/money";
import { formatDate } from "@shared/dates";
import type { Subscription } from "@shared/types";
import { Link } from "react-router-dom";

const MONTHLY = { week: 52 / 12, month: 1, quarter: 1 / 3, year: 1 / 12 };

export default function Subscriptions() {
  const { org, mode, paypalState, paypal } = useWorkspace();
  const { rows, loading, error } = useActive("subscriptions");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const tz = org?.timezone ?? "UTC";
  const rc = org?.reportingCurrency ?? "USD";
  const renewals = useMemo(() => (org ? upcomingRenewals({ org, subscriptions: rows } as any, 30) : []), [org, rows]);
  const mrr = useMemo(() => rows.filter((s) => s.status === "active" && s.currency === rc).reduce((a, s) => a + s.amount * MONTHLY[s.interval], 0), [rows, rc]);
  const filtered = rows.filter((s) => (status === "all" || s.status === status) && (!q || [s.customerName, s.productName].some((x) => x.toLowerCase().includes(q.toLowerCase()))));
  const subsUnsupported = mode === "real" && paypal?.status === "connected" && !paypal.capabilities.subscriptions;

  const cols: Column<Subscription>[] = [
    { key: "customer", header: "Customer", cell: (s) => <Link to={`/customers/${s.customerId}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent-strong">{s.customerName}</Link>, sort: (s) => s.customerName },
    { key: "product", header: "Plan", cell: (s) => <span className="text-muted">{s.productName}</span>, hideBelow: "md" },
    { key: "status", header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
    { key: "interval", header: "Billing", cell: (s) => <span className="text-muted">Every {s.interval}</span>, hideBelow: "lg" },
    { key: "next", header: "Next billing", cell: (s) => <span className="text-muted">{s.status === "cancelled" ? "—" : formatDate(s.nextBillingDate, tz)}</span>, sort: (s) => s.nextBillingDate, hideBelow: "sm" },
    { key: "amount", header: "Amount", align: "right", cell: (s) => <Money amount={s.amount} currency={s.currency} />, sort: (s) => s.amount },
  ];
  const open = rows.find((s) => s.id === openId);
  return (
    <div>
      <PageHeader title="Subscriptions" description={mode === "demo" ? "Sample recurring billing data." : "Recurring billing synced from PayPal Subscriptions. PayPilot only shows what PayPal reports."} />
      <PayPalBanner />
      {subsUnsupported && <div className="mb-4 flex gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted"><Info className="size-4 shrink-0 mt-0.5" />Your PayPal credentials don't have the Subscriptions feature enabled, so no subscription data can be synced. Enable it in your PayPal app settings.</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Active subscriptions" value={rows.filter((s) => s.status === "active").length} />
        <Stat label={`MRR (${rc}, active)`} value={formatMoney(Math.round(mrr), rc)} sub="Monthly-normalized" />
        <Stat label="Past due" value={rows.filter((s) => s.status === "past_due").length} tone={rows.some((s) => s.status === "past_due") ? "negative" : undefined} />
        <Stat label="Renewing in 30 days" value={renewals.length} sub={formatMoney(renewals.filter((r) => r.currency === rc).reduce((a, r) => a + r.amount, 0), rc)} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <Card>
          <div className="flex flex-col sm:flex-row gap-2 p-4 border-b border-line">
            <SearchInput value={q} onChange={setQ} className="sm:w-72" />
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-44"><option value="all">All statuses</option>{["active", "trialing", "past_due", "paused", "cancelled"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select>
          </div>
          {error ? <ErrorState error={error} /> : loading ? <SkeletonRows /> : <DataTable rows={filtered} columns={cols} rowKey={(s) => s.id} onRowClick={(s) => setOpenId(s.id)} initialSort={{ key: "next", dir: "asc" }} empty={<EmptyState icon={<Repeat className="size-5" />} title="No subscriptions" description={mode === "real" ? (paypalState === "not_connected" ? "Connect PayPal to sync subscriptions." : "No PayPal subscriptions found for this account.") : undefined} />} />}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Upcoming renewals" subtitle="Next 30 days" icon={<CalendarClock className="size-4" />} />
          <CardBody>
            {renewals.length ? (
              <ul className="space-y-3">
                {renewals.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 text-sm">
                    <div className="w-12 text-center shrink-0"><div className="text-[10px] uppercase text-faint">{new Date(`${r.nextBillingDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</div><div className="text-base font-semibold tabular">{r.nextBillingDate.slice(8)}</div></div>
                    <div className="min-w-0 flex-1"><div className="truncate">{r.customerName}</div><div className="text-xs text-muted">{r.inDays === 0 ? "Today" : `in ${r.inDays} day(s)`}</div></div>
                    <Money amount={r.amount} currency={r.currency} />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No renewals in the next 30 days.</p>}
          </CardBody>
        </Card>
      </div>
      {open && (
        <Drawer open onClose={() => setOpenId(null)} title={open.productName} subtitle={<span className="inline-flex items-center gap-2"><StatusBadge status={open.status} />{open.customerName}</span>}>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-xs text-muted">Amount</dt><dd>{formatMoney(open.amount, open.currency)} / {open.interval}</dd></div>
            <div><dt className="text-xs text-muted">Started</dt><dd>{formatDate(open.startDate, tz)}</dd></div>
            <div><dt className="text-xs text-muted">Next billing</dt><dd>{open.status === "cancelled" ? "—" : formatDate(open.nextBillingDate, tz)}</dd></div>
            <div><dt className="text-xs text-muted">Source</dt><dd>{open.source === "paypal" ? <Badge tone="blue">PayPal</Badge> : open.source === "demo" ? <Badge tone="amber">Sample</Badge> : "Manual"}{open.externalId && <div className="font-mono text-[11px] text-faint mt-1">{open.externalId}</div>}</dd></div>
          </dl>
          <h3 className="mt-6 mb-2 text-xs font-medium uppercase tracking-wide text-faint">Payment history</h3>
          {open.paymentHistory.length ? (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {[...open.paymentHistory].reverse().map((p, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-muted">{formatDate(p.date, tz)}</span>
                  <span className="flex items-center gap-3"><StatusBadge status={p.status} /><Money amount={p.amount} currency={open.currency} /></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">No payments yet.</p>}
          <p className="mt-6 text-xs text-faint">Plan changes, pauses and cancellations are managed in PayPal; PayPilot reflects them on the next sync or webhook.</p>
        </Drawer>
      )}
    </div>
  );
}
