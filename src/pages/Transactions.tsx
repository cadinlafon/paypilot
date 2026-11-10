import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, RefreshCw, Undo2, HandCoins, FlaskConical, ExternalLink, Receipt, Zap } from "lucide-react";
import { useCollection, useWorkspace } from "@/context/WorkspaceContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SearchInput, Select, Field, Input } from "@/components/ui/Form";
import { DateRangeControl, useRange } from "@/components/ui/Filters";
import { DataTable, type Column } from "@/components/ui/Table";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { DualMoney, Money } from "@/components/ui/Money";
import { Drawer, ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { SkeletonRows, EmptyState, ErrorState } from "@/components/ui/Feedback";
import { PayPalBanner, SandboxNote } from "@/components/layout/AppShell";
import { useToast } from "@/components/ui/Toast";
import type { Transaction } from "@shared/types";
import { formatMoney, parseMoneyInput, toMajor, txReporting } from "@shared/money";
import { dateKey, formatDate } from "@shared/dates";
import { downloadCsv } from "@/lib/csv";
import { errorMessage, titleCase } from "@/lib/utils";

const STATUSES = ["completed", "pending", "authorized", "failed", "denied", "refunded", "partially_refunded", "voided"];
const METHODS = ["paypal", "card", "venmo", "pay_later", "bank"];

export default function Transactions() {
  const { org, mode, repo, paypalState } = useWorkspace();
  const { rows, loading, error } = useCollection("transactions");
  const tz = org?.timezone ?? "UTC";
  const rc = org?.reportingCurrency ?? "USD";
  const { state, setState, range } = useRange(tz, "90d");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [method, setMethod] = useState("all");
  const [kind, setKind] = useState("incoming");
  const [params, setParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(params.get("open"));
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const o = params.get("open");
    if (o) {
      setOpenId(o);
      setState({ preset: "12m" });
    }
  }, [params, setState]);

  const currencies = useMemo(() => [...new Set(rows.map((t) => t.currency))].sort(), [rows]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((t) => {
      if (t.archivedAt) return false;
      const k = dateKey(t.date, tz);
      if (k < range.from || k > range.to) return false;
      if (kind === "incoming" && t.type === "purchase") return false;
      if (kind === "outgoing" && t.type !== "purchase") return false;
      if (status !== "all" && t.status !== status) return false;
      if (currency !== "all" && t.currency !== currency) return false;
      if (method !== "all" && t.paymentMethod !== method) return false;
      if (s && ![t.customerName, t.customerEmail ?? "", t.description, t.externalId ?? "", t.id].some((x) => x.toLowerCase().includes(s))) {
        const amt = Number(s.replace(/[$,€£]/g, ""));
        if (!amt || Math.abs(toMajor(t.gross, t.currency) - amt) > 0.005) return false;
      }
      return true;
    });
  }, [rows, q, status, currency, method, kind, range, tz]);

  const totals = useMemo(() => {
    let gross = 0, fees = 0, refunds = 0;
    for (const t of filtered) {
      if (!["completed", "refunded", "partially_refunded"].includes(t.status) || t.type === "purchase") continue;
      const r = txReporting(t, rc);
      gross += r.gross;
      fees += r.fee;
      refunds += r.refunded;
    }
    return { gross, fees, refunds, net: gross - fees - refunds };
  }, [filtered, rc]);

  const cols: Column<Transaction>[] = [
    { key: "date", header: "Date", cell: (t) => <span className="text-muted">{formatDate(t.date, tz, true)}</span>, sort: (t) => t.date },
    {
      key: "customer",
      header: "Customer / description",
      cell: (t) => (
        <div className="max-w-[260px]">
          <div className="truncate">{t.customerName}</div>
          <div className="text-xs text-muted truncate">{t.description}</div>
        </div>
      ),
      sort: (t) => t.customerName,
    },
    { key: "status", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
    { key: "method", header: "Method", cell: (t) => <span className="text-muted">{titleCase(t.paymentMethod)}</span>, hideBelow: "md" },
    { key: "fee", header: "Fee", align: "right", cell: (t) => (t.fee ? <Money amount={-t.fee} currency={t.currency} muted /> : <span className="text-faint">—</span>), hideBelow: "lg" },
    { key: "amount", header: "Amount", align: "right", cell: (t) => <DualMoney amount={t.type === "purchase" ? -t.gross : t.gross} currency={t.currency} reportingAmount={t.reporting?.gross} reportingCurrency={rc} estimated={t.reporting?.estimated} />, sort: (t) => txReporting(t, rc).gross },
  ];

  const exportCsv = () =>
    downloadCsv(
      `transactions-${range.from}-to-${range.to}.csv`,
      filtered.map((t) => ({
        date: t.date,
        id: t.externalId ?? t.id,
        type: t.type,
        status: t.status,
        customer: t.customerName,
        email: t.customerEmail ?? "",
        description: t.description,
        method: t.paymentMethod,
        currency: t.currency,
        gross: toMajor(t.gross, t.currency),
        fee: toMajor(t.fee, t.currency),
        refunded: toMajor(t.refundedAmount, t.currency),
        net: toMajor(t.net - t.refundedAmount, t.currency),
        reporting_currency: rc,
        reporting_gross: t.currency === rc ? toMajor(t.gross, rc) : t.reporting ? toMajor(t.reporting.gross, rc) : "",
        fx_rate: t.currency === rc ? 1 : (t.reporting?.rate ?? ""),
        fx_rate_date: t.reporting?.rateTimestamp ?? "",
        fx_provider: t.reporting?.provider ?? "",
        fx_estimated: t.reporting?.estimated ? "yes" : "no",
        source: t.source,
      })),
    );

  const sync = async () => {
    if (!repo) return;
    setSyncing(true);
    try {
      toast.result(await repo.syncNow("manual"), "Sync started");
    } catch (e) {
      toast.error("Sync failed", errorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  const open = rows.find((t) => t.id === openId) ?? null;

  return (
    <div>
      <PageHeader
        title="Transactions"
        description="Every payment, refund and authorization. Original amounts are never changed; converted amounts are shown beneath."
        actions={
          <>
            {mode === "demo" && <SimulatePayment />}
            <Button icon={<RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />} onClick={sync} disabled={mode === "demo" || paypalState === "not_connected"} title={mode === "demo" ? "Nothing to sync in Demo Mode" : undefined}>Refresh</Button>
            <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={!filtered.length}>Export CSV</Button>
          </>
        }
      />
      <PayPalBanner />
      <SandboxNote />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          ["Gross receipts", totals.gross],
          ["Refunds", -totals.refunds],
          ["Processing fees", -totals.fees],
          ["Net", totals.net],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border border-line bg-surface px-4 py-3">
            <div className="text-xs text-muted">{l}</div>
            <Money amount={v as number} currency={rc} className="text-base font-semibold" />
          </div>
        ))}
      </div>
      <Card>
        <div className="flex flex-col xl:flex-row gap-2 p-4 border-b border-line">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, email, ID or amount…" className="xl:w-72" />
          <div className="flex flex-wrap gap-2">
            <DateRangeControl state={state} onChange={setState} tz={tz} />
            <Select aria-label="Direction" value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto"><option value="incoming">Incoming</option><option value="outgoing">Outgoing (purchases)</option><option value="all">All</option></Select>
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto"><option value="all">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
            <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-auto"><option value="all">All currencies</option>{currencies.map((c) => <option key={c}>{c}</option>)}</Select>
            <Select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} className="w-auto"><option value="all">All methods</option>{METHODS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</Select>
          </div>
        </div>
        {error ? <ErrorState error={error} /> : loading ? <SkeletonRows /> : (
          <DataTable rows={filtered} columns={cols} rowKey={(t) => t.id} onRowClick={(t) => setOpenId(t.id)} initialSort={{ key: "date", dir: "desc" }} empty={<EmptyState title="No transactions match" description={rows.length ? "Try widening the date range or clearing filters." : mode === "real" ? "Connect PayPal to sync transactions." : undefined} />} />
        )}
      </Card>
      {open && <TransactionDrawer t={open} onClose={() => { setOpenId(null); if (params.get("open")) setParams({}, { replace: true }); }} />}
    </div>
  );
}

