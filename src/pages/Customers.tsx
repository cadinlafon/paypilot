import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Download, Users } from "lucide-react";
import { useActive, useDataset, useWorkspace } from "@/context/WorkspaceContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/Form";
import { DataTable, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { SkeletonRows, EmptyState, ErrorState } from "@/components/ui/Feedback";
import { topCustomers } from "@shared/analytics";
import { toMajor } from "@shared/money";
import { formatDate } from "@shared/dates";
import type { Customer } from "@shared/types";
import { downloadCsv } from "@/lib/csv";
import { initials } from "@/lib/utils";
import { CustomerForm } from "./customers/CustomerForm";

export default function Customers() {
  const { org, can } = useWorkspace();
  const { rows, loading, error } = useActive("customers");
  const { ds } = useDataset();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [params, setParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(params.get("new") === "1");
  useEffect(() => { if (params.get("new") === "1") setFormOpen(true); }, [params]);
  const rc = org?.reportingCurrency ?? "USD";
  const tz = org?.timezone ?? "UTC";
  const lifetime = useMemo(() => new Map(ds ? topCustomers(ds, null, 100000).map((c) => [c.id, c]) : []), [ds]);
  const open = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of ds?.invoices ?? []) if (!i.archivedAt && i.status !== "draft" && i.status !== "cancelled" && i.totals.balance > 0 && i.currency === rc) m.set(i.customerId, (m.get(i.customerId) ?? 0) + i.totals.balance);
    return m;
  }, [ds, rc]);
  const filtered = rows.filter((c) => !q || [c.name, c.email, c.company ?? "", c.phone ?? "", ...c.tags].some((x) => x.toLowerCase().includes(q.toLowerCase())));

  const cols: Column<Customer>[] = [
    { key: "name", header: "Customer", cell: (c) => <div className="flex items-center gap-3"><span className="grid grid-cols-1 place-items-center size-8 rounded-full bg-surface-3 text-[11px] font-semibold shrink-0">{initials(c.name)}</span><div className="min-w-0"><div className="truncate max-w-[220px]">{c.name}</div><div className="text-xs text-muted truncate max-w-[220px]">{c.email}</div></div></div>, sort: (c) => c.name },
    { key: "company", header: "Company", cell: (c) => <span className="text-muted">{c.company ?? "—"}</span>, sort: (c) => c.company ?? "", hideBelow: "md" },
    { key: "tags", header: "Tags", cell: (c) => <span className="flex gap-1">{c.tags.map((t) => <Badge key={t} tone={t === "vip" ? "green" : "neutral"}>{t}</Badge>)}</span>, hideBelow: "lg" },
    { key: "since", header: "Customer since", cell: (c) => <span className="text-muted">{formatDate(c.createdAt, tz)}</span>, sort: (c) => c.createdAt, hideBelow: "lg" },
    { key: "open", header: "Outstanding", align: "right", cell: (c) => (open.get(c.id) ? <Money amount={open.get(c.id)!} currency={rc} className="text-amber-300" /> : <span className="text-faint">—</span>), sort: (c) => open.get(c.id) ?? 0, hideBelow: "sm" },
    { key: "ltv", header: "Lifetime paid", align: "right", cell: (c) => <Money amount={lifetime.get(c.id)?.total ?? 0} currency={rc} />, sort: (c) => lifetime.get(c.id)?.total ?? 0 },
  ];
  return (
    <div>
      <PageHeader
        title="Customers"
        description={`${rows.length.toLocaleString()} customers. Lifetime totals are net of refunds, in ${rc}.`}
        actions={
          <>
            <Button icon={<Download className="size-4" />} disabled={!filtered.length} onClick={() => downloadCsv("customers.csv", filtered.map((c) => ({ name: c.name, email: c.email, phone: c.phone ?? "", company: c.company ?? "", city: c.billingAddress?.city ?? "", country: c.billingAddress?.country ?? "", tags: c.tags.join(" "), created: c.createdAt, lifetime_paid: toMajor(lifetime.get(c.id)?.total ?? 0, rc), currency: rc })))}>Export</Button>
            {can("customers.edit") && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setFormOpen(true)}>Add customer</Button>}
          </>
        }
      />
      <Card>
        <div className="p-4 border-b border-line"><SearchInput value={q} onChange={setQ} placeholder="Search name, email, company, tag…" className="sm:w-80" /></div>
        {error ? <ErrorState error={error} /> : loading ? <SkeletonRows /> : <DataTable rows={filtered} columns={cols} rowKey={(c) => c.id} onRowClick={(c) => nav(`/customers/${c.id}`)} initialSort={{ key: "ltv", dir: "desc" }} empty={<EmptyState icon={<Users className="size-5" />} title={rows.length ? "No customers match" : "No customers yet"} action={!rows.length && can("customers.edit") && <Button size="sm" onClick={() => setFormOpen(true)}>Add customer</Button>} />} />}
      </Card>
      <CustomerForm open={formOpen} onClose={() => { setFormOpen(false); if (params.get("new")) setParams({}, { replace: true }); }} onCreated={(id) => nav(`/customers/${id}`)} />
    </div>
  );
}
