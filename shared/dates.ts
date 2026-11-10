/** Timezone-aware date helpers. All storage is UTC ISO; presentation uses the org timezone. */

const keyFmt = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD of an instant in the given IANA timezone. */
export function dateKey(iso: string | Date, timeZone: string): string {
  let f = keyFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    keyFmt.set(timeZone, f);
  }
  return f.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function todayKey(timeZone: string): string {
  return dateKey(new Date(), timeZone);
}

export function addDays(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(key: string, months: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
}

export type Granularity = "day" | "week" | "month";

export function bucketKey(key: string, g: Granularity): string {
  if (g === "day") return key;
  if (g === "month") return key.slice(0, 7);
  const d = new Date(`${key}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday start
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function enumerateBuckets(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  let cur = bucketKey(from, g);
  const end = bucketKey(to, g);
  let guard = 0;
  while (cur <= end && guard++ < 2000) {
    out.push(cur);
    cur = g === "day" ? addDays(cur, 1) : g === "week" ? addDays(cur, 7) : addMonths(`${cur}-01`, 1).slice(0, 7);
  }
  return out;
}

export function pickGranularity(from: string, to: string): Granularity {
  const days = diffDays(to, from);
  if (days <= 45) return "day";
  if (days <= 200) return "week";
  return "month";
}

export function bucketLabel(b: string, g: Granularity): string {
  if (g === "month") {
    const [y, m] = b.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  return new Date(`${b}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export interface DateRange {
  from: string; // inclusive YYYY-MM-DD (org tz)
  to: string; // inclusive
}

export type RangePreset = "7d" | "30d" | "90d" | "mtd" | "qtd" | "ytd" | "12m" | "custom";

export function rangeFromPreset(preset: RangePreset, timeZone: string, custom?: DateRange): DateRange {
  const t = todayKey(timeZone);
  switch (preset) {
    case "7d":
      return { from: addDays(t, -6), to: t };
    case "30d":
      return { from: addDays(t, -29), to: t };
    case "90d":
      return { from: addDays(t, -89), to: t };
    case "mtd":
      return { from: `${t.slice(0, 7)}-01`, to: t };
    case "qtd": {
      const m = Number(t.slice(5, 7));
      const qm = String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0");
      return { from: `${t.slice(0, 4)}-${qm}-01`, to: t };
    }
    case "ytd":
      return { from: `${t.slice(0, 4)}-01-01`, to: t };
    case "12m":
      return { from: addDays(addMonths(t, -12), 1), to: t };
    case "custom":
      return custom ?? { from: addDays(t, -29), to: t };
  }
}

/** The equally long range immediately before `r`, for period-over-period comparison. */
export function previousRange(r: DateRange): DateRange {
  const len = diffDays(r.to, r.from) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

export function formatDate(iso: string, timeZone: string, withTime = false): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleString("en-US", {
    timeZone: iso.length === 10 ? "UTC" : timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}
