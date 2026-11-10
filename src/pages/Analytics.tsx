import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Sparkles, Info } from "lucide-react";
import { useDataset, useWorkspace } from "@/context/WorkspaceContext";
import { PageHeader, Stat, Delta } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DateRangeControl, CurrencyControl, useRange } from "@/components/ui/Filters";
import { TimeChart, DonutChart } from "@/components/ui/Charts";
import { Badge } from "@/components/ui/Badge";
import { Skeleton, ErrorState } from "@/components/ui/Feedback";
import { byCurrency, currenciesIn, customerGrowth, expenseByCategory, invoiceCollection, paymentMethodBreakdown, pctChange, restrictToCurrency, revenueByProduct, summarize, timeSeries } from "@shared/analytics";
import { formatMoney, toMajor } from "@shared/money";
import { formatDate, previousRange } from "@shared/dates";
import { downloadCsv } from "@/lib/csv";
import { pct, titleCase } from "@/lib/utils";

export default function Analytics() {
  const { org } = useWorkspace();
  const { ds: raw, loading, error } = useDataset();
  const tz = org?.timezone ?? "UTC";
  const { state, setState, range } = useRange(tz, "12m");
  const [currency, setCurrency] = useState("all");
  const ds = useMemo(() => (raw ? restrictToCurrency(raw, currency) : null), [raw, currency]);
  const cur = ds?.org.reportingCurrency ?? "USD";

  const a = useMemo(() => {
    if (!ds) return null;
    const s = summarize(ds, range);
    const p = summarize(ds, previousRange(range));
    const series = timeSeries(ds, range).map((x) => ({ ...x, avg: x.count ? Math.round(x.gross / x.count) : 0, rate: x.count + x.failed ? x.count / (x.count + x.failed) : null }));
    return { s, p, series, growth: customerGrowth(ds, range), products: revenueByProduct(ds, range), expenses: expenseByCategory(ds, range), coll: invoiceCollection(ds, range), currencies: raw ? byCurrency(raw, range) : [], methods: paymentMethodBreakdown(ds, range) };
  }, [ds, raw, range]);

  if (error) return <Card><ErrorState error={error} /></Card>;
  const m = (v: number) => formatMoney(v, cur);
  const exportAll = () => {
    if (!a) return;
    downloadCsv(`report-${range.from}-to-${range.to}-${cur}.csv`, [
      ...a.series.map((x) => ({ section: "time_series", period: x.bucket, gross: toMajor(x.gross, cur), refunds: toMajor(x.refunds, cur), fees: toMajor(x.fees, cur), net: toMajor(x.net, cur), expenses: toMajor(x.expenses, cur), successful_payments: x.count, failed_payments: x.failed, currency: cur })),
      ...a.products.map((x) => ({ section: "product", period: `${range.from}..${range.to}`, name: x.name, gross: toMajor(x.gross, cur), net: toMajor(x.net, cur), count: x.count, currency: cur })),
      ...a.expenses.map((x) => ({ section: "expense_category", period: `${range.from}..${range.to}`, name: x.category, expenses: toMajor(x.amount, cur), count: x.count, currency: cur })),
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Analytics & Reports"
        description={`${formatDate(range.from, tz)} – ${formatDate(range.to, tz)} · ${currency === "all" ? `all currencies converted to ${cur}` : `${cur} transactions only (original amounts)`}`}
        actions={
          <>
            <DateRangeControl state={state} onChange={setState} tz={tz} />
            {raw && <CurrencyControl value={currency} onChange={setCurrency} currencies={currenciesIn(raw)} reporting={raw.org.reportingCurrency} />}
            <Button icon={<Download className="size-4" />} onClick={exportAll} disabled={!a}>Export CSV</Button>
            <Link to={`/assistant?prompt=${encodeURIComponent(`Generate a business report for ${state.preset === "custom" ? "the last 90 days" : state.preset}`)}`}><Button variant="primary" icon={<Sparkles className="size-4" />}>AI report</Button></Link>
          </>
        }
      />
      {loading || !a ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}</div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Profit & loss summary" subtitle="Management view. Each line is distinct — fees and refunds are never netted into gross." />
            <CardBody>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-muted border-b border-line"><th className="text-left font-medium py-2">Line</th><th className="text-right font-medium">This period</th><th className="text-right font-medium">Previous</th><th className="text-right font-medium">Change</th></tr></thead>
                  <tbody className="divide-y divide-line/60">
                    {([
                      ["Gross receipts", a.s.grossReceipts, a.p.grossReceipts, false],
                      ["− Refunds", -a.s.refunds, -a.p.refunds, true],
                      ["− Processing fees", -a.s.fees, -a.p.fees, true],
                      ["= Net revenue", a.s.netRevenue, a.p.netRevenue, false],
                      ["− Expenses", -a.s.expenses, -a.p.expenses, true],
                      ["= Net after expenses", a.s.netAfterExpenses, a.p.netAfterExpenses, false],
                    ] as const).map(([l, c, p, inv]) => (
                      <tr key={l} className={l.startsWith("=") ? "font-semibold" : ""}>
                        <td className="py-2.5">{l}</td>
                        <td className="text-right tabular">{m(c)}</td>
                        <td className="text-right tabular text-muted">{m(p)}</td>
                        <td className="text-right text-xs"><Delta value={pctChange(Math.abs(c), Math.abs(p))} invert={inv} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(a.s.estimatedConversions > 0 || a.s.unconverted > 0) && (
                <p className="mt-3 flex items-center gap-2 text-xs text-amber-300/90"><Info className="size-3.5" />{a.s.estimatedConversions} amount(s) use estimated exchange rates{a.s.unconverted ? `; ${a.s.unconverted} record(s) excluded because no rate is available yet` : ""}.</p>
              )}
              <p className="mt-2 text-[11px] text-faint">Not audited accounting or tax advice. Sales tax collected on invoices is included in gross receipts.</p>
            </CardBody>
          </Card>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Average transaction" value={m(a.s.averageTransaction)} sub={<Delta value={pctChange(a.s.averageTransaction, a.p.averageTransaction)} />} />
            <Stat label="Payment success rate" value={pct(a.s.successRate)} sub={`${a.s.failedCount} failed / denied`} />
            <Stat label="Refund rate" value={a.s.grossReceipts ? pct(a.s.refunds / a.s.grossReceipts) : "—"} sub={m(a.s.refunds)} />
            <Stat label="Invoice collection" value={pct(a.coll.collectionRate, 0)} sub={`${m(a.coll.collected)} of ${m(a.coll.issued)}`} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card><CardHeader title="Revenue trends" subtitle="Gross, net and refunds" /><CardBody><TimeChart data={a.series} series={[{ key: "gross", name: "Gross" }, { key: "net", name: "Net", color: "#38bdf8" }, { key: "refunds", name: "Refunds", color: "#f43f5e" }]} type="line" currency={cur} /></CardBody></Card>
            <Card><CardHeader title="Net revenue vs expenses" /><CardBody><TimeChart data={a.series} series={[{ key: "net", name: "Net revenue" }, { key: "expenses", name: "Expenses", color: "#f472b6" }]} type="bar" currency={cur} /></CardBody></Card>
            <Card><CardHeader title="Transaction volume" subtitle={`${a.s.successfulCount.toLocaleString()} successful`} /><CardBody><TimeChart data={a.series} series={[{ key: "count", name: "Successful" }, { key: "failed", name: "Failed", color: "#f43f5e" }]} type="bar" format="number" stacked /></CardBody></Card>
            <Card><CardHeader title="Average transaction value" /><CardBody><TimeChart data={a.series} series={[{ key: "avg", name: "Average" }]} type="area" currency={cur} /></CardBody></Card>
            <Card><CardHeader title="Payment success rate" /><CardBody><TimeChart data={a.series.filter((x) => x.rate !== null)} series={[{ key: "rate", name: "Success rate" }]} type="line" format="percent" /></CardBody></Card>
            <Card><CardHeader title="Customer growth" subtitle={`${a.growth.reduce((s, g) => s + g.newCustomers, 0)} new this period`} /><CardBody><TimeChart data={a.growth} series={[{ key: "total", name: "Total customers" }, { key: "newCustomers", name: "New", color: "#a78bfa" }]} type="line" format="number" /></CardBody></Card>
            <Card><CardHeader title="Processing fees" subtitle={`${m(a.s.fees)} · ${a.s.grossReceipts ? pct(a.s.fees / a.s.grossReceipts) : "—"} of gross`} /><CardBody><TimeChart data={a.series} series={[{ key: "fees", name: "Fees", color: "#f59e0b" }]} type="bar" currency={cur} /></CardBody></Card>
            <Card><CardHeader title="Expense summary" subtitle={m(a.s.expenses)} /><CardBody>{a.expenses.length ? <DonutChart data={a.expenses.map((e) => ({ label: e.category, value: e.amount }))} currency={cur} /> : <p className="text-sm text-muted">No expenses.</p>}</CardBody></Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Product performance" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-muted border-y border-line"><th className="text-left font-medium px-5 py-2">Product / service</th><th className="text-right font-medium px-2">Sales</th><th className="text-right font-medium px-2">Gross</th><th className="text-right font-medium px-5">Net</th></tr></thead>
                  <tbody className="divide-y divide-line/60">{a.products.map((p) => <tr key={p.id}><td className="px-5 py-2.5 truncate max-w-[220px]">{p.name}</td><td className="text-right px-2 tabular text-muted">{p.count}</td><td className="text-right px-2 tabular">{m(p.gross)}</td><td className="text-right px-5 tabular">{m(p.net)}</td></tr>)}</tbody>
                </table>
              </div>
            </Card>
            <Card>
              <CardHeader title="Multi-currency" subtitle={`Original amounts and converted ${raw?.org.reportingCurrency} equivalents`} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-muted border-y border-line"><th className="text-left font-medium px-5 py-2">Currency</th><th className="text-right font-medium px-2">Payments</th><th className="text-right font-medium px-2">Original gross</th><th className="text-right font-medium px-5">≈ {raw?.org.reportingCurrency}</th></tr></thead>
                  <tbody className="divide-y divide-line/60">
                    {a.currencies.map((c) => (
                      <tr key={c.currency}>
                        <td className="px-5 py-2.5">{c.currency}{c.currency === raw?.org.reportingCurrency && <Badge className="ml-2">reporting</Badge>}{c.estimated > 0 && <Badge tone="amber" className="ml-2">{c.estimated} est.</Badge>}</td>
                        <td className="text-right px-2 tabular text-muted">{c.count}</td>
                        <td className="text-right px-2 tabular">{formatMoney(c.gross, c.currency)}</td>
                        <td className="text-right px-5 tabular">{formatMoney(c.reportingGross, raw!.org.reportingCurrency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <CardBody className="pt-4">
                <h4 className="text-xs text-muted mb-2">Payment methods</h4>
                <div className="flex flex-wrap gap-2">{a.methods.map((x) => <Badge key={x.method}>{titleCase(x.method)} · {x.count}{x.failed ? ` (${x.failed} failed)` : ""}</Badge>)}</div>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Invoice collection" subtitle={`Invoices issued ${formatDate(range.from, tz)} – ${formatDate(range.to, tz)} in ${cur}`} />
            <CardBody>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div><div className="text-xs text-muted">Issued</div><div className="text-lg font-semibold tabular">{m(a.coll.issued)}</div><div className="text-xs text-faint">{a.coll.count} invoices</div></div>
                <div><div className="text-xs text-muted">Collected</div><div className="text-lg font-semibold tabular text-accent-strong">{m(a.coll.collected)}</div></div>
                <div><div className="text-xs text-muted">Outstanding</div><div className="text-lg font-semibold tabular">{m(a.coll.outstanding)}</div></div>
                <div><div className="text-xs text-muted">Overdue</div><div className="text-lg font-semibold tabular text-rose-300">{m(a.coll.overdue)}</div><div className="text-xs text-faint">{a.coll.overdueCount} invoices</div></div>
                <div><div className="text-xs text-muted">Collection rate</div><div className="text-lg font-semibold tabular">{pct(a.coll.collectionRate)}</div></div>
              </div>
              <div className="mt-4 h-2 rounded-full bg-surface-3 overflow-hidden flex">
                <div className="bg-accent" style={{ width: `${a.coll.issued ? (a.coll.collected / a.coll.issued) * 100 : 0}%` }} />
                <div className="bg-rose-400/80" style={{ width: `${a.coll.issued ? (a.coll.overdue / a.coll.issued) * 100 : 0}%` }} />
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
