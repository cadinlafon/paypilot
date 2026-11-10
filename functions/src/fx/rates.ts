/**
 * Modular exchange-rate service. Providers implement `FxProvider`; swap via
 * the FX_PROVIDER param. Rates are cached per organization in
 * organizations/{orgId}/exchangeRates/{BASE}_{YYYY-MM-DD} with provider and
 * timestamp, so every conversion is reproducible and auditable.
 * A whole date range costs one cache query + at most one provider call.
 */
import type { ExchangeRateSnapshot } from "../../../shared/types";
import { orgCol, nowIso, db } from "../lib/admin";
import { FX_PROVIDER } from "../lib/params";
import type { RateLookup } from "../../../shared/money";

export interface FxProvider {
  id: string;
  label: string;
  /** Daily rates quoted from `base` for business days in [from, to]. */
  range(base: string, from: string, to: string): Promise<Record<string, Record<string, number>>>;
}

/** Frankfurter — free, keyless, ECB reference rates with history back to 1999. */
const frankfurter: FxProvider = {
  id: "frankfurter",
  label: "Frankfurter (ECB reference rates)",
  async range(base, from, to) {
    // Start a few days early so weekend/holiday dates have a prior business day.
    const start = new Date(Date.parse(`${from}T00:00:00Z`) - 5 * 86400000).toISOString().slice(0, 10);
    const res = await fetch(`https://api.frankfurter.app/${start}..${to}?from=${encodeURIComponent(base)}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
    const j = (await res.json()) as { rates: Record<string, Record<string, number>> };
    return j.rates ?? {};
  },
};

const PROVIDERS: Record<string, FxProvider> = { frankfurter };
export function provider(): FxProvider {
  return PROVIDERS[FX_PROVIDER.value()] ?? frankfurter;
}

export async function prepareLookup(orgId: string, reporting: string, dates: string[]): Promise<RateLookup> {
  const today = new Date().toISOString().slice(0, 10);
  const wanted = [...new Set(dates)].filter(Boolean).sort();
  const snaps = new Map<string, ExchangeRateSnapshot>();
  if (wanted.length) {
    const from = wanted[0], to = wanted[wanted.length - 1] > today ? today : wanted[wanted.length - 1];
    const lo = new Date(Date.parse(`${from}T00:00:00Z`) - 5 * 86400000).toISOString().slice(0, 10);
    const cached = await orgCol(orgId, "exchangeRates").where("date", ">=", lo).where("date", "<=", to).limit(2000).get();
    for (const d of cached.docs) {
      const s = d.data() as ExchangeRateSnapshot;
      if (s.base === reporting) snaps.set(s.date, s);
    }
    const missing = wanted.filter((d) => d < today && !snaps.has(d));
    if (missing.length || wanted.includes(today)) {
      try {
        const p = provider();
        const rates = await p.range(reporting, missing[0] ?? today, to);
        const batch = db.batch();
        let n = 0;
        for (const [date, r] of Object.entries(rates)) {
          if (snaps.has(date)) continue;
          const snap: ExchangeRateSnapshot = { id: `${reporting}_${date}`, base: reporting, date, rates: { ...r, [reporting]: 1 }, provider: p.label, fetchedAt: nowIso() };
          snaps.set(date, snap);
          if (n++ < 450) batch.set(orgCol(orgId, "exchangeRates").doc(snap.id), snap);
        }
        if (n) await batch.commit();
      } catch (e) {
        console.warn("FX fetch failed", e);
      }
    }
  }
  const sorted = [...snaps.values()].sort((a, b) => a.date.localeCompare(b.date));
  const priorTo = (date: string) => {
    let hit: ExchangeRateSnapshot | undefined;
    for (const s of sorted) if (s.date <= date) hit = s;
    return hit;
  };
  return (from, to, date) => {
    if (to !== reporting) return null;
    const snap = priorTo(date) ?? sorted[sorted.length - 1];
    const perReporting = snap?.rates[from];
    if (!snap || !perReporting) return null;
    // A prior business day's rate (weekends/holidays) is the official rate, not an estimate.
    // Same-day rates (not final yet) and rates from after the date are estimates.
    const estimated = date >= today || snap.date > date || Date.parse(date) - Date.parse(snap.date) > 5 * 86400000;
    return { rate: 1 / perReporting, date: snap.date, provider: snap.provider, estimated };
  };
}

export async function fxHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    const d = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    await provider().range("USD", d, d);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
