import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Download, Paperclip, Pencil, Archive, FileText, Upload, Link2, FlaskConical } from "lucide-react";
import { useActive, useCollection, useWorkspace } from "@/context/WorkspaceContext";
import { PageHeader, Stat } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, SearchInput, Textarea, Checkbox } from "@/components/ui/Form";
import { DateRangeControl, useRange } from "@/components/ui/Filters";
import { DataTable, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { DualMoney, Money } from "@/components/ui/Money";
import { Dialog, ConfirmDialog } from "@/components/ui/Dialog";
import { SkeletonRows, EmptyState, ErrorState } from "@/components/ui/Feedback";
import { DonutChart } from "@/components/ui/Charts";
import { useToast } from "@/components/ui/Toast";
import { expenseByCategory } from "@shared/analytics";
import { formatMoney, parseMoneyInput, toMajor, SUPPORTED_CURRENCIES } from "@shared/money";
import { formatDate, todayKey } from "@shared/dates";
import { validateUpload } from "@shared/files";
import type { Expense, ExpensePaymentSource } from "@shared/types";
import { EXPENSE_CATEGORIES } from "@/lib/defaults";
import { downloadCsv } from "@/lib/csv";
import { bytes, errorMessage } from "@/lib/utils";

export default function Expenses() {
  const { org, can, repo, mode } = useWorkspace();
  const { rows, loading, error } = useActive("expenses");
  const files = useCollection("files").rows;
  const toast = useToast();
  const tz = org?.timezone ?? "UTC";
  const rc = org?.reportingCurrency ?? "USD";
  const { state, setState, range } = useRange(tz, "90d");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Expense | null | "new">(params.get("new") === "1" ? "new" : null);
  const [archiving, setArchiving] = useState<Expense | null>(null);
  useEffect(() => { if (params.get("new") === "1") setEditing("new"); }, [params]);

  const inRange = useMemo(() => rows.filter((e) => e.date >= range.from && e.date <= range.to), [rows, range]);
  const filtered = useMemo(() => inRange.filter((e) => (category === "all" || e.category === category) && (!q || [e.name, e.vendor, e.description ?? ""].some((x) => x.toLowerCase().includes(q.toLowerCase())))), [inRange, category, q]);
  const byCat = useMemo(() => (org ? expenseByCategory({ org, expenses: rows } as any, range) : []), [org, rows, range]);
  const total = byCat.reduce((a, c) => a + c.amount, 0);
  const tax = inRange.filter((e) => e.currency === rc).reduce((a, e) => a + e.taxAmount, 0);
  const deductible = inRange.filter((e) => e.taxDeductible && e.currency === rc).reduce((a, e) => a + e.amount, 0);
  const cats = [...new Set([...EXPENSE_CATEGORIES, ...rows.map((e) => e.category)])].sort();

  const viewReceipt = async (fileId: string) => {
    try {
      const url = await repo!.getFileUrl(fileId);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else toast.info("Sample receipt", "Demo receipts are metadata only — there's no file to open.");
    } catch (e) {
      toast.error("Couldn't open receipt", errorMessage(e));
    }
  };

  const cols: Column<Expense>[] = [
    { key: "date", header: "Date", cell: (e) => <span className="text-muted">{formatDate(e.date, tz)}</span>, sort: (e) => e.date },
    { key: "name", header: "Expense", cell: (e) => <div className="max-w-[260px]"><div className="truncate">{e.name}</div><div className="text-xs text-muted truncate">{e.vendor}</div></div>, sort: (e) => e.name },
    { key: "cat", header: "Category", cell: (e) => <Badge>{e.category}</Badge>, sort: (e) => e.category, hideBelow: "md" },
    { key: "src", header: "Paid with", cell: (e) => <span className="text-muted inline-flex items-center gap-1">{e.paymentSource}{e.linkedTransactionId && <Link2 className="size-3 text-sky-300" aria-label="Linked to PayPal transaction" />}</span>, hideBelow: "lg" },
    { key: "receipt", header: "", cell: (e) => (e.receiptFileId ? <button onClick={(ev) => { ev.stopPropagation(); viewReceipt(e.receiptFileId!); }} className="p-1 text-muted hover:text-fg" aria-label="View receipt" title={files.find((f) => f.id === e.receiptFileId)?.name}><Paperclip className="size-4" /></button> : null), className: "w-8" },
    { key: "amount", header: "Amount", align: "right", cell: (e) => <DualMoney amount={e.amount} currency={e.currency} reportingAmount={e.reporting?.amount} reportingCurrency={rc} estimated={e.reporting?.estimated} />, sort: (e) => e.reporting?.amount ?? e.amount },
    {
      key: "act",
      header: "",
      cell: (e) =>
        can("expenses.edit") ? (
          <span className="flex gap-0.5 justify-end">
            <button onClick={(ev) => { ev.stopPropagation(); setEditing(e); }} className="p-1.5 rounded-md text-muted hover:text-fg hover:bg-surface-3" aria-label="Edit"><Pencil className="size-3.5" /></button>
            <button onClick={(ev) => { ev.stopPropagation(); setArchiving(e); }} className="p-1.5 rounded-md text-muted hover:text-rose-300 hover:bg-surface-3" aria-label="Archive"><Archive className="size-3.5" /></button>
          </span>
        ) : null,
      className: "w-20",
    },
  ];

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Manual and PayPal-related expenses. Expenses linked to a PayPal purchase are counted once — never twice."
        actions={
          <>
            <DateRangeControl state={state} onChange={setState} tz={tz} />
            <Button icon={<Download className="size-4" />} disabled={!filtered.length} onClick={() => downloadCsv(`expenses-${range.from}-to-${range.to}.csv`, filtered.map((e) => ({ date: e.date, name: e.name, vendor: e.vendor, category: e.category, currency: e.currency, amount: toMajor(e.amount, e.currency), tax: toMajor(e.taxAmount, e.currency), tax_deductible: e.taxDeductible ? "yes" : "no", reporting_currency: rc, reporting_amount: e.currency === rc ? toMajor(e.amount, rc) : e.reporting ? toMajor(e.reporting.amount, rc) : "", fx_estimated: e.reporting?.estimated ? "yes" : "no", payment_source: e.paymentSource, linked_paypal_transaction: e.linkedTransactionId ?? "", receipt: e.receiptFileId ? "yes" : "no", notes: e.notes ?? "" })))}>Export report</Button>
            {can("expenses.edit") && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Add expense</Button>}
          </>
        }
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label={`Total expenses (${rc})`} value={formatMoney(total, rc)} sub={`${inRange.length} records`} />
        <Stat label="Tax paid (recorded)" value={formatMoney(tax, rc)} sub={`${rc} records only`} />
        <Stat label="Marked deductible" value={formatMoney(deductible, rc)} sub="Confirm with your accountant" />
        <Stat label="With receipts" value={`${inRange.filter((e) => e.receiptFileId).length}/${inRange.length}`} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <div className="flex flex-col sm:flex-row gap-2 p-4 border-b border-line">
            <SearchInput value={q} onChange={setQ} className="sm:w-72" />
            <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="sm:w-48"><option value="all">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</Select>
          </div>
          {error ? <ErrorState error={error} /> : loading ? <SkeletonRows /> : <DataTable rows={filtered} columns={cols} rowKey={(e) => e.id} onRowClick={can("expenses.edit") ? (e) => setEditing(e) : undefined} initialSort={{ key: "date", dir: "desc" }} empty={<EmptyState title="No expenses in this period" action={can("expenses.edit") && <Button size="sm" onClick={() => setEditing("new")}>Add expense</Button>} />} />}
        </Card>
        <Card className="h-fit">
          <CardHeader title="By category" subtitle={`${formatDate(range.from, tz)} – ${formatDate(range.to, tz)}`} />
          <CardBody>{byCat.length ? <DonutChart data={byCat.map((c) => ({ label: c.category, value: c.amount }))} currency={rc} height={180} stacked /> : <p className="text-sm text-muted">No data.</p>}</CardBody>
        </Card>
      </div>
      <ExpenseForm open={editing !== null} expense={editing === "new" ? null : editing} onClose={() => { setEditing(null); if (params.get("new")) setParams({}, { replace: true }); }} />
      <ConfirmDialog
        open={!!archiving}
        onClose={() => setArchiving(null)}
        danger
        title="Archive this expense?"
        description={`“${archiving?.name}” will be removed from reports. Archived records are kept for audit${mode === "demo" ? " (demo data)" : ""}.`}
        confirmLabel="Archive"
        onConfirm={async () => {
          try {
            await repo!.archive("expenses", archiving!.id);
            toast.success("Expense archived");
          } catch (e) {
            toast.error("Couldn't archive", errorMessage(e));
          }
          setArchiving(null);
        }}
      />
    </div>
  );
}