function TransactionDrawer({ t, onClose }: { t: Transaction; onClose: () => void }) {
  const { org, mode, repo, can } = useWorkspace();
  const toast = useToast();
  const invoices = useCollection("invoices").rows;
  const expenses = useCollection("expenses").rows;
  const tz = org?.timezone ?? "UTC";
  const rc = org?.reportingCurrency ?? "USD";
  const [refundOpen, setRefundOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [amount, setAmount] = useState(() => (toMajor(t.gross - t.refundedAmount, t.currency)).toFixed(2));
  const [reason, setReason] = useState("Customer request");
  const [busy, setBusy] = useState(false);
  const inv = t.invoiceId ? invoices.find((i) => i.id === t.invoiceId) : undefined;
  const linkedExpense = expenses.find((e) => e.linkedTransactionId === t.id && !e.archivedAt);
  const refundable = ["completed", "partially_refunded"].includes(t.status) && t.type !== "purchase" && t.gross - t.refundedAmount > 0;
  const refundMinor = parseMoneyInput(amount, t.currency);
  const refundValid = refundMinor > 0 && refundMinor <= t.gross - t.refundedAmount;

  const doRefund = async () => {
    if (!repo || !refundValid) return;
    setBusy(true);
    try {
      toast.result(await repo.refund(t.id, refundMinor, reason), "Refund issued");
      setRefundOpen(false);
    } catch (e) {
      toast.error("Refund failed", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const doCapture = async () => {
    if (!repo) return;
    setBusy(true);
    try {
      toast.result(await repo.capture(t.id), "Payment captured");
      setCaptureOpen(false);
    } catch (e) {
      toast.error("Capture failed", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const createExpense = async () => {
    if (!repo) return;
    try {
      await repo.create("expenses", { source: "manual", name: t.description || `PayPal purchase — ${t.customerName}`, amount: t.gross, currency: t.currency, date: dateKey(t.date, tz), category: "Other", vendor: t.customerName, taxAmount: 0, taxDeductible: true, paymentSource: "paypal", linkedTransactionId: t.id, archivedAt: null } as any);
      toast.success("Expense created", "Linked to this transaction so it's only counted once.");
    } catch (e) {
      toast.error("Couldn't create expense", errorMessage(e));
    }
  };

  const R = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <div className="flex justify-between gap-4 py-2 text-sm border-b border-line/60 last:border-0">
      <span className="text-muted">{k}</span>
      <span className="text-right min-w-0 break-all">{children}</span>
    </div>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      title={formatMoney(t.gross, t.currency)}
      subtitle={<span className="inline-flex items-center gap-2"><StatusBadge status={t.status} /> {t.customerName} · {formatDate(t.date, tz, true)}</span>}
      footer={
        <>
          {t.type === "purchase" && !linkedExpense && can("expenses.edit") && <Button icon={<Receipt className="size-4" />} onClick={createExpense}>Record as expense</Button>}
          {t.status === "authorized" && can("transactions.capture") && <Button variant="primary" icon={<HandCoins className="size-4" />} onClick={() => setCaptureOpen(true)}>{mode === "demo" ? "Simulate capture" : "Capture payment"}</Button>}
          {refundable && can("transactions.refund") && <Button variant="danger" icon={<Undo2 className="size-4" />} onClick={() => setRefundOpen(true)}>{mode === "demo" ? "Simulate refund" : "Issue refund"}</Button>}
        </>
      }
    >
      {mode === "demo" && <div className="mb-4 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs text-amber-200/90"><FlaskConical className="size-4 shrink-0" />Sample transaction. Refunds and captures here are simulations on demo data — no PayPal call is made.</div>}
      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-faint mb-1">Details</h3>
        <R k="Transaction ID"><span className="font-mono text-xs">{t.externalId ?? t.id}</span></R>
        <R k="Type">{titleCase(t.type)}</R>
        <R k="Customer">{t.customerId ? <Link to={`/customers/${t.customerId}`} className="text-accent-strong hover:underline">{t.customerName}</Link> : t.customerName}{t.customerEmail && <div className="text-xs text-muted">{t.customerEmail}</div>}</R>
        <R k="Description">{t.description || "—"}</R>
        <R k="Payment source">{titleCase(t.paymentMethod)}</R>
        <R k="Data source">{t.source === "paypal" ? <Badge tone="blue">PayPal {t.environment}</Badge> : t.source === "demo" ? <Badge tone="amber">Sample</Badge> : <Badge>Manual</Badge>}</R>
        {inv && <R k="Related invoice"><Link to={`/invoices?open=${inv.id}`} className="text-accent-strong hover:underline">{inv.number}</Link></R>}
        {t.failureReason && <R k="Failure reason"><span className="text-rose-300">{t.failureReason}</span></R>}
        {t.authorizationExpiresAt && <R k="Authorization expires">{formatDate(t.authorizationExpiresAt, tz, true)}</R>}
        {linkedExpense && <R k="Linked expense"><Link to="/expenses" className="text-accent-strong hover:underline">{linkedExpense.name}</Link></R>}
      </section>
      <section className="mt-6">
        <h3 className="text-xs font-medium uppercase tracking-wide text-faint mb-1">Amounts ({t.currency}, original)</h3>
        <R k="Gross"><Money amount={t.gross} currency={t.currency} /></R>
        <R k="Processing fee">{t.fee ? <Money amount={-t.fee} currency={t.currency} /> : "—"}</R>
        <R k="Refunded">{t.refundedAmount ? <Money amount={-t.refundedAmount} currency={t.currency} /> : "—"}</R>
        <R k="Net"><Money amount={t.net - t.refundedAmount} currency={t.currency} className="font-semibold" /></R>
      </section>
      {t.currency !== rc && (
        <section className="mt-6">
          <h3 className="text-xs font-medium uppercase tracking-wide text-faint mb-1">Reporting currency ({rc})</h3>
          {t.reporting ? (
            <>
              <R k="Converted gross"><Money amount={t.reporting.gross} currency={rc} /></R>
              <R k="Converted net"><Money amount={t.reporting.net} currency={rc} /></R>
              <R k="Exchange rate">1 {t.currency} = {t.reporting.rate.toFixed(5)} {rc}</R>
              <R k="Rate date">{t.reporting.rateTimestamp}</R>
              <R k="Provider">{t.reporting.provider}</R>
              <R k="Status">{t.reporting.estimated ? <Badge tone="amber">Estimated conversion</Badge> : <Badge tone="green">Historical rate</Badge>}</R>
            </>
          ) : <p className="text-sm text-muted py-2">No exchange rate available yet — excluded from converted totals.</p>}
        </section>
      )}
      {t.refunds.length > 0 && (
        <section className="mt-6">
          <h3 className="text-xs font-medium uppercase tracking-wide text-faint mb-1">Refunds</h3>
          {t.refunds.map((r) => <R key={r.id} k={formatDate(r.date, tz, true)}><Money amount={-r.amount} currency={t.currency} /><div className="text-xs text-muted">{r.reason}</div></R>)}
        </section>
      )}
      {t.source === "paypal" && t.externalId && (
        <a href={`https://www.${t.environment === "sandbox" ? "sandbox." : ""}paypal.com/activity/payment/${encodeURIComponent(t.externalId)}`} target="_blank" rel="noreferrer noopener" className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg"><ExternalLink className="size-3.5" />View in PayPal</a>
      )}

      <Dialog
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        title={mode === "demo" ? "Simulate a refund" : "Issue a refund"}
        description={mode === "demo" ? "Demo Mode: this only changes sample data." : `This sends money back to ${t.customerName} through PayPal ${t.environment ?? ""}. It can't be undone.`}
        size="sm"
        footer={<><Button variant="ghost" onClick={() => setRefundOpen(false)}>Cancel</Button><Button variant="danger" loading={busy} disabled={!refundValid} onClick={doRefund}>{mode === "demo" ? "Simulate refund" : `Refund ${refundValid ? formatMoney(refundMinor, t.currency) : ""}`}</Button></>}
      >
        <div className="space-y-4">
          <Field label={`Amount (${t.currency})`} hint={`Up to ${formatMoney(t.gross - t.refundedAmount, t.currency)} remaining`} error={amount && !refundValid ? "Enter an amount within the refundable balance" : null}>{(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} />}</Field>
          <p className="text-xs text-faint">PayPal may not return the original processing fee on refunds.</p>
        </div>
      </Dialog>
      <ConfirmDialog open={captureOpen} onClose={() => setCaptureOpen(false)} onConfirm={doCapture} loading={busy} title={mode === "demo" ? "Simulate capture?" : `Capture ${formatMoney(t.gross, t.currency)}?`} description={mode === "demo" ? "Demo Mode: this only changes sample data." : "This collects the authorized funds from the payer through PayPal."} confirmLabel={mode === "demo" ? "Simulate capture" : "Capture"} />
    </Drawer>
  );
}

function SimulatePayment() {
  const { repo, org } = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!repo?.simulatePayment) return null;
  return (
    <Button
      variant="outline"
      className="border-amber-500/30 text-amber-200"
      icon={<Zap className="size-4" />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const tx = await repo.simulatePayment!();
          toast.demo("Simulated payment received", `${formatMoney(tx.gross, tx.currency)} from ${tx.customerName}. Matching automations ran.`);
        } finally {
          setBusy(false);
        }
      }}
      title={`Adds a sample payment to ${org?.name ?? "the demo"} and runs matching automations`}
    >
      Simulate payment
    </Button>
  );
}
