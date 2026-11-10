import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Copy, Check, Link2, Ban, RotateCcw, FlaskConical, Eye, ShieldCheck } from "lucide-react";
import { useActive, useWorkspace } from "@/context/WorkspaceContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, SearchInput } from "@/components/ui/Form";
import { DataTable, type Column } from "@/components/ui/Table";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { Dialog, Drawer, ConfirmDialog } from "@/components/ui/Dialog";
import { SkeletonRows, EmptyState, ErrorState } from "@/components/ui/Feedback";
import { PayPalBanner } from "@/components/layout/AppShell";
import { useToast } from "@/components/ui/Toast";
import type { PaymentLink } from "@shared/types";
import { formatMoney, parseMoneyInput, SUPPORTED_CURRENCIES } from "@shared/money";
import { formatDate } from "@shared/dates";
import { errorMessage } from "@/lib/utils";

export default function PaymentLinks() {
  const { org, can, mode, paypalState } = useWorkspace();
  const { rows, loading, error } = useActive("paymentLinks");
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(params.get("new") === "1");
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const tz = org?.timezone ?? "UTC";
  useEffect(() => { if (params.get("new") === "1") setCreateOpen(true); }, [params]);

  const filtered = useMemo(() => rows.filter((l) => (status === "all" || l.status === status) && (!q || [l.description, l.customerName ?? ""].some((x) => x.toLowerCase().includes(q.toLowerCase())))), [rows, q, status]);
  const cols: Column<PaymentLink>[] = [
    { key: "desc", header: "Description", cell: (l) => <div className="max-w-[280px]"><div className="truncate inline-flex items-center gap-1.5">{l.description}{l.isSample && <Badge tone="amber">Sample</Badge>}</div><div className="text-xs text-muted truncate">{l.customerName ?? "Any payer"}</div></div>, sort: (l) => l.description },
    { key: "status", header: "Status", cell: (l) => <StatusBadge status={l.status} /> },
    { key: "created", header: "Created", cell: (l) => <span className="text-muted">{formatDate(l.createdAt, tz)}</span>, sort: (l) => l.createdAt, hideBelow: "md" },
    { key: "expires", header: "Expires", cell: (l) => <span className="text-muted">{l.expiresAt ? formatDate(l.expiresAt, tz) : "Never"}</span>, hideBelow: "lg" },
    { key: "views", header: "Views", align: "right", cell: (l) => l.views, sort: (l) => l.views, hideBelow: "sm" },
    { key: "amount", header: "Amount", align: "right", cell: (l) => <Money amount={l.amount} currency={l.currency} />, sort: (l) => l.amount },
    { key: "copy", header: "", cell: (l) => <CopyButton text={l.url} />, className: "w-10" },
  ];
  const open = rows.find((l) => l.id === openId) ?? null;
  const blocked = mode === "real" && paypalState === "not_connected";
  return (
    <div>
      <PageHeader
        title="Payment Links"
        description={mode === "demo" ? "Sample links for exploring the flow. They point to a non-functional demo address and cannot accept money." : "Shareable links that open PayPal Checkout for a fixed amount."}
        actions={can("paymentLinks.create") && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)} disabled={blocked} title={blocked ? "Connect PayPal first" : undefined}>Create link</Button>}
      />
      <PayPalBanner />
      <Card>
        <div className="flex flex-col sm:flex-row gap-2 p-4 border-b border-line">
          <SearchInput value={q} onChange={setQ} className="sm:w-72" />
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-44"><option value="all">All statuses</option>{["active", "paid", "expired", "disabled"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</Select>
        </div>
        {error ? <ErrorState error={error} /> : loading ? <SkeletonRows /> : <DataTable rows={filtered} columns={cols} rowKey={(l) => l.id} onRowClick={(l) => setOpenId(l.id)} initialSort={{ key: "created", dir: "desc" }} empty={<EmptyState icon={<Link2 className="size-5" />} title="No payment links" description="Create a link and share it by email or chat — payers check out with PayPal." />} />}
      </Card>
      <CreateLink open={createOpen} onClose={() => { setCreateOpen(false); if (params.get("new")) setParams({}, { replace: true }); }} />
      {open && <LinkDrawer link={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); });
      }}
      className="p-1.5 rounded-md text-muted hover:text-fg hover:bg-surface-3"
      aria-label="Copy link"
      title="Copy link"
    >
      {done ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
    </button>
  );
}

