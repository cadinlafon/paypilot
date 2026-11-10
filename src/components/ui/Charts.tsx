import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { formatMoney } from "@shared/money";
import type { ChartSpec } from "@shared/types";

export const CHART_COLORS = ["#10b981", "#38bdf8", "#a78bfa", "#f59e0b", "#f472b6", "#64748b", "#22d3ee", "#facc15"];
const axis = { stroke: "#5d676d", fontSize: 11, tickLine: false, axisLine: false } as const;

function fmt(v: number, format: ChartSpec["valueFormat"], currency?: string, compact = true) {
  if (format === "currency") return formatMoney(v, currency ?? "USD", { compact });
  if (format === "percent") return `${(v * 100).toFixed(compact ? 0 : 1)}%`;
  return compact ? Intl.NumberFormat("en-US", { notation: "compact" }).format(v) : v.toLocaleString();
}

function TooltipBox({ active, payload, label, format, currency }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="text-muted mb-1">{label ?? payload[0]?.name}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto tabular font-medium text-fg">{fmt(p.value, format, currency, false)}</span>
        </div>
      ))}
    </div>
  );
}

export interface SeriesDef { key: string; name: string; color?: string }

export function TimeChart({ data, series, xKey = "label", type = "area", format = "currency", currency, height = 240, stacked }: { data: Record<string, any>[]; series: SeriesDef[]; xKey?: string; type?: "area" | "bar" | "line"; format?: ChartSpec["valueFormat"]; currency?: string; height?: number; stacked?: boolean }) {
  const common = { data, margin: { top: 8, right: 8, left: 0, bottom: 0 } };
  const grid = <CartesianGrid stroke="#1f2629" vertical={false} />;
  const x = <XAxis dataKey={xKey} {...axis} minTickGap={24} />;
  const y = <YAxis {...axis} width={56} tickFormatter={(v) => fmt(v, format, currency)} />;
  const tip = <Tooltip cursor={{ stroke: "#2f373c", fill: "rgba(255,255,255,0.03)" }} content={<TooltipBox format={format} currency={currency} />} />;
  const legend = series.length > 1 ? <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, color: "#8d979d" }} /> : null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      {type === "bar" ? (
        <BarChart {...common}>
          {grid}{x}{y}{tip}{legend}
          {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color ?? CHART_COLORS[i]} radius={[4, 4, 0, 0]} stackId={stacked ? "a" : undefined} maxBarSize={32} />)}
        </BarChart>
      ) : type === "line" ? (
        <LineChart {...common}>
          {grid}{x}{y}{tip}{legend}
          {series.map((s, i) => <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color ?? CHART_COLORS[i]} strokeWidth={2} dot={false} type="monotone" />)}
        </LineChart>
      ) : (
        <AreaChart {...common}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color ?? CHART_COLORS[i]} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color ?? CHART_COLORS[i]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {grid}{x}{y}{tip}{legend}
          {series.map((s, i) => <Area key={s.key} dataKey={s.key} name={s.name} stroke={s.color ?? CHART_COLORS[i]} strokeWidth={2} fill={`url(#g-${s.key})`} type="monotone" stackId={stacked ? "a" : undefined} />)}
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, format = "currency", currency, height = 220, stacked }: { data: { label: string; value: number }[]; format?: ChartSpec["valueFormat"]; currency?: string; height?: number; stacked?: boolean }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className={stacked ? "flex flex-col items-center gap-4" : "flex flex-col sm:flex-row items-center gap-4"}>
      <div className={stacked ? "w-full" : "w-full sm:w-1/2"} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
              {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip content={<TooltipBox format={format} currency={currency} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className={stacked ? "w-full space-y-1.5 text-xs" : "w-full sm:w-1/2 space-y-1.5 text-xs"}>
        {data.slice(0, 8).map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="size-2 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="truncate text-muted">{d.label}</span>
            <span className="ml-auto tabular">{fmt(d.value, format, currency, false)}</span>
            <span className="w-10 text-right text-faint tabular">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HBarList({ data, format = "currency", currency }: { data: { label: string; value: number; sub?: string }[]; format?: ChartSpec["valueFormat"]; currency?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-3">
      {data.map((d, i) => (
        <li key={d.label + i}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{d.label}</span>
            <span className="tabular text-fg shrink-0">{fmt(d.value, format, currency, false)}</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-surface-3 overflow-hidden">
            <div className="h-full rounded-full bg-accent/80 transition-all" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          {d.sub && <div className="text-[11px] text-faint mt-1">{d.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

/** Render an AI-produced ChartSpec. */
export function SpecChart({ spec }: { spec: ChartSpec }) {
  if (spec.type === "pie") return <DonutChart data={spec.data} format={spec.valueFormat} currency={spec.currency} height={180} />;
  const series: SeriesDef[] = [{ key: "value", name: spec.seriesNames?.[0] ?? "Value" }];
  if (spec.data.some((d) => d.value2 !== undefined)) series.push({ key: "value2", name: spec.seriesNames?.[1] ?? "Value 2" });
  return <TimeChart data={spec.data} series={series} type={spec.type === "line" ? "line" : spec.type === "bar" ? "bar" : "area"} format={spec.valueFormat} currency={spec.currency} height={200} />;
}
