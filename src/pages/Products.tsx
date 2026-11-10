import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Boxes, Archive, Pencil } from "lucide-react";
import { useActive, useDataset, useWorkspace } from "@/context/WorkspaceContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, SearchInput, Textarea, Switch } from "@/components/ui/Form";
import { DataTable, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { Dialog, ConfirmDialog } from "@/components/ui/Dialog";
import { SkeletonRows, EmptyState, ErrorState } from "@/components/ui/Feedback";
import { Segmented } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { revenueByProduct } from "@shared/analytics";
import { rangeFromPreset, formatDate } from "@shared/dates";
import { parseMoneyInput, toMajor, SUPPORTED_CURRENCIES } from "@shared/money";
import type { Product } from "@shared/types";
import { errorMessage } from "@/lib/utils";

export default function Products() {
  const { org, can, repo } = useWorkspace();
  const { rows, loading, error } = useActive("products");
  const { ds } = useDataset();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"active" | "inactive" | "all">("active");
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Product | null | "new">(null);
  const [archiving, setArchiving] = useState<Product | null>(null);
  const tz = org?.timezone ?? "UTC";
  const rc = org?.reportingCurrency ?? "USD";
  useEffect(() => {
    const o = params.get("open");
    if (o) {
      const p = rows.find((x) => x.id === o);
      if (p) { setEditing(p); setParams({}, { replace: true }); }
    }
  }, [params, rows, setParams]);
  const perf = useMemo(() => new Map(ds && org ? revenueByProduct(ds, rangeFromPreset("12m", org.timezone)).map((p) => [p.id, p]) : []), [ds, org]);
  const filtered = rows.filter((p) => (show === "all" || (show === "active" ? p.active : !p.active)) && (!q || [p.name, p.description, p.category].some((x) => x.toLowerCase().includes(q.toLowerCase()))));

  const cols: Column<Product>[] = [
    { key: "name", header: "Name", cell: (p) => <div className="max-w-[300px]"><div className="truncate flex items-center gap-2">{p.name}{!p.active && <Badge>Inactive</Badge>}</div><div className="text-xs text-muted truncate">{p.description}</div></div>, sort: (p) => p.name },
    { key: "type", header: "Type", cell: (p) => <Badge tone={p.type === "service" ? "violet" : "blue"}>{p.type}</Badge>, hideBelow: "sm" },
    { key: "cat", header: "Category", cell: (p) => <span className="text-muted">{p.category}</span>, sort: (p) => p.category, hideBelow: "md" },
    { key: "tax", header: "Tax", align: "right", cell: (p) => <span className="text-muted">{p.taxRate ? `${p.taxRate}%` : "—"}</span>, hideBelow: "lg" },
    { key: "created", header: "Created", cell: (p) => <span className="text-muted">{formatDate(p.createdAt, tz)}</span>, sort: (p) => p.createdAt, hideBelow: "lg" },
    { key: "rev", header: `12-mo revenue (${rc})`, align: "right", cell: (p) => <Money amount={perf.get(p.id)?.gross ?? 0} currency={rc} muted={!perf.get(p.id)} />, sort: (p) => perf.get(p.id)?.gross ?? 0, hideBelow: "md" },
    { key: "price", header: "Price", align: "right", cell: (p) => <Money amount={p.price} currency={p.currency} />, sort: (p) => p.price },
    { key: "act", header: "", className: "w-20", cell: (p) => can("products.edit") ? <span className="flex justify-end gap-0.5"><button onClick={(e) => { e.stopPropagation(); setEditing(p); }} className="p-1.5 rounded-md text-muted hover:text-fg hover:bg-surface-3" aria-label="Edit"><Pencil className="size-3.5" /></button><button onClick={(e) => { e.stopPropagation(); setArchiving(p); }} className="p-1.5 rounded-md text-muted hover:text-rose-300 hover:bg-surface-3" aria-label="Archive"><Archive className="size-3.5" /></button></span> : null },
  ];
  return (
    <div>
      <PageHeader title="Products & Services" description="Your catalog. Active items can be selected when creating invoices." actions={can("products.edit") && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Add item</Button>} />
      <Card>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center p-4 border-b border-line">
          <SearchInput value={q} onChange={setQ} className="sm:w-72" />
          <Segmented value={show} onChange={setShow} items={[{ id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }, { id: "all", label: "All" }]} />
        </div>
        {error ? <ErrorState error={error} /> : loading ? <SkeletonRows /> : <DataTable rows={filtered} columns={cols} rowKey={(p) => p.id} onRowClick={can("products.edit") ? (p) => setEditing(p) : undefined} initialSort={{ key: "rev", dir: "desc" }} empty={<EmptyState icon={<Boxes className="size-5" />} title="No items" action={can("products.edit") && <Button size="sm" onClick={() => setEditing("new")}>Add item</Button>} />} />}
      </Card>
      <ProductForm open={editing !== null} product={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      <ConfirmDialog open={!!archiving} onClose={() => setArchiving(null)} danger title={`Archive ${archiving?.name}?`} description="It will no longer be available for new invoices. Past invoices and revenue reports keep their history." confirmLabel="Archive" onConfirm={async () => { try { await repo!.archive("products", archiving!.id); toast.success("Item archived"); } catch (e) { toast.error("Couldn't archive", errorMessage(e)); } setArchiving(null); }} />
    </div>
  );
}

function ProductForm({ open, onClose, product }: { open: boolean; onClose: () => void; product: Product | null }) {
  const { org, repo, setDirty } = useWorkspace();
  const toast = useToast();
  const blank = () => ({ name: product?.name ?? "", description: product?.description ?? "", type: product?.type ?? ("service" as Product["type"]), price: product ? toMajor(product.price, product.currency).toFixed(2) : "", currency: product?.currency ?? org?.reportingCurrency ?? "USD", category: product?.category ?? "", taxRate: String(product?.taxRate ?? 0), taxCode: product?.taxCode ?? "", active: product?.active ?? true });
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(blank()); setTouched(false); } }, [open, product?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDirty("product-form", open && touched); return () => setDirty("product-form", false); }, [open, touched, setDirty]);
  const upd = (p: Partial<typeof f>) => { setTouched(true); setF((s) => ({ ...s, ...p })); };
  const price = parseMoneyInput(f.price, f.currency);
  const tax = Number(f.taxRate);
  const err = !f.name.trim() ? "Name is required" : !(price >= 0) ? "Enter a valid price" : !(tax >= 0 && tax <= 50) ? "Tax rate must be 0–50%" : null;
  const save = async () => {
    if (!repo || err) return;
    setBusy(true);
    const data = { name: f.name.trim(), description: f.description.trim(), type: f.type, price, currency: f.currency, category: f.category.trim() || "General", taxRate: tax, taxCode: f.taxCode.trim() || undefined, active: f.active };
    try {
      if (product) await repo.update("products", product.id, data);
      else await repo.create("products", { ...data, source: "manual", archivedAt: null } as any);
      toast.success(product ? "Item updated" : "Item added", data.name);
      setTouched(false);
      onClose();
    } catch (e) {
      toast.error("Couldn't save", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={product ? "Edit item" : "Add product or service"} footer={<>{touched && err && <p className="text-xs text-rose-300 sm:mr-auto self-center">{err}</p>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!!err} onClick={save}>{product ? "Save" : "Add item"}</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Name" required className="sm:col-span-2">{(id) => <Input id={id} value={f.name} onChange={(e) => upd({ name: e.target.value })} maxLength={120} />}</Field>
        <Field label="Type">{(id) => <Select id={id} value={f.type} onChange={(e) => upd({ type: e.target.value as Product["type"] })}><option value="service">Service</option><option value="product">Product</option></Select>}</Field>
        <Field label="Description" className="sm:col-span-3">{(id) => <Textarea id={id} value={f.description} onChange={(e) => upd({ description: e.target.value })} maxLength={500} className="min-h-16" />}</Field>
        <Field label="Price" required>{(id) => <Input id={id} inputMode="decimal" value={f.price} onChange={(e) => upd({ price: e.target.value })} placeholder="0.00" />}</Field>
        <Field label="Currency">{(id) => <Select id={id} value={f.currency} onChange={(e) => upd({ currency: e.target.value })}>{SUPPORTED_CURRENCIES.map((c) => <option key={c.code}>{c.code}</option>)}</Select>}</Field>
        <Field label="Category">{(id) => <Input id={id} value={f.category} onChange={(e) => upd({ category: e.target.value })} placeholder="e.g. Consulting" />}</Field>
        <Field label="Tax rate (%)">{(id) => <Input id={id} inputMode="decimal" value={f.taxRate} onChange={(e) => upd({ taxRate: e.target.value })} />}</Field>
        <Field label="Tax code (optional)" className="sm:col-span-2">{(id) => <Input id={id} value={f.taxCode} onChange={(e) => upd({ taxCode: e.target.value })} placeholder="e.g. txcd_10000000" />}</Field>
        <div className="sm:col-span-3 flex items-center justify-between rounded-xl border border-line px-4 py-3"><div><div className="text-sm">Active</div><div className="text-xs text-muted">Inactive items can't be added to new invoices.</div></div><Switch checked={f.active} onChange={(v) => upd({ active: v })} label="Active" /></div>
      </div>
    </Dialog>
  );
}
