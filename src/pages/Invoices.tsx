import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Plus, Download, Send, Pencil, Ban, FileDown, HandCoins, Bell, FlaskConical, Copy, Bot } from "lucide-react";
import { useActive, useCollection, useWorkspace } from "@/context/WorkspaceContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { SearchInput, Field, Input, Select } from "@/components/ui/Form";
import { DataTable, type Column } from "@/components/ui/Table";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { Drawer, ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { SkeletonRows, EmptyState, ErrorState } from "@/components/ui/Feedback";
import { PayPalBanner } from "@/components/layout/AppShell";
import { useToast } from "@/components/ui/Toast";
import { InvoiceEditor } from "./invoices/InvoiceEditor";
import type { Invoice } from "@shared/types";
import { computeInvoiceTotals, deriveInvoiceStatus, formatMoney, lineAmount, parseMoneyInput, toMajor } from "@shared/money";
import { diffDays, formatDate, todayKey } from "@shared/dates";
import { invoicePdf } from "@/lib/pdf";
import { downloadCsv } from "@/lib/csv";
import { errorMessage, uid } from "@/lib/utils";

type Tab = "all" | "draft" | "sent" | "overdue" | "paid" | "cancelled";

export default function Invoices() {
  const { org, can } = useWorkspace();
  const { rows: all, loading, error } = useCollection("invoices");
  const rows = useMemo(() => all.filter((i) => !i.archivedAt), [all]);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [params, setParams] = useSearchParams();
  const [editorOpen, setEditorOpen] = useState(params.get("new") === "1");
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get("open"));
  const tz = org?.timezone ?? "UTC";

  useEffect(() => {
    if (params.get("open")) setOpenId(params.get("open"));
    if (params.get("new") === "1") setEditorOpen(true);
  }, [params]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: rows.length, draft: 0, sent: 0, overdue: 0, paid: 0, cancelled: 0 };
    for (const i of rows) {
      if (i.status === "draft") c.draft++;
      else if (i.status === "sent" || i.status === "partially_paid") c.sent++;
      else if (i.status === "overdue") c.overdue++;
      else if (i.status === "paid") c.paid++;
      else if (i.status === "cancelled") c.cancelled++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((i) => {
      if (tab === "sent" && !(i.status === "sent" || i.status === "partially_paid")) return false;
      if (tab !== "all" && tab !== "sent" && i.status !== tab) return false;
      return !s || [i.number, i.customerName, i.customerEmail].some((x) => x.toLowerCase().includes(s));
    });
  }, [rows, tab, q]);

  const cols: Column<Invoice>[] = [
    { key: "number", header: "Invoice", cell: (i) => <span className="font-medium inline-flex items-center gap-1.5">{i.number}{i.createdByAi && <Bot className="size-3.5 text-accent" aria-label="Drafted by AI" />}</span>, sort: (i) => i.number },
    { key: "customer", header: "Customer", cell: (i) => <div><div className="truncate max-w-[220px]">{i.customerName}</div><div className="text-xs text-muted truncate max-w-[220px]">{i.customerEmail}</div></div>, sort: (i) => i.customerName },
    { key: "status", header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
    { key: "issue", header: "Issued", cell: (i) => <span className="text-muted">{formatDate(i.issueDate, tz)}</span>, sort: (i) => i.issueDate, hideBelow: "md" },
    { key: "due", header: "Due", cell: (i) => <span className={i.status === "overdue" ? "text-rose-300" : "text-muted"}>{formatDate(i.dueDate, tz)}</span>, sort: (i) => i.dueDate, hideBelow: "sm" },
    { key: "total", header: "Total", align: "right", cell: (i) => <Money amount={i.totals.total} currency={i.currency} />, sort: (i) => i.totals.total },
    { key: "balance", header: "Balance", align: "right", cell: (i) => (i.totals.balance && i.status !== "draft" && i.status !== "cancelled" ? <Money amount={i.totals.balance} currency={i.currency} /> : <span className="text-faint">—</span>), sort: (i) => i.totals.balance, hideBelow: "lg" },
  ];

  const open = rows.find((i) => i.id === openId) ?? null;
  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Create, send and track invoices. Drafts stay private until you send them."
        actions={
          <>
            <Button icon={<Download className="size-4" />} disabled={!filtered.length} onClick={() => downloadCsv("invoices.csv", filtered.map((i) => ({ number: i.number, customer: i.customerName, email: i.customerEmail, status: i.status, issue_date: i.issueDate, due_date: i.dueDate, currency: i.currency, subtotal: toMajor(i.totals.subtotal, i.currency), discount: toMajor(i.totals.discount, i.currency), tax: toMajor(i.totals.tax, i.currency), total: toMajor(i.totals.total, i.currency), paid: toMajor(i.totals.paid, i.currency), balance: toMajor(i.totals.balance, i.currency) })))}>Export</Button>
            {can("invoices.edit") && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => { setEditing(null); setEditorOpen(true); }}>New invoice</Button>}
          </>
        }
      />
      <PayPalBanner />
      <Card>
        <div className="px-4 pt-2">
          <Tabs value={tab} onChange={setTab} items={[{ id: "all", label: "All", count: counts.all }, { id: "draft", label: "Drafts", count: counts.draft }, { id: "sent", label: "Sent", count: counts.sent }, { id: "overdue", label: "Overdue", count: counts.overdue }, { id: "paid", label: "Paid", count: counts.paid }, { id: "cancelled", label: "Cancelled", count: counts.cancelled }]} />
        </div>
        <div className="p-4 border-b border-line"><SearchInput value={q} onChange={setQ} placeholder="Search number, customer or email…" className="sm:w-80" /></div>
        {error ? <ErrorState error={error} /> : loading ? <SkeletonRows /> : (
          <DataTable rows={filtered} columns={cols} rowKey={(i) => i.id} onRowClick={(i) => setOpenId(i.id)} initialSort={{ key: "issue", dir: "desc" }} empty={<EmptyState title={rows.length ? "No invoices match" : "No invoices yet"} description={rows.length ? undefined : "Create your first invoice — it starts as a private draft."} action={!rows.length && can("invoices.edit") ? <Button variant="primary" size="sm" onClick={() => setEditorOpen(true)}>Create invoice</Button> : undefined} />} />
        )}
      </Card>
      <InvoiceEditor open={editorOpen} invoice={editing} onClose={() => { setEditorOpen(false); setEditing(null); if (params.get("new")) setParams({}, { replace: true }); }} />
      {open && <InvoiceDrawer inv={open} onClose={() => { setOpenId(null); if (params.get("open")) setParams({}, { replace: true }); }} onEdit={() => { setEditing(open); setEditorOpen(true); }} />}
    </div>
  );
}

