import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, XCircle, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "success" | "error" | "info" | "warning" | "demo";
interface T { id: number; kind: Kind; title: string; body?: string }
const Ctx = createContext<((kind: Kind, title: string, body?: string) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((kind: Kind, title: string, body?: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, title, body }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 7000 : 4500);
  }, []);
  const icon = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle, demo: FlaskConical };
  const color = { success: "text-accent", error: "text-danger", info: "text-info", warning: "text-warn", demo: "text-demo" };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed z-[60] bottom-4 right-4 left-4 sm:left-auto sm:w-96 flex flex-col gap-2 pointer-events-none" aria-live="polite">
        {items.map((t) => {
          const I = icon[t.kind];
          return (
            <div key={t.id} className="pointer-events-auto flex gap-3 rounded-xl border border-line-strong bg-surface-2/95 backdrop-blur px-4 py-3 shadow-xl animate-slide-up">
              <I className={cn("size-4 mt-0.5 shrink-0", color[t.kind])} />
              <div className="min-w-0">
                <p className="text-sm font-medium">{t.title}</p>
                {t.body && <p className="text-xs text-muted mt-0.5 break-words">{t.body}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  if (!push) throw new Error("useToast outside ToastProvider");
  return {
    success: (t: string, b?: string) => push("success", t, b),
    error: (t: string, b?: string) => push("error", t, b),
    info: (t: string, b?: string) => push("info", t, b),
    warning: (t: string, b?: string) => push("warning", t, b),
    demo: (t: string, b?: string) => push("demo", t, b),
    /** Show an ActionResult from the repository. */
    result: (r: { ok: boolean; message: string; simulated?: boolean }, okTitle = "Done") => push(r.ok ? (r.simulated ? "demo" : "success") : "error", r.ok ? (r.simulated ? `${okTitle} (simulated)` : okTitle) : "Action failed", r.message),
  };
}
