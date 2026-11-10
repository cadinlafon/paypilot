import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Menu({ trigger, children, align = "left", className }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div role="menu" className={cn("absolute z-30 mt-1.5 min-w-52 rounded-xl border border-line-strong bg-surface-2 p-1 shadow-2xl animate-slide-up", align === "right" ? "right-0" : "left-0", className)}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, icon, active, danger, disabled }: { children: ReactNode; onClick?: () => void; icon?: ReactNode; active?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <button role="menuitem" disabled={disabled} onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-40", danger ? "text-rose-300 hover:bg-rose-500/10" : "text-fg hover:bg-surface-3", active && "bg-surface-3")}>
      {icon && <span className="text-muted">{icon}</span>}
      <span className="flex-1 min-w-0">{children}</span>
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-faint">{children}</div>;
}