function ExpenseForm({ open, onClose, expense }: { open: boolean; onClose: () => void; expense: Expense | null }) {
  const { org, repo, mode, can, setDirty } = useWorkspace();
  const files = useCollection("files").rows;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const tz = org?.timezone ?? "UTC";
  const blank = () => ({
    name: expense?.name ?? "",
    vendor: expense?.vendor ?? "",
    amount: expense ? toMajor(expense.amount, expense.currency).toFixed(2) : "",
    currency: expense?.currency ?? org?.reportingCurrency ?? "USD",
    date: expense?.date ?? todayKey(tz),
    category: expense?.category ?? "Other",
    description: expense?.description ?? "",
    taxAmount: expense ? toMajor(expense.taxAmount, expense.currency).toFixed(2) : "0.00",
    taxDeductible: expense?.taxDeductible ?? true,
    paymentSource: (expense?.paymentSource ?? "card") as ExpensePaymentSource,
    notes: expense?.notes ?? "",
    receiptFileId: expense?.receiptFileId,
  });
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  useEffect(() => { if (open) { setF(blank()); setTouched(false); setFileError(null); } }, [open, expense?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDirty("expense-form", open && touched); return () => setDirty("expense-form", false); }, [open, touched, setDirty]);
  const upd = (p: Partial<typeof f>) => { setTouched(true); setF((s) => ({ ...s, ...p })); };
  const amount = parseMoneyInput(f.amount, f.currency);
  const taxAmount = parseMoneyInput(f.taxAmount || "0", f.currency);
  const errors = [!f.name.trim() && "Name is required", !(amount > 0) && "Enter a positive amount", (Number.isNaN(taxAmount) || taxAmount < 0 || taxAmount > amount) && "Tax must be between 0 and the amount", !f.date && "Date is required"].filter(Boolean) as string[];
  const receipt = files.find((x) => x.id === f.receiptFileId);

  const onFile = async (file: File) => {
    const err = validateUpload(file.name, file.type, file.size);
    setFileError(err);
    if (err || !repo) return;
    setUploading(true);
    try {
      const rec = await repo.uploadFile(file, "receipt", expense ? { type: "expense", id: expense.id } : undefined);
      upd({ receiptFileId: rec.id });
      toast[mode === "demo" ? "demo" : "success"]("Receipt attached", mode === "demo" ? "Demo: kept in this browser only." : "Stored privately in Backblaze B2.");
    } catch (e) {
      setFileError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!repo || errors.length) return;
    setBusy(true);
    const data = { name: f.name.trim(), vendor: f.vendor.trim(), amount, currency: f.currency, date: f.date, category: f.category, description: f.description, taxAmount, taxDeductible: f.taxDeductible, paymentSource: f.paymentSource, notes: f.notes, receiptFileId: f.receiptFileId };
    try {
      if (expense) await repo.update("expenses", expense.id, data);
      else await repo.create("expenses", { ...data, source: "manual", archivedAt: null } as any);
      toast.success(expense ? "Expense updated" : "Expense added", f.currency !== org?.reportingCurrency ? "Conversion to the reporting currency is applied by the exchange-rate service." : undefined);
      setTouched(false);
      onClose();
    } catch (e) {
      toast.error("Couldn't save expense", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={expense ? "Edit expense" : "Add expense"} footer={<>{touched && errors[0] && <p className="text-xs text-rose-300 sm:mr-auto self-center">{errors[0]}</p>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={errors.length > 0 || uploading} onClick={save}>{expense ? "Save" : "Add expense"}</Button></>}>
      {expense?.linkedTransactionId && <div className="mb-4 flex gap-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.05] p-3 text-xs text-sky-200/90"><Link2 className="size-4 shrink-0" />Linked to a PayPal purchase transaction. It's counted here as an expense only.</div>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Expense name" required className="sm:col-span-2">{(id) => <Input id={id} value={f.name} onChange={(e) => upd({ name: e.target.value })} maxLength={120} />}</Field>
        <Field label="Vendor">{(id) => <Input id={id} value={f.vendor} onChange={(e) => upd({ vendor: e.target.value })} maxLength={120} />}</Field>
        <Field label="Amount" required>{(id) => <Input id={id} inputMode="decimal" value={f.amount} onChange={(e) => upd({ amount: e.target.value })} placeholder="0.00" />}</Field>
        <Field label="Currency">{(id) => <Select id={id} value={f.currency} onChange={(e) => upd({ currency: e.target.value })}>{SUPPORTED_CURRENCIES.map((c) => <option key={c.code}>{c.code}</option>)}</Select>}</Field>
        <Field label="Date" required>{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => upd({ date: e.target.value })} />}</Field>
        <Field label="Category">{(id) => <Select id={id} value={f.category} onChange={(e) => upd({ category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        <Field label="Payment source">{(id) => <Select id={id} value={f.paymentSource} onChange={(e) => upd({ paymentSource: e.target.value as ExpensePaymentSource })}>{["card", "bank", "cash", "paypal", "manual"].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</Select>}</Field>
        <Field label="Tax amount">{(id) => <Input id={id} inputMode="decimal" value={f.taxAmount} onChange={(e) => upd({ taxAmount: e.target.value })} />}</Field>
        <Field label="Description" className="sm:col-span-3">{(id) => <Input id={id} value={f.description} onChange={(e) => upd({ description: e.target.value })} maxLength={300} />}</Field>
        <Field label="Notes" className="sm:col-span-3">{(id) => <Textarea id={id} value={f.notes} onChange={(e) => upd({ notes: e.target.value })} maxLength={1000} className="min-h-16" />}</Field>
        <div className="sm:col-span-3"><Checkbox checked={f.taxDeductible} onChange={(v) => upd({ taxDeductible: v })} label="Potentially tax-deductible" description="A bookkeeping flag only — not tax advice." /></div>
      </div>
      <div className="mt-5 rounded-xl border border-dashed border-line-strong p-4">
        <div className="flex items-center gap-3">
          <div className="grid grid-cols-1 place-items-center size-9 rounded-lg bg-surface-2 text-muted"><FileText className="size-4" /></div>
          <div className="min-w-0 flex-1 text-sm">
            {receipt ? <><div className="truncate">{receipt.name}</div><div className="text-xs text-muted">{bytes(receipt.size)}{receipt.isSample && " · sample"}</div></> : <><div>Receipt</div><div className="text-xs text-muted">PDF, PNG, JPG, WEBP or HEIC · max 8 MB · stored privately</div></>}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          {can("files.upload") && <Button size="sm" icon={<Upload className="size-3.5" />} loading={uploading} onClick={() => fileRef.current?.click()}>{receipt ? "Replace" : "Upload"}</Button>}
        </div>
        {fileError && <p className="mt-2 text-xs text-rose-300">{fileError}</p>}
        {mode === "demo" && <p className="mt-2 text-[11px] text-amber-300/80 inline-flex items-center gap-1"><FlaskConical className="size-3" />Demo uploads stay in this browser and are never sent to Backblaze.</p>}
      </div>
      {f.currency !== org?.reportingCurrency && amount > 0 && <p className="mt-3 text-xs text-faint">Original: {formatMoney(amount, f.currency)}. Converted to {org?.reportingCurrency} using the rate for {f.date}; marked as estimated if no rate exists yet.</p>}
      {expense && <p className="mt-2"><Money amount={expense.amount} currency={expense.currency} muted className="text-xs" /></p>}
    </Dialog>
  );
}
