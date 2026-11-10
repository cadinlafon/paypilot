import type { ReactNode } from "react";
import { Logo } from "@/components/layout/Sidebar";
import { firebaseConfigured } from "@/lib/config";
import { ServerCog } from "lucide-react";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-dvh grid grid-cols-1 lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-center px-6 sm:px-12 py-10">
        <div className="w-full max-w-sm mx-auto">
          <Logo />
          <h1 className="mt-8 text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-1.5">{subtitle}</p>}
          {!firebaseConfigured && (
            <div className="mt-5 flex gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs text-amber-200/90">
              <ServerCog className="size-4 shrink-0 mt-0.5" />
              <span>Firebase isn't configured in this build, so accounts are unavailable. You can still explore the full Demo Mode as a guest.</span>
            </div>
          )}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-sm text-muted">{footer}</div>}
        </div>
      </div>
      <div className="hidden lg:flex relative overflow-hidden border-l border-line bg-surface">
        <div className="absolute inset-0 opacity-[0.35]" style={{ backgroundImage: "radial-gradient(circle at 70% 20%, rgb(16 185 129 / 0.25), transparent 45%)" }} />
        <div className="relative m-auto max-w-md px-10">
          <p className="text-xs uppercase tracking-[0.2em] text-accent">PayPilot</p>
          <p className="mt-3 text-2xl font-semibold leading-snug">Your PayPal money, invoices, customers and an AI analyst — in one calm dashboard.</p>
          <ul className="mt-8 space-y-3 text-sm text-muted">
            {["Gross, refunds, fees and net — never blurred together", "Every email, refund and payment link waits for your approval", "Demo and Real data kept completely separate", "Roles and permissions enforced on the server"].map((t) => (
              <li key={t} className="flex gap-2.5"><span className="mt-1.5 size-1.5 rounded-full bg-accent shrink-0" />{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.2s2.7-6.2 6-6.2c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}
