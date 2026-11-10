import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...v: ClassValue[]) {
  return twMerge(clsx(v));
}

export function uid(prefix = "id"): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : Math.random().toString(36).slice(2, 18);
  return `${prefix}_${rand}`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const abs = Math.abs(diff);
  const f = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "s"} ${diff >= 0 ? "ago" : "from now"}`;
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return f(Math.round(abs / 60_000), "min");
  if (abs < 86_400_000) return f(Math.round(abs / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return f(Math.round(abs / 86_400_000), "day");
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function isEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = String((e as { message: unknown }).message);
    return m.replace(/^Firebase:\s*/, "").replace(/\s*\(auth\/[a-z-]+\)\.?$/, "");
  }
  return "Something went wrong";
}
