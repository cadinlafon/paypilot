import type { ReactNode } from "react";

export function PageHeader({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted mt-1">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: "default" | "negative" | "positive" }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        {icon && <span className="text-faint">{icon}</span>}
      </div>
      <div className={`mt-2 text-lg sm:text-xl font-semibold tabular tracking-tight truncate ${tone === "negative" ? "text-rose-300" : tone === "positive" ? "text-accent-strong" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Delta({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-faint">new</span>;
  const good = invert ? value <= 0 : value >= 0;
  return <span className={good ? "text-accent-strong" : "text-rose-300"}>{value >= 0 ? "▲" : "▼"} {Math.abs(value * 100).toFixed(1)}%</span>;
}
