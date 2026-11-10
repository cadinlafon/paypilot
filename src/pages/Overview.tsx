import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bot, FilePlus2, GripVertical, Link2, Receipt, RefreshCw, Settings2, Sparkles, UserPlus, Eye, EyeOff, AlertTriangle, TrendingUp, Gauge, PlugZap, RotateCcw } from "lucide-react";
import { useDataset, useWorkspace } from "@/context/WorkspaceContext";
import { PageHeader, Stat, Delta } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DateRangeControl, CurrencyControl, useRange } from "@/components/ui/Filters";
import { TimeChart, HBarList } from "@/components/ui/Charts";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Skeleton, EmptyState, ErrorState } from "@/components/ui/Feedback";
import { Money } from "@/components/ui/Money";
import { useToast } from "@/components/ui/Toast";
import { currenciesIn, detectAnomalies, outstandingInvoices, pctChange, restrictToCurrency, revenueByProduct, summarize, timeSeries, topCustomers, upcomingRenewals } from "@shared/analytics";
import { formatMoney } from "@shared/money";
import { formatDate, previousRange } from "@shared/dates";
import type { Dataset } from "@shared/types";
import { cn, errorMessage, pct, relativeTime } from "@/lib/utils";

type WidgetId = "kpis" | "revenue" | "transactions" | "invoices" | "insights" | "actions" | "customers" | "products" | "renewals" | "outstanding" | "volume" | "success";
const DEFAULT_ORDER: WidgetId[] = ["kpis", "revenue", "insights", "volume", "success", "actions", "transactions", "invoices", "customers", "products", "outstanding", "renewals"];
const WIDE: WidgetId[] = ["kpis", "revenue", "transactions"];
const TITLES: Record<WidgetId, string> = { kpis: "Revenue overview", revenue: "Revenue over time", transactions: "Recent transactions", invoices: "Recent invoices", insights: "AI business insights", actions: "Quick actions", customers: "Top customers", products: "Revenue by product/service", renewals: "Upcoming renewals", outstanding: "Outstanding payments", volume: "Transaction volume", success: "Payment success rate" };

function useLayout(key: string) {
  const read = (): { order: WidgetId[]; hidden: WidgetId[] } => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "null");
      if (v?.order) return { order: [...v.order.filter((x: WidgetId) => DEFAULT_ORDER.includes(x)), ...DEFAULT_ORDER.filter((x) => !v.order.includes(x))], hidden: v.hidden ?? [] };
    } catch {
      /* ignore */
    }
    return { order: DEFAULT_ORDER, hidden: [] };
  };
  const [layout, setLayout] = useState(read);
  const save = (l: typeof layout) => {
    setLayout(l);
    localStorage.setItem(key, JSON.stringify(l));
  };
  return { layout, save, reset: () => save({ order: DEFAULT_ORDER, hidden: [] }) };
}

