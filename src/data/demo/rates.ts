/**
 * SAMPLE exchange rates for Demo Mode only. Approximate mid-market values with
 * a deterministic daily wobble so charts look realistic. Real Mode uses the
 * configured exchange-rate provider via Cloud Functions instead.
 */
const PER_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.37,
  AUD: 1.52,
  JPY: 151,
  CHF: 0.88,
  MXN: 18.1,
  SEK: 10.6,
  NZD: 1.66,
  SGD: 1.35,
  BRL: 5.4,
};

function wobble(code: string, date: string): number {
  if (code === "USD") return 1;
  const d = Date.parse(`${date}T00:00:00Z`) / 86400000;
  const h = [...code].reduce((a, c) => a + c.charCodeAt(0), 0);
  return 1 + 0.025 * Math.sin(d / 37 + h) + 0.008 * Math.sin(d / 5.3 + h * 2);
}

export function demoRate(from: string, to: string, date: string) {
  const today = new Date().toISOString().slice(0, 10);
  const f = (PER_USD[from] ?? 1) * wobble(from, date);
  const t = (PER_USD[to] ?? 1) * wobble(to, date);
  return {
    rate: t / f,
    date,
    provider: "Sample rates (demo)",
    // Rates for "today" are not final yet — treat as estimates.
    estimated: date >= today,
  };
}

export function knownDemoCurrency(code: string) {
  return code in PER_USD;
}