function InvoiceDrawer({ inv, onClose, onEdit }: { inv: Invoice; onClose: () => void; onEdit: () => void }) {
  const { org, repo, mode, can } = useWorkspace();
  const toast = useToast();
  const emailLogs = useCollection("emailLogs").rows.filter((e) => e.relatedId === inv.id);
  const txs = useActive("transactions").rows.filter((t) => t.invoiceId === inv.id);
  const tz = org?.timezone ?? "UTC";
  const [confirm, setConfirm] = useState<null | "send" | "cancel" | "remind">(null);
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = (v: number) => formatMoney(v, inv.currency);
  const today = todayKey(tz);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setConfirm(null);
    } catch (e) {
      toast.error("Action failed", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const send = () => run(async () => toast.result(await repo!.sendInvoice(inv.id), "Invoice sent"));
  const cancel = () => run(async () => {
    await repo!.update("invoices", inv.id, { status: "cancelled", history: [...inv.history, { at: new Date().toISOString(), event: "Invoice cancelled", by: "you" }] });
    toast.success("Invoice cancelled");
  });
  const remind = () => run(async () => {
    const days = Math.max(0, diffDays(today, inv.dueDate));
    toast.result(await repo!.sendEmail({ to: inv.customerEmail, toName: inv.customerName, template: "reminder", subject: `Reminder: invoice ${inv.number} (${m(inv.totals.balance)})`, body: `Hi ${inv.customerName.split(" ")[0]},\n\nThis is a friendly reminder that invoice ${inv.number} for ${m(inv.totals.balance)} ${days ? `is ${days} days overdue` : `is due on ${formatDate(inv.dueDate, tz)}`}.\n\nThank you,\n${org?.name}`, relatedType: "invoice", relatedId: inv.id }), "Reminder sent");
    await repo!.update("invoices", inv.id, { history: [...inv.history, { at: new Date().toISOString(), event: `Payment reminder ${mode === "demo" ? "simulated" : "sent"}`, by: "you" }] });
  });
  const open = inv.status !== "draft" && inv.status !== "cancelled" && inv.status !== "paid";

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${inv.number} · ${m(inv.totals.total)}`}
      subtitle={<span className="inline-flex items-center gap-2"><StatusBadge status={inv.status} />{inv.customerName}</span>}
      footer={
        <>
          <Button icon={<FileDown className="size-4" />} onClick={() => org && invoicePdf(inv, org, { sample: mode === "demo" })}>PDF</Button>
          {inv.status === "draft" && can("invoices.edit") && <Button icon={<Pencil className="size-4" />} onClick={onEdit}>Edit</Button>}
          {open && can("invoices.edit") && <Button icon={<HandCoins className="size-4" />} onClick={() => setPayOpen(true)}>Record payment</Button>}
          {open && can("invoices.send") && <Button icon={<Bell className="size-4" />} onClick={() => setConfirm("remind")}>Remind</Button>}
          {(inv.status === "draft" || inv.status === "sent") && can("invoices.edit") && <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => setConfirm("cancel")}>Cancel</Button>}
          {inv.status === "draft" && can("invoices.send") && <Button variant="primary" icon={<Send className="size-4" />} onClick={() => setConfirm("send")}>Send</Button>}
        </>
      }
    >
      {mode === "demo" && <div className="mb-4 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs text-amber-200/90"><FlaskConical className="size-4 shrink-0" />Sample invoice. Sending and reminders are simulated — no email is delivered.</div>}
      {/* Preview */}
      <div className="rounded-xl bg-white text-[#14181a] p-5 text-sm shadow-inner">
        <div className="flex justify-between gap-4">
          <div><div className="font-semibold">{org?.name}</div><div className="text-xs text-gray-500">{org?.email}</div></div>
          <div className="text-right"><div className="text-lg font-bold tracking-tight">INVOICE</div><div className="text-xs text-gray-500">{inv.number}</div></div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
          <div><div className="text-gray-400 uppercase tracking-wide text-[10px]">Bill to</div><div className="font-medium">{inv.customerName}</div><div className="text-gray-500">{inv.customerEmail}</div></div>
          <div className="text-right"><div>Issued {formatDate(inv.issueDate, tz)}</div><div>Due {formatDate(inv.dueDate, tz)}</div><div className="text-gray-500">{inv.terms}</div></div>
        </div>
        <table className="mt-4 w-full text-xs">
          <thead><tr className="text-gray-400 border-b"><th className="text-left py-1.5 font-normal">Item</th><th className="text-right font-normal">Qty</th><th className="text-right font-normal">Price</th><th className="text-right font-normal">Amount</th></tr></thead>
          <tbody>{inv.lines.map((l) => <tr key={l.id} className="border-b border-gray-100"><td className="py-1.5">{l.description}{l.taxRate ? <span className="text-gray-400"> · tax {l.taxRate}%</span> : null}</td><td className="text-right tabular">{l.quantity}</td><td className="text-right tabular">{m(l.unitPrice)}</td><td className="text-right tabular">{m(lineAmount(l))}</td></tr>)}</tbody>
        </table>
        <div className="mt-3 ml-auto w-56 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="tabular">{m(inv.totals.subtotal)}</span></div>
          {inv.totals.discount > 0 && <div className="flex justify-between"><span className="text-gray-500">Discount</span><span className="tabular">−{m(inv.totals.discount)}</span></div>}
          <div className="flex justify-between"><span className="text-gray-500">Tax</span><span className="tabular">{m(inv.totals.tax)}</span></div>
          <div className="flex justify-between font-semibold text-sm border-t pt-1"><span>Total</span><span className="tabular">{m(inv.totals.total)}</span></div>
          {inv.totals.paid > 0 && <><div className="flex justify-between text-gray-500"><span>Paid</span><span className="tabular">−{m(inv.totals.paid)}</span></div><div className="flex justify-between font-semibold"><span>Balance due</span><span className="tabular">{m(inv.totals.balance)}</span></div></>}
        </div>
        {inv.notes && <p className="mt-4 text-xs text-gray-500 whitespace-pre-wrap">{inv.notes}</p>}
      </div>

      <section className="mt-6">
        <h3 className="text-xs font-medium uppercase tracking-wide text-faint mb-2">Payments</h3>
        {inv.payments.length ? (
          <ul className="space-y-1.5 text-sm">
            {inv.payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <span className="text-muted">{formatDate(p.date, tz)} · {p.method}{p.transactionId && txs.some((t) => t.id === p.transactionId) && <Link to={`/transactions?open=${p.transactionId}`} className="ml-1.5 text-accent-strong hover:underline">view</Link>}</span>
                <Money amount={p.amount} currency={inv.currency} />
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No payments recorded.</p>}
      </section>
      <section className="mt-6">
        <h3 className="text-xs font-medium uppercase tracking-wide text-faint mb-2">History</h3>
        <ol className="relative border-l border-line ml-1.5 space-y-3">
          {[...inv.history, ...emailLogs.map((e) => ({ at: e.createdAt, event: `Email “${e.subject}” — ${e.status}`, by: e.to }))].sort((a, b) => b.at.localeCompare(a.at)).map((h, i) => (
            <li key={i} className="pl-4 text-sm">
              <span className="absolute -left-[4.5px] mt-1.5 size-2 rounded-full bg-line-strong" />
              <div>{h.event}</div>
              <div className="text-xs text-faint">{formatDate(h.at, tz, true)} · {h.by}</div>
            </li>
          ))}
        </ol>
      </section>
      {inv.externalId && <p className="mt-6 text-xs text-faint inline-flex items-center gap-1.5"><Copy className="size-3" />PayPal invoice ID: <span className="font-mono">{inv.externalId}</span></p>}

      <ConfirmDialog open={confirm === "send"} onClose={() => setConfirm(null)} onConfirm={send} loading={busy} title={`Send ${inv.number} to ${inv.customerName}?`} description={mode === "demo" ? "Demo Mode: the invoice is marked as sent and a simulated email is logged. Nothing is delivered." : `Emails ${inv.customerEmail} via EmailJS${inv.externalId ? "" : " and, if PayPal invoicing is connected, creates the PayPal invoice"}. Total ${m(inv.totals.total)}.`} confirmLabel={mode === "demo" ? "Simulate send" : "Send invoice"} />
      <ConfirmDialog open={confirm === "remind"} onClose={() => setConfirm(null)} onConfirm={remind} loading={busy} title={`Send a payment reminder to ${inv.customerName}?`} description={mode === "demo" ? "Demo Mode: a simulated email is logged." : `Emails ${inv.customerEmail} about the ${m(inv.totals.balance)} balance.`} confirmLabel={mode === "demo" ? "Simulate reminder" : "Send reminder"} />
      <ConfirmDialog open={confirm === "cancel"} onClose={() => setConfirm(null)} onConfirm={cancel} loading={busy} danger title={`Cancel ${inv.number}?`} description="The invoice stays in your records as cancelled and can't be paid." confirmLabel="Cancel invoice" />
      <RecordPayment open={payOpen} onClose={() => setPayOpen(false)} inv={inv} />
    </Drawer>
  );
}

function RecordPayment({ open, onClose, inv }: { open: boolean; onClose: () => void; inv: Invoice }) {
  const { repo, org } = useWorkspace();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Bank transfer");
  const [busy, setBusy] = useState(false);
  useEffect(() => setAmount(toMajor(inv.totals.balance, inv.currency).toFixed(2)), [open, inv]);
  const minor = parseMoneyInput(amount, inv.currency);
  const valid = minor > 0 && minor <= inv.totals.balance;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Record a manual payment"
      description="For payments received outside PayPal (bank transfer, cash, check). PayPal payments are recorded automatically by sync."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={async () => {
              if (!repo || !org) return;
              setBusy(true);
              try {
                const payments = [...inv.payments, { id: uid("pay"), amount: minor, date: new Date().toISOString(), method }];
                const totals = computeInvoiceTotals({ ...inv, payments });
                await repo.update("invoices", inv.id, { payments, totals, status: deriveInvoiceStatus({ ...inv, totals }, todayKey(org.timezone)), history: [...inv.history, { at: new Date().toISOString(), event: `Manual payment recorded — ${formatMoney(minor, inv.currency)} (${method})`, by: "you" }] });
                toast.success("Payment recorded", formatMoney(minor, inv.currency));
                onClose();
              } catch (e) {
                toast.error("Couldn't record payment", errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Record payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={`Amount (${inv.currency})`} hint={`Balance ${formatMoney(inv.totals.balance, inv.currency)}`} error={amount && !valid ? "Must be positive and no more than the balance" : null}>{(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Method">{(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value)}>{["Bank transfer", "Cash", "Check", "Card (offline)", "Other"].map((x) => <option key={x}>{x}</option>)}</Select>}</Field>
        <Badge tone="neutral">Recorded as an internal record — no money moves</Badge>
      </div>
    </Dialog>
  );
}
