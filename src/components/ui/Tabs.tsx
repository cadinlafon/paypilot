import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("flex gap-1 overflow-x-auto border-b border-line", className)}>
      {items.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={cn("relative px-3 py-2 text-sm whitespace-nowrap transition-colors", value === t.id ? "text-fg" : "text-muted hover:text-fg")}>
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-faint tabular">{t.count}</span>}
          {value === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, items, size = "md" }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[]; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {items.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} aria-pressed={value === t.id} className={cn("rounded-md transition-colors whitespace-nowrap", size === "sm" ? "px-2 py-1 text-xs" : "px-2.5 py-1 text-sm", value === t.id ? "bg-surface-3 text-fg shadow-sm" : "text-muted hover:text-fg")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
