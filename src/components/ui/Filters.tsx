import { useState } from "react";
import { Calendar } from "lucide-react";
import { rangeFromPreset, type DateRange, type RangePreset } from "@shared/dates";
import { Select, Input } from "./Form";

export const PRESETS: { id: RangePreset; label: string }[] = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "mtd", label: "Month to date" },
  { id: "qtd", label: "Quarter to date" },
  { id: "ytd", label: "Year to date" },
  { id: "12m", label: "Last 12 months" },
  { id: "custom", label: "Custom range…" },
];

export interface RangeState { preset: RangePreset; custom?: DateRange }

export function useRange(tz: string, initial: RangePreset = "30d") {
  const [state, setState] = useState<RangeState>({ preset: initial });
  return { state, setState, range: rangeFromPreset(state.preset, tz, state.custom) };
}

export function DateRangeControl({ state, onChange, tz }: { state: RangeState; onChange: (s: RangeState) => void; tz: string }) {
  const r = rangeFromPreset(state.preset, tz, state.custom);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-faint pointer-events-none" />
        <Select aria-label="Date range" value={state.preset} onChange={(e) => onChange({ preset: e.target.value as RangePreset, custom: state.custom ?? r })} className="pl-8 w-44">
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
      </div>
      {state.preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input type="date" aria-label="From" value={r.from} max={r.to} onChange={(e) => e.target.value && onChange({ preset: "custom", custom: { from: e.target.value, to: r.to } })} className="w-38" />
          <span className="text-faint text-xs">to</span>
          <Input type="date" aria-label="To" value={r.to} min={r.from} onChange={(e) => e.target.value && onChange({ preset: "custom", custom: { from: r.from, to: e.target.value } })} className="w-38" />
        </div>
      )}
    </div>
  );
}

export function CurrencyControl({ value, onChange, currencies, reporting }: { value: string; onChange: (v: string) => void; currencies: string[]; reporting: string }) {
  return (
    <Select aria-label="Currency" value={value} onChange={(e) => onChange(e.target.value)} className="w-auto min-w-40">
      <option value="all">All currencies → {reporting}</option>
      {currencies.map((c) => <option key={c} value={c}>{c} only (original)</option>)}
    </Select>
  );
}
