import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Invoice, InvoiceLine } from "@shared/types";
import { computeInvoiceTotals, formatMoney, parseMoneyInput, toMajor, SUPPORTED_CURRENCIES } from "@shared/money";
import { addDays, todayKey } from "@shared/dates";
import { useActive, useWorkspace } from "@/context/WorkspaceContext";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, uid } from "@/lib/utils";

interface LineDraft { id: string; productId?: string; description: string; quantity: string; unitPrice: string; taxRate: string }

export function InvoiceEditor({ open, onClose, invoice }: { open: boolean; onClose: () => void; invoice?: Invoice | null }) {
  const { org, repo, setDirty } = useWorkspace();
  const customers = useActive("customers").rows;
  const products = useActive("products").rows.filter((p) => p.active);
  const invoices = useActive("invoices").rows;
  const toast = useToast();
  const tz = org?.timezone ?? "UTC";
  const today = todayKey(tz);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [f, setF] = useState(() => init());

  function init() {
    const cur = invoice?.currency ?? org?.reportingCurrency ?? "USD";
    const terms = invoice?.paymentTermsDays ?? org?.settings.defaultPaymentTermsDays ?? 30;
    return {
      customerId: invoice?.customerId ?? "",
      currency: cur,
      issueDate: invoice?.issueDate ?? today,
      dueDate: invoice?.dueDate ?? addDays(today, terms),
      paymentTermsDays: String(terms),
      discountType: invoice?.discount.type ?? ("percent" as "percent" | "fixed"),
      discountValue: invoice ? (invoice.discount.type === "percent" ? String(invoice.discount.value) : toMajor(invoice.discount.value, cur).toFixed(2)) : "0",
      notes: invoice?.notes ?? "Thank you for your business!",
      terms: invoice?.terms ?? `Net ${terms}`,
      lines: (invoice?.lines ?? [{ id: uid("l"), description: "", quantity: 1, unitPrice: 0, taxRate: 0 }]).map<LineDraft>((l) => ({ id: l.id, productId: l.productId, description: l.description, quantity: String(l.quantity), unitPrice: toMajor(l.unitPrice, cur).toFixed(2), taxRate: String(l.taxRate) })),
    };
  }
  useEffect(() => {
    if (open) {
      setF(init());
      setTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice?.id]);
  useEffect(() => {
    setDirty("invoice-editor", open && touched);
    return () => setDirty("invoice-editor", false);
  }, [open, touched, setDirty]);

  const upd = (patch: Partial<typeof f>) => {
    setTouched(true);
    setF((s) => ({ ...s, ...patch }));
  };
  const updLine = (id: string, patch: Partial<LineDraft>) => upd({ lines: f.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  const parsed = useMemo(() => {
    const lines: InvoiceLine[] = f.lines.map((l) => ({ id: l.id, productId: l.productId, description: l.description.trim(), quantity: Number(l.quantity), unitPrice: parseMoneyInput(l.unitPrice, f.currency), taxRate: Number(l.taxRate) || 0 }));
    const dv = f.discountType === "percent" ? Number(f.discountValue) || 0 : parseMoneyInput(f.discountValue || "0", f.currency) || 0;
    const discount = { type: f.discountType, value: dv };
    const totals = computeInvoiceTotals({ lines: lines.filter((l) => !Number.isNaN(l.unitPrice) && l.quantity > 0), discount, payments: invoice?.payments ?? [] });
    const errors: string[] = [];
    if (!f.customerId) errors.push("Choose a customer");
    if (!lines.length) errors.push("Add at least one line");
    lines.forEach((l, i) => {
      if (!l.description) errors.push(`Line ${i + 1}: description is required`);
      if (!(l.quantity > 0)) errors.push(`Line ${i + 1}: quantity must be positive`);
      if (Number.isNaN(l.unitPrice) || l.unitPrice < 0) errors.push(`Line ${i + 1}: enter a valid price`);
      if (l.taxRate < 0 || l.taxRate > 50) errors.push(`Line ${i + 1}: tax rate must be 0–50%`);
    });
    if (f.dueDate < f.issueDate) errors.push("Due date must be on or after the issue date");
    if (f.discountType === "percent" && (dv < 0 || dv > 100)) errors.push("Discount must be 0–100%");
    return { lines, discount, totals, errors };
  }, [f, invoice?.payments]);

  const save = async () => {
    if (!repo || parsed.errors.length) return;
    const cust = customers.find((c) => c.id === f.customerId)!;
    setBusy(true);
    try {
      const base = {
        customerId: cust.id,
        customerName: cust.name,
        customerEmail: cust.email,
        currency: f.currency,
        issueDate: f.issueDate,
        dueDate: f.dueDate,
        paymentTermsDays: Number(f.paymentTermsDays) || 0,
        lines: parsed.lines,
        discount: parsed.discount,
        notes: f.notes,
        terms: f.terms,
        totals: parsed.totals,
      };
      if (invoice) {
        await repo.update("invoices", invoice.id, { ...base, history: [...invoice.history, { at: new Date().toISOString(), event: "Draft edited", by: "you" }] });
        toast.success("Draft saved", invoice.number);
      } else {
        const prefix = org?.settings.invoicePrefix ?? "INV-";
        const max = invoices.reduce((mx, i) => Math.max(mx, Number(i.number.replace(/\D/g, "")) || 0), 1000);
        await repo.create("invoices", { ...base, source: "manual", status: "draft", number: `${prefix}${max + 1}`, payments: [], history: [{ at: new Date().toISOString(), event: "Draft created", by: "you" }], attachmentIds: [], archivedAt: null } as any);
        toast.success("Invoice draft created", `${prefix}${max + 1}`);
      }
      setTouched(false);
      onClose();
    } catch (e) {
      toast.error("Couldn't save invoice", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const m = (v: number) => formatMoney(v, f.currency);
  return (
    <Dialog
      open={open}
      onClose={() => (touched && !confirm("Discard unsaved changes?") ? null : onClose())}
      size="xl"
      title={invoice ? `Edit draft ${invoice.number}` : "New invoice"}
      description="Saved as a draft. Nothing is sent until you choose Send."
      footer={
        <>
          {parsed.errors.length > 0 && touched && <p className="text-xs text-rose-300 sm:mr-auto self-center">{parsed.errors[0]}</p>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={parsed.errors.length > 0} onClick={save}>{invoice ? "Save draft" : "Create draft"}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Field label="Customer" required className="sm:col-span-2">
          {(id) => (
            <Select id={id} value={f.customerId} onChange={(e) => upd({ customerId: e.target.value })}>
              <option value="">Select a customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ""}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Currency">{(id) => <Select id={id} value={f.currency} onChange={(e) => upd({ currency: e.target.value })}>{SUPPORTED_CURRENCIES.map((c) => <option key={c.code}>{c.code}</option>)}</Select>}</Field>
        <Field label="Payment terms (days)">{(id) => <Input id={id} type="number" min={0} value={f.paymentTermsDays} onChange={(e) => upd({ paymentTermsDays: e.target.value, dueDate: addDays(f.issueDate, Number(e.target.value) || 0), terms: `Net ${e.target.value}` })} />}</Field>
        <Field label="Issue date">{(id) => <Input id={id} type="date" value={f.issueDate} onChange={(e) => upd({ issueDate: e.target.value, dueDate: addDays(e.target.value, Number(f.paymentTermsDays) || 0) })} />}</Field>
        <Field label="Due date">{(id) => <Input id={id} type="date" value={f.dueDate} min={f.issueDate} onChange={(e) => upd({ dueDate: e.target.value })} />}</Field>
      </div>

      <div className="mt-6">
        <div className="hidden md:grid grid-cols-[1.4fr_2fr_80px_120px_80px_110px_32px] gap-2 px-1 pb-1.5 text-xs text-muted">
          <span>Product / service</span><span>Description</span><span>Qty</span><span>Unit price</span><span>Tax %</span><span className="text-right">Amount</span><span />
        </div>
        <div className="space-y-2">
          {f.lines.map((l, i) => {
            const amt = Math.round((Number(l.quantity) || 0) * (parseMoneyInput(l.unitPrice, f.currency) || 0));
            return (
              <div key={l.id} className="grid grid-cols-2 md:grid-cols-[1.4fr_2fr_80px_120px_80px_110px_32px] gap-2 items-center rounded-xl md:rounded-none border md:border-0 border-line p-3 md:p-0">
                <Select
                  aria-label={`Line ${i + 1} product`}
                  className="col-span-2 md:col-span-1"
                  value={l.productId ?? ""}
                  onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value);
                    updLine(l.id, p ? { productId: p.id, description: p.name, unitPrice: toMajor(p.price, f.currency).toFixed(2), taxRate: String(p.taxRate) } : { productId: undefined });
                  }}
                >
                  <option value="">Custom line item</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.price, p.currency)}</option>)}
                </Select>
                <Input aria-label={`Line ${i + 1} description`} className="col-span-2 md:col-span-1" placeholder="Description" value={l.description} onChange={(e) => updLine(l.id, { description: e.target.value })} maxLength={200} />
                <Input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => updLine(l.id, { quantity: e.target.value })} />
                <Input aria-label={`Line ${i + 1} unit price`} inputMode="decimal" value={l.unitPrice} onChange={(e) => updLine(l.id, { unitPrice: e.target.value })} />
                <Input aria-label={`Line ${i + 1} tax rate`} inputMode="decimal" value={l.taxRate} onChange={(e) => updLine(l.id, { taxRate: e.target.value })} />
                <span className="text-right text-sm tabular">{m(amt)}</span>
                <button className="justify-self-end p-1.5 rounded-md text-faint hover:text-rose-300 disabled:opacity-30" disabled={f.lines.length === 1} onClick={() => upd({ lines: f.lines.filter((x) => x.id !== l.id) })} aria-label={`Remove line ${i + 1}`}><Trash2 className="size-4" /></button>
              </div>
            );
          })}
        </div>
        <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => upd({ lines: [...f.lines, { id: uid("l"), description: "", quantity: "1", unitPrice: "0.00", taxRate: "0" }] })}>Add line</Button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Notes (shown on invoice)">{(id) => <Textarea id={id} value={f.notes} onChange={(e) => upd({ notes: e.target.value })} maxLength={2000} />}</Field>
          <Field label="Terms">{(id) => <Input id={id} value={f.terms} onChange={(e) => upd({ terms: e.target.value })} maxLength={200} />}</Field>
        </div>
        <div className="rounded-xl border border-line bg-surface-2/40 p-4 text-sm space-y-2 h-fit">
          <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="tabular">{m(parsed.totals.subtotal)}</span></div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted">Discount</span>
            <span className="flex items-center gap-1.5">
              <Select aria-label="Discount type" value={f.discountType} onChange={(e) => upd({ discountType: e.target.value as "percent" | "fixed", discountValue: "0" })} className="h-8 w-20 text-xs"><option value="percent">%</option><option value="fixed">{f.currency}</option></Select>
              <Input aria-label="Discount value" inputMode="decimal" value={f.discountValue} onChange={(e) => upd({ discountValue: e.target.value })} className="h-8 w-24 text-right" />
            </span>
          </div>
          {parsed.totals.discount > 0 && <div className="flex justify-between text-muted"><span /><span className="tabular">−{m(parsed.totals.discount)}</span></div>}
          <div className="flex justify-between"><span className="text-muted">Tax</span><span className="tabular">{m(parsed.totals.tax)}</span></div>
          <div className="flex justify-between pt-2 border-t border-line text-base font-semibold"><span>Total</span><span className="tabular">{m(parsed.totals.total)}</span></div>
          <p className="text-[11px] text-faint">Basic tax calculation for convenience — confirm tax treatment with your accountant.</p>
        </div>
      </div>
    </Dialog>
  );
}
