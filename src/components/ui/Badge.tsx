import type { ReactNode } from "react";
import { cn, titleCase } from "@/lib/utils";

export type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "violet";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-muted border-line",
  green: "bg-accent-soft text-accent-strong border-accent/25",
  amber: "bg-demo-soft text-amber-300 border-amber-500/25",
  red: "bg-rose-500/10 text-rose-300 border-rose-500/25",
  blue: "bg-sky-500/10 text-sky-300 border-sky-500/25",
  violet: "bg-violet-500/10 text-violet-300 border-violet-500/25",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  completed: "green", paid: "green", active: "green", success: "green", executed: "green", sent: "blue", connected: "green", processed: "green",
  pending: "amber", authorized: "violet", partially_paid: "amber", partially_refunded: "amber", trialing: "blue", pending_approval: "amber", partial: "amber", test: "violet", simulated: "violet", running: "blue",
  failed: "red", denied: "red", overdue: "red", past_due: "red", error: "red", rejected: "red",
  draft: "neutral", cancelled: "neutral", refunded: "neutral", voided: "neutral", expired: "neutral", disabled: "neutral", paused: "neutral", archived: "neutral", skipped: "neutral", ignored: "neutral", open: "blue", done: "green",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"} dot>
      {label ?? titleCase(status)}
    </Badge>
  );
}
