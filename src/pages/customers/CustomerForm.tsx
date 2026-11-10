import { useEffect, useState } from "react";
import type { Customer } from "@shared/types";
import { useActive, useWorkspace } from "@/context/WorkspaceContext";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, isEmail } from "@/lib/utils";

export function CustomerForm({ open, onClose, customer, onCreated }: { open: boolean; onClose: () => void; customer?: Customer | null; onCreated?: (id: string) => void }) {
  const { repo, setDirty } = useWorkspace();
  const existing = useActive("customers").rows;
  const toast = useToast();
  const blank = () => ({
    name: customer?.name ?? "",
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
    company: customer?.company ?? "",
    line1: customer?.billingAddress?.line1 ?? "",
    line2: customer?.billingAddress?.line2 ?? "",
    city: customer?.billingAddress?.city ?? "",
    state: customer?.billingAddress?.state ?? "",
    postalCode: customer?.billingAddress?.postalCode ?? "",
    country: customer?.billingAddress?.country ?? "",
    tags: customer?.tags.join(", ") ?? "",
    notes: customer?.notes ?? "",
  });
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(blank()); setTouched(false); } }, [open, customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDirty("customer-form", open && touched); return () => setDirty("customer-form", false); }, [open, touched, setDirty]);
  const upd = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setTouched(true); setF({ ...f, [k]: e.target.value }); };
  const dup = existing.find((c) => c.id !== customer?.id && c.email.toLowerCase() === f.email.trim().toLowerCase());
  const errors = { name: !f.name.trim() ? "Name is required" : null, email: !isEmail(f.email) ? "Enter a valid email" : dup ? `${dup.name} already uses this email` : null };
  const valid = !errors.name && !errors.email;

  const save = async () => {
    if (!repo || !valid) return;
    setBusy(true);
    const data = {
      name: f.name.trim(),
      email: f.email.trim().toLowerCase(),
      phone: f.phone.trim() || undefined,
      company: f.company.trim() || undefined,
      billingAddress: { line1: f.line1, line2: f.line2, city: f.city, state: f.state, postalCode: f.postalCode, country: f.country.toUpperCase() },
      tags: f.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10),
      notes: f.notes,
    };
    try {
      if (customer) {
        await repo.update("customers", customer.id, data);
        toast.success("Customer updated");
      } else {
        const c = await repo.create("customers", { ...data, source: "manual", archivedAt: null } as any);
        toast.success("Customer added", c.name);
        onCreated?.(c.id);
      }
      setTouched(false);
      onClose();
    } catch (e) {
      toast.error("Couldn't save customer", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={customer ? "Edit customer" : "Add customer"} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={save}>{customer ? "Save" : "Add customer"}</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={touched ? errors.name : null}>{(id) => <Input id={id} value={f.name} onChange={upd("name")} maxLength={120} />}</Field>
        <Field label="Email" required error={touched ? errors.email : null}>{(id) => <Input id={id} type="email" value={f.email} onChange={upd("email")} maxLength={200} />}</Field>
        <Field label="Phone">{(id) => <Input id={id} type="tel" value={f.phone} onChange={upd("phone")} maxLength={40} />}</Field>
        <Field label="Company">{(id) => <Input id={id} value={f.company} onChange={upd("company")} maxLength={120} />}</Field>
      </div>
      <h3 className="mt-6 mb-3 text-xs font-medium uppercase tracking-wide text-faint">Billing address</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
        <Field label="Address line 1" className="sm:col-span-6">{(id) => <Input id={id} value={f.line1} onChange={upd("line1")} />}</Field>
        <Field label="Address line 2" className="sm:col-span-6">{(id) => <Input id={id} value={f.line2} onChange={upd("line2")} />}</Field>
        <Field label="City" className="sm:col-span-2">{(id) => <Input id={id} value={f.city} onChange={upd("city")} />}</Field>
        <Field label="State / region" className="sm:col-span-2">{(id) => <Input id={id} value={f.state} onChange={upd("state")} />}</Field>
        <Field label="Postal code">{(id) => <Input id={id} value={f.postalCode} onChange={upd("postalCode")} />}</Field>
        <Field label="Country">{(id) => <Input id={id} value={f.country} onChange={upd("country")} maxLength={2} placeholder="US" />}</Field>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4">
        <Field label="Tags" hint="Comma-separated, e.g. vip, wholesale">{(id) => <Input id={id} value={f.tags} onChange={upd("tags")} />}</Field>
        <Field label="Notes">{(id) => <Textarea id={id} value={f.notes} onChange={upd("notes")} maxLength={2000} />}</Field>
      </div>
    </Dialog>
  );
}