function CreateLink({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { org, repo, mode, paypalState } = useWorkspace();
  const customers = useActive("customers").rows;
  const toast = useToast();
  const [f, setF] = useState({ description: "", amount: "", currency: org?.reportingCurrency ?? "USD", customerId: "", expires: "" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ description: "", amount: "", currency: org?.reportingCurrency ?? "USD", customerId: "", expires: "" }); }, [open, org]);
  const minor = parseMoneyInput(f.amount, f.currency);
  const valid = f.description.trim().length >= 2 && minor > 0 && minor <= 1_000_000_00;
  const create = async () => {
    if (!repo) return;
    setBusy(true);
    try {
      const l = await repo.createPaymentLink({ description: f.description.trim(), amount: minor, currency: f.currency, customerId: f.customerId || undefined, expiresAt: f.expires ? new Date(`${f.expires}T23:59:59`).toISOString() : undefined });
      await navigator.clipboard?.writeText(l.url).catch(() => undefined);
      toast[mode === "demo" ? "demo" : "success"](mode === "demo" ? "Sample link created" : "Payment link created", `${l.url} — copied to clipboard`);
      setConfirm(false);
      onClose();
    } catch (e) {
      toast.error("Couldn't create link", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog open={open && !confirm} onClose={onClose} title="Create payment link" size="md" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} onClick={() => setConfirm(true)}>Review</Button></>}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Description" required className="sm:col-span-3" hint="Shown to the payer at checkout">{(id) => <Input id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={127} placeholder="e.g. Workshop deposit" />}</Field>
          <Field label="Amount" required className="sm:col-span-2">{(id) => <Input id={id} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" />}</Field>
          <Field label="Currency">{(id) => <Select id={id} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{SUPPORTED_CURRENCIES.map((c) => <option key={c.code}>{c.code}</option>)}</Select>}</Field>
          <Field label="Customer (optional)" className="sm:col-span-2">{(id) => <Select id={id} value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">Any payer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Expires (optional)">{(id) => <Input id={id} type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} />}</Field>
        </div>
      </Dialog>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={create} loading={busy} title={`Create a ${valid ? formatMoney(minor, f.currency) : ""} payment link?`} description={mode === "demo" ? "Demo Mode: creates a clearly marked sample link that can't accept payments." : `Creates a shareable link that opens PayPal ${paypalState === "live" ? "Live" : "Sandbox"} Checkout. Anyone with the link can pay it.`} confirmLabel={mode === "demo" ? "Create sample link" : "Create link"}>
        <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm space-y-1">
          <div><span className="text-muted">Description:</span> {f.description}</div>
          <div><span className="text-muted">Amount:</span> {valid ? formatMoney(minor, f.currency) : "—"}</div>
          {f.customerId && <div><span className="text-muted">Customer:</span> {customers.find((c) => c.id === f.customerId)?.name}</div>}
          {f.expires && <div><span className="text-muted">Expires:</span> {f.expires}</div>}
        </div>
      </ConfirmDialog>
    </>
  );
}

function LinkDrawer({ link, onClose }: { link: PaymentLink; onClose: () => void }) {
  const { org, repo, can } = useWorkspace();
  const toast = useToast();
  const tz = org?.timezone ?? "UTC";
  const toggle = async () => {
    try {
      await repo!.setPaymentLinkStatus(link.id, link.status === "disabled" ? "active" : "disabled");
      toast.success(link.status === "disabled" ? "Link re-enabled" : "Link disabled");
    } catch (e) {
      toast.error("Couldn't update link", errorMessage(e));
    }
  };
  return (
    <Drawer open onClose={onClose} title={link.description} subtitle={<span className="inline-flex items-center gap-2"><StatusBadge status={link.status} />{formatMoney(link.amount, link.currency)}</span>} footer={can("paymentLinks.create") && (link.status === "active" || link.status === "disabled") && <Button icon={link.status === "disabled" ? <RotateCcw className="size-4" /> : <Ban className="size-4" />} onClick={toggle}>{link.status === "disabled" ? "Re-enable" : "Disable link"}</Button>}>
      {link.isSample ? (
        <div className="mb-4 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs text-amber-200/90"><FlaskConical className="size-4 shrink-0" />Sample link. The address below is not a real checkout and cannot accept payments.</div>
      ) : (
        <div className="mb-4 flex gap-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.05] p-3 text-xs text-sky-200/90"><ShieldCheck className="size-4 shrink-0" />Payers complete checkout on PayPal ({link.environment}). PayPilot records the payment when PayPal confirms the capture.</div>
      )}
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2.5">
        <code className="flex-1 truncate text-xs font-mono">{link.url}</code>
        <CopyButton text={link.url} />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-xs text-muted">Customer</dt><dd>{link.customerName ?? "Any payer"}</dd></div>
        <div><dt className="text-xs text-muted">Created</dt><dd>{formatDate(link.createdAt, tz, true)}</dd></div>
        <div><dt className="text-xs text-muted">Expires</dt><dd>{link.expiresAt ? formatDate(link.expiresAt, tz, true) : "Never"}</dd></div>
        <div><dt className="text-xs text-muted">Views</dt><dd className="inline-flex items-center gap-1"><Eye className="size-3.5 text-muted" />{link.views}</dd></div>
      </dl>
      <h3 className="mt-6 mb-2 text-xs font-medium uppercase tracking-wide text-faint">Activity</h3>
      <ol className="relative border-l border-line ml-1.5 space-y-3">
        {[...link.activity].reverse().map((a, i) => (
          <li key={i} className="pl-4 text-sm"><span className="absolute -left-[4.5px] mt-1.5 size-2 rounded-full bg-line-strong" /><div>{a.event}</div><div className="text-xs text-faint">{formatDate(a.at, tz, true)}{a.detail ? ` · ${a.detail}` : ""}</div></li>
        ))}
      </ol>
    </Drawer>
  );
}