export default function Overview() {
  const { org, mode, paypalState, repo, orgId } = useWorkspace();
  const { ds: raw, loading, error } = useDataset();
  const tz = org?.timezone ?? "UTC";
  const { state, setState, range } = useRange(tz, "30d");
  const [currency, setCurrency] = useState("all");
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<WidgetId | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { layout, save, reset } = useLayout(`paypilot:dash:${mode}:${orgId}`);
  const toast = useToast();
  const ds = useMemo(() => (raw ? restrictToCurrency(raw, currency) : null), [raw, currency]);
  const cur = ds?.org.reportingCurrency ?? org?.reportingCurrency ?? "USD";

  const refresh = async () => {
    if (!repo) return;
    setRefreshing(true);
    try {
      if (mode === "demo") {
        await new Promise((r) => setTimeout(r, 500));
        toast.info("Demo data refreshed", "Sample data is generated locally — nothing to sync.");
      } else if (paypalState === "not_connected") toast.info("Nothing to sync", "Connect PayPal in Integrations to sync transactions.");
      else toast.result(await repo.syncNow("manual"), "Sync started");
    } catch (e) {
      toast.error("Refresh failed", errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  const onDrop = (target: WidgetId) => {
    if (!drag || drag === target) return;
    const order = layout.order.filter((x) => x !== drag);
    order.splice(order.indexOf(target), 0, drag);
    save({ ...layout, order });
    setDrag(null);
  };

  const empty = !!ds && ds.transactions.length === 0 && ds.invoices.length === 0;

  return (
    <div>
      <PageHeader
        title="Overview"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {org?.name} · {tz.replace(/_/g, " ")}
            {mode === "demo" ? <Badge tone="amber">Sample data</Badge> : <Badge tone={paypalState === "not_connected" ? "neutral" : "blue"}>{paypalState === "not_connected" ? "PayPal not connected" : `PayPal ${paypalState}`}</Badge>}
          </span>
        }
        actions={
          <>
            <DateRangeControl state={state} onChange={setState} tz={tz} />
            {raw && <CurrencyControl value={currency} onChange={setCurrency} currencies={currenciesIn(raw)} reporting={raw.org.reportingCurrency} />}
            <Button size="icon" variant="secondary" onClick={refresh} aria-label="Refresh dashboard" title="Refresh"><RefreshCw className={cn("size-4", refreshing && "animate-spin")} /></Button>
            <Button variant={editing ? "primary" : "secondary"} icon={<Settings2 className="size-4" />} onClick={() => setEditing((e) => !e)}>{editing ? "Done" : "Customize"}</Button>
          </>
        }
      />
      {mode === "real" && paypalState === "not_connected" && <ConnectHero />}
      {editing && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-3 text-xs text-muted">
          Drag widgets to rearrange. Hidden:
          {layout.hidden.length ? layout.hidden.map((h) => <button key={h} onClick={() => save({ ...layout, hidden: layout.hidden.filter((x) => x !== h) })} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:text-fg"><Eye className="size-3" />{TITLES[h]}</button>) : <span className="text-faint">none</span>}
          <button onClick={reset} className="ml-auto inline-flex items-center gap-1 hover:text-fg"><RotateCcw className="size-3" /> Reset layout</button>
        </div>
      )}
      {error ? (
        <Card><ErrorState error={error} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {layout.order.filter((w) => !layout.hidden.includes(w)).map((w) => (
            <div
              key={w}
              className={cn(WIDE.includes(w) && (w === "kpis" ? "lg:col-span-3" : "lg:col-span-2"), editing && "relative rounded-2xl ring-1 ring-dashed ring-line-strong", drag === w && "opacity-40")}
              draggable={editing}
              onDragStart={() => setDrag(w)}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => editing && e.preventDefault()}
              onDrop={() => onDrop(w)}
            >
              {editing && (
                <div className="absolute -top-2.5 right-3 z-10 flex gap-1">
                  <span className="cursor-grab rounded-md border border-line-strong bg-surface-2 p-1 text-muted" title="Drag to move"><GripVertical className="size-3.5" /></span>
                  <button className="rounded-md border border-line-strong bg-surface-2 p-1 text-muted hover:text-fg" onClick={() => save({ ...layout, hidden: [...layout.hidden, w] })} title="Hide widget" aria-label={`Hide ${TITLES[w]}`}><EyeOff className="size-3.5" /></button>
                </div>
              )}
              {loading || !ds ? <WidgetSkeleton wide={w === "kpis"} /> : <Widget id={w} ds={ds} range={range} cur={cur} empty={empty} />}
            </div>
          ))}
        </div>
      )}
      <p className="mt-6 text-[11px] text-faint">Figures are management information from {mode === "demo" ? "sample data" : "connected records"}, not audited accounts or tax advice. Converted amounts use the exchange rate on each transaction's date; estimates are flagged.</p>
    </div>
  );
}

function WidgetSkeleton({ wide }: { wide?: boolean }) {
  return wide ? (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
  ) : (
    <Card className="p-5 h-72"><Skeleton className="h-4 w-32" /><Skeleton className="h-48 mt-6" /></Card>
  );
}

function ConnectHero() {
  const { can } = useWorkspace();
  return (
    <Card className="mb-5 p-5 sm:p-6 border-sky-500/20 bg-gradient-to-br from-sky-500/[0.06] to-transparent">
      <div className="flex flex-col md:flex-row md:items-center gap-5">
        <div className="grid grid-cols-1 place-items-center size-11 rounded-xl bg-sky-500/15 text-sky-300 shrink-0"><PlugZap className="size-5" /></div>
        <div className="flex-1">
          <h2 className="text-base font-semibold">Connect PayPal to see real numbers</h2>
          <p className="text-sm text-muted mt-1 max-w-2xl">Your organization is ready, but no payment data is connected yet — so this dashboard shows only what you've entered manually. Start with PayPal <strong className="text-fg">Sandbox</strong> using your Developer app credentials; Live access requires PayPal partner approval.</p>
          <ol className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <li>1 · Create a REST app at developer.paypal.com</li>
            <li>2 · Paste the Sandbox client ID & secret</li>
            <li>3 · PayPilot verifies them, registers webhooks and syncs</li>
          </ol>
        </div>
        {can("integrations.manage") ? <Link to="/integrations"><Button variant="primary">Connect PayPal <ArrowRight className="size-4" /></Button></Link> : <p className="text-xs text-muted">Ask an admin to connect PayPal.</p>}
      </div>
    </Card>
  );
}

function Widget({ id, ds, range, cur, empty }: { id: WidgetId; ds: Dataset; range: { from: string; to: string }; cur: string; empty: boolean }) {
  const nav = useNavigate();
  const tz = ds.org.timezone;
  const s = useMemo(() => summarize(ds, range), [ds, range]);
  const prev = useMemo(() => summarize(ds, previousRange(range)), [ds, range]);
  const m = (v: number) => formatMoney(v, cur);
  const shell = (children: ReactNode, action?: ReactNode, sub?: ReactNode) => (
    <Card className="h-full">
      <CardHeader title={TITLES[id]} subtitle={sub} action={action} />
      <CardBody>{children}</CardBody>
    </Card>
  );
  const viewAll = (to: string) => <Link to={to} className="text-xs text-muted hover:text-fg inline-flex items-center gap-1">View all <ArrowRight className="size-3" /></Link>;

  switch (id) {
    case "kpis":
      return (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Stat label="Gross receipts" value={m(s.grossReceipts)} sub={<Delta value={pctChange(s.grossReceipts, prev.grossReceipts)} />} />
          <Stat label="Refunds" value={m(-s.refunds)} tone={s.refunds ? "negative" : undefined} sub={<Delta value={pctChange(s.refunds, prev.refunds)} invert />} />
          <Stat label="Processing fees" value={m(-s.fees)} tone={s.fees ? "negative" : undefined} sub={<span className="text-faint">{s.grossReceipts ? pct(s.fees / s.grossReceipts) : "—"} of gross</span>} />
          <Stat label="Net revenue" value={m(s.netRevenue)} tone="positive" sub={<Delta value={pctChange(s.netRevenue, prev.netRevenue)} />} />
          <Stat label="Expenses" value={m(-s.expenses)} tone={s.expenses ? "negative" : undefined} sub={<Delta value={pctChange(s.expenses, prev.expenses)} invert />} />
          <Stat label="Net after expenses" value={m(s.netAfterExpenses)} tone={s.netAfterExpenses < 0 ? "negative" : undefined} sub={s.estimatedConversions ? <span className="text-amber-300/80">{s.estimatedConversions} est. conversion(s)</span> : <span className="text-faint">vs previous period</span>} />
        </div>
      );
    case "revenue": {
      const series = timeSeries(ds, range);
      return shell(
        empty ? <EmptyState title="No revenue yet" description="Payments will appear here once they arrive." /> : <TimeChart data={series} series={[{ key: "gross", name: "Gross" }, { key: "net", name: "Net", color: "#38bdf8" }, { key: "expenses", name: "Expenses", color: "#f472b6" }]} currency={cur} height={260} />,
        undefined,
        `${formatDate(range.from, tz)} – ${formatDate(range.to, tz)} · ${cur}`,
      );
    }
    case "volume": {
      const series = timeSeries(ds, range);
      return shell(<TimeChart data={series} series={[{ key: "count", name: "Successful" }, { key: "failed", name: "Failed", color: "#f43f5e" }]} type="bar" format="number" height={200} stacked />, undefined, `${s.transactionCount.toLocaleString()} attempts`);
    }
    case "success": {
      const rate = s.successRate;
      const r = 52, c = 2 * Math.PI * r;
      return shell(
        <div className="flex items-center gap-6">
          <svg viewBox="0 0 120 120" className="size-32 -rotate-90 shrink-0" aria-label={`Success rate ${pct(rate)}`}>
            <circle cx="60" cy="60" r={r} fill="none" stroke="#1c2125" strokeWidth="10" />
            <circle cx="60" cy="60" r={r} fill="none" stroke={rate > 0.95 ? "#10b981" : rate > 0.9 ? "#f59e0b" : "#f43f5e"} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * rate} ${c}`} className="transition-all duration-700" />
          </svg>
          <div>
            <div className="text-3xl font-semibold tabular">{s.successfulCount + s.failedCount ? pct(rate) : "—"}</div>
            <div className="text-xs text-muted mt-1">{s.successfulCount} succeeded · {s.failedCount} failed/denied</div>
            <div className="text-xs mt-2"><Delta value={pctChange(s.successRate, prev.successRate)} /> <span className="text-faint">vs prior</span></div>
          </div>
        </div>,
        <Gauge className="size-4 text-faint" />,
      );
    }
    case "transactions": {
      const rows = ds.transactions.filter((t) => t.type !== "purchase").slice(0, 7);
      return shell(
        rows.length ? (
          <ul className="divide-y divide-line -mx-5">
            {rows.map((t) => (
              <li key={t.id}>
                <button onClick={() => nav(`/transactions?open=${t.id}`)} className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">{t.customerName}</span>
                    <span className="block text-xs text-muted truncate">{t.description} · {relativeTime(t.date)}</span>
                  </span>
                  <StatusBadge status={t.status} />
                  <Money amount={t.gross} currency={t.currency} className="w-28 text-right text-sm" />
                </button>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No transactions" />,
        viewAll("/transactions"),
      );
    }
    case "invoices": {
      const rows = [...ds.invoices].filter((i) => !i.archivedAt).sort((a, b) => b.issueDate.localeCompare(a.issueDate)).slice(0, 6);
      return shell(
        rows.length ? (
          <ul className="space-y-2.5">
            {rows.map((i) => (
              <li key={i.id} className="flex items-center gap-3">
                <Link to={`/invoices?open=${i.id}`} className="min-w-0 flex-1 hover:text-accent-strong">
                  <span className="block text-sm truncate">{i.number} · {i.customerName}</span>
                  <span className="block text-xs text-muted">Due {formatDate(i.dueDate, tz)}</span>
                </Link>
                <StatusBadge status={i.status} />
                <Money amount={i.totals.total} currency={i.currency} className="text-sm w-24 text-right" />
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No invoices yet" action={<Link to="/invoices?new=1"><Button size="sm">Create invoice</Button></Link>} />,
        viewAll("/invoices"),
      );
    }
    case "insights":
      return <InsightsWidget ds={ds} range={range} s={s} prev={prev} cur={cur} />;
    case "actions": {
      const A = ({ to, icon, label }: { to: string; icon: ReactNode; label: string }) => (
        <Link to={to} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/50 px-3 py-2.5 text-sm hover:border-accent/40 hover:bg-accent-soft/40 transition-colors">
          <span className="text-accent">{icon}</span>
          {label}
        </Link>
      );
      return shell(
        <div className="grid grid-cols-2 gap-2">
          <A to="/invoices?new=1" icon={<FilePlus2 className="size-4" />} label="New invoice" />
          <A to="/payment-links?new=1" icon={<Link2 className="size-4" />} label="Payment link" />
          <A to="/customers?new=1" icon={<UserPlus className="size-4" />} label="Add customer" />
          <A to="/expenses?new=1" icon={<Receipt className="size-4" />} label="Log expense" />
          <A to="/assistant?prompt=Give%20me%20today%27s%20briefing" icon={<Bot className="size-4" />} label="Daily briefing" />
          <A to="/analytics" icon={<TrendingUp className="size-4" />} label="Reports" />
        </div>,
      );
    }
    case "customers": {
      const rows = topCustomers(ds, range, 5);
      return shell(rows.length ? <HBarList data={rows.map((c) => ({ label: c.name, value: c.total, sub: `${c.count} payment(s)` }))} currency={cur} /> : <EmptyState title="No paying customers in this period" />, viewAll("/customers"));
    }
    case "products": {
      const rows = revenueByProduct(ds, range).slice(0, 6);
      return shell(rows.length ? <HBarList data={rows.map((p) => ({ label: p.name, value: p.gross, sub: `${p.count} sale(s) · net ${m(p.net)}` }))} currency={cur} /> : <EmptyState title="No product revenue in this period" />);
    }
    case "renewals": {
      const rows = upcomingRenewals(ds, 14);
      return shell(
        rows.length ? (
          <ul className="space-y-2.5">
            {rows.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-sm">
                <span className="grid grid-cols-1 place-items-center size-9 rounded-lg bg-surface-2 border border-line text-xs tabular shrink-0">{r.inDays === 0 ? "Today" : `${r.inDays}d`}</span>
                <span className="min-w-0 flex-1"><span className="block truncate">{r.customerName}</span><span className="block text-xs text-muted truncate">{r.productName}</span></span>
                <Money amount={r.amount} currency={r.currency} />
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No renewals in the next 14 days" />,
        viewAll("/subscriptions"),
        "Next 14 days",
      );
    }
    case "outstanding": {
      const rows = outstandingInvoices(ds);
      const total = rows.filter((r) => r.currency === cur).reduce((a, r) => a + r.totals.balance, 0);
      const overdue = rows.filter((r) => r.daysOverdue > 0 && r.currency === cur).reduce((a, r) => a + r.totals.balance, 0);
      return shell(
        <>
          <div className="flex gap-6 mb-4">
            <div><div className="text-xs text-muted">Outstanding</div><div className="text-lg font-semibold tabular">{m(total)}</div></div>
            <div><div className="text-xs text-muted">Overdue</div><div className="text-lg font-semibold tabular text-rose-300">{m(overdue)}</div></div>
          </div>
          <ul className="space-y-2">
            {rows.slice(0, 4).map((i) => (
              <li key={i.id} className="flex items-center gap-2 text-sm">
                <Link to={`/invoices?open=${i.id}`} className="truncate flex-1 hover:text-accent-strong">{i.customerName}</Link>
                {i.daysOverdue > 0 ? <Badge tone="red">{i.daysOverdue}d late</Badge> : <Badge>due {formatDate(i.dueDate, tz)}</Badge>}
                <Money amount={i.totals.balance} currency={i.currency} className="w-24 text-right" />
              </li>
            ))}
          </ul>
        </>,
        viewAll("/invoices"),
      );
    }
  }
}

function InsightsWidget({ ds, range, s, prev, cur }: { ds: Dataset; range: { from: string; to: string }; s: ReturnType<typeof summarize>; prev: ReturnType<typeof summarize>; cur: string }) {
  const nav = useNavigate();
  const insights = useMemo(() => {
    const out: { tone: "green" | "amber" | "red" | "blue"; text: string; to?: string }[] = [];
    const g = pctChange(s.grossReceipts, prev.grossReceipts);
    if (g !== null && Math.abs(g) > 0.05) out.push({ tone: g > 0 ? "green" : "amber", text: `Gross receipts are ${g > 0 ? "up" : "down"} ${Math.abs(g * 100).toFixed(0)}% versus the previous period (${formatMoney(s.grossReceipts, cur)}).` });
    const an = detectAnomalies(ds, range);
    if (an.length) out.push({ tone: "red", text: `${an.length} unusual pattern(s) flagged for review — e.g. ${an[0].reason.toLowerCase()}.`, to: "/assistant?prompt=Find%20unusual%20transactions" });
    const od = outstandingInvoices(ds).filter((i) => i.daysOverdue > 0);
    if (od.length) out.push({ tone: "amber", text: `${od.length} invoice(s) overdue. Oldest: ${od[0].number} (${od[0].daysOverdue} days).`, to: "/assistant?prompt=Which%20invoices%20are%20overdue%3F" });
    const top = revenueByProduct(ds, range)[0];
    if (top) out.push({ tone: "blue", text: `${top.name} is your top earner this period at ${formatMoney(top.gross, cur)}.` });
    if (s.grossReceipts && s.fees / s.grossReceipts > 0.04) out.push({ tone: "amber", text: `Processing fees are ${pct(s.fees / s.grossReceipts)} of gross — consider bank transfer for large B2B invoices.` });
    return out.slice(0, 4);
  }, [ds, range, s, prev, cur]);
  return (
    <Card className="h-full">
      <CardHeader title="AI business insights" icon={<Sparkles className="size-4 text-accent" />} action={<Link to="/assistant" className="text-xs text-muted hover:text-fg">Ask AI</Link>} />
      <CardBody>
        {insights.length ? (
          <ul className="space-y-2.5">
            {insights.map((i, k) => (
              <li key={k}>
                <button disabled={!i.to} onClick={() => i.to && nav(i.to)} className={cn("w-full text-left flex gap-2.5 rounded-lg p-2 -m-2 text-sm", i.to && "hover:bg-surface-2")}>
                  {i.tone === "red" ? <AlertTriangle className="size-4 text-rose-300 shrink-0 mt-0.5" /> : <span className={cn("mt-1.5 size-1.5 rounded-full shrink-0", { green: "bg-accent", amber: "bg-amber-400", blue: "bg-sky-400", red: "" }[i.tone])} />}
                  <span className="text-muted leading-snug">{i.text}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="Not enough data yet" description="Insights appear once there's activity to analyze." />}
        <p className="mt-4 text-[11px] text-faint">Computed from your data. Flags are for human review only.</p>
      </CardBody>
    </Card>
  );
}
