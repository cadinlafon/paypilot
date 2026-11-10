import { FlaskConical, ShieldCheck, Building2 } from "lucide-react";
import type { AppMode } from "@shared/types";
import { useWorkspace } from "@/context/WorkspaceContext";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";

/**
 * The application Mode selector. Always the first thing in the app — above
 * navigation and page content — and always visible, including on mobile.
 */
export function ModeBar() {
  const { mode, requestMode, pendingMode, confirmPendingMode, org, paypalState, realBlocker } = useWorkspace();
  const demo = mode === "demo";
  return (
    <>
      <div className={cn("sticky top-0 z-30 border-b backdrop-blur", demo ? "bg-[#140f05]/92 border-amber-500/25" : "bg-[#05120d]/92 border-accent/25")}>
        <div className="flex items-center gap-3 px-3 sm:px-4 h-12">
          <div role="radiogroup" aria-label="Application mode" className="flex rounded-xl border border-line-strong bg-bg/70 p-0.5 shrink-0">
            <ModeOption value="demo" active={demo} onSelect={requestMode} />
            <ModeOption value="real" active={!demo} onSelect={requestMode} />
          </div>
          <p className={cn("hidden md:block text-xs truncate", demo ? "text-amber-200/80" : "text-emerald-200/80")}>
            {demo ? (
              <>
                <strong className="font-semibold text-amber-300">Demo Mode</strong> — sample data only. Payments, refunds and emails are simulated and never leave PayPilot.
              </>
            ) : realBlocker ? (
              <>
                <strong className="font-semibold text-accent-strong">Real Mode</strong> — set-up needed before your business data can load.
              </>
            ) : (
              <>
                <strong className="font-semibold text-accent-strong">Real Mode</strong> — your organization's actual records.
              </>
            )}
          </p>
          <div className="ml-auto flex items-center gap-2 min-w-0">
            {org && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted truncate max-w-48">
                <Building2 className="size-3.5 shrink-0" />
                <span className="truncate">{org.name}</span>
              </span>
            )}
            <EnvPill mode={mode} state={paypalState} />
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={!!pendingMode}
        onClose={() => confirmPendingMode(false)}
        onConfirm={() => confirmPendingMode(true)}
        title={`Switch to ${pendingMode === "demo" ? "Demo" : "Real"} Mode?`}
        description="You have unsaved changes on this page. Switching modes loads a completely separate set of data and your changes will be lost."
        confirmLabel="Discard & switch"
        danger
      />
    </>
  );
}

function ModeOption({ value, active, onSelect }: { value: AppMode; active: boolean; onSelect: (m: AppMode) => void }) {
  const demo = value === "demo";
  const Icon = demo ? FlaskConical : ShieldCheck;
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={() => onSelect(value)}
      className={cn(
        "flex items-center gap-1.5 rounded-[10px] px-3 sm:px-3.5 h-8 text-sm font-semibold transition-all",
        active ? (demo ? "bg-amber-400 text-[#1a1203] shadow-[0_0_18px_-4px_rgb(245_158_11/0.7)]" : "bg-accent text-[#04140d] shadow-[0_0_18px_-4px_rgb(16_185_129/0.7)]") : "text-muted hover:text-fg",
      )}
    >
      <Icon className="size-4" />
      {demo ? "Demo" : "Real"}
    </button>
  );
}

export function EnvPill({ mode, state }: { mode: AppMode; state: "not_connected" | "sandbox" | "live" }) {
  const label = mode === "demo" ? "Sample data" : state === "live" ? "PayPal Live" : state === "sandbox" ? "PayPal Sandbox" : "PayPal not connected";
  const cls =
    mode === "demo"
      ? "border-amber-500/30 text-amber-300 bg-amber-500/10"
      : state === "live"
        ? "border-accent/40 text-accent-strong bg-accent-soft"
        : state === "sandbox"
          ? "border-sky-500/30 text-sky-300 bg-sky-500/10"
          : "border-line-strong text-muted bg-surface-2";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium whitespace-nowrap", cls)} title="PayPal environment">
      <span className={cn("size-1.5 rounded-full", mode === "demo" ? "bg-amber-400" : state === "not_connected" ? "bg-faint" : state === "live" ? "bg-accent animate-pulse" : "bg-sky-400")} />
      {label}
    </span>
  );
}
