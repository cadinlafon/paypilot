import { ExternalLink, FlaskConical, ShieldCheck } from "lucide-react";
import type { PayPalEnvironment } from "@shared/types";
import { Field, Input } from "@/components/ui/Form";
import { cn } from "@/lib/utils";

export interface PayPalCredentials {
  environment: PayPalEnvironment;
  clientId: string;
  clientSecret: string;
}

export const emptyPayPalCredentials = (environment: PayPalEnvironment = "sandbox"): PayPalCredentials => ({ environment, clientId: "", clientSecret: "" });

export function validPayPalCredentials(c: PayPalCredentials) {
  return /^[A-Za-z0-9_-]{20,128}$/.test(c.clientId.trim()) && c.clientSecret.trim().length >= 20;
}

/** Environment choice + REST app credentials. Used by onboarding and the Integrations page. */
export function PayPalConnectForm({ value, onChange }: { value: PayPalCredentials; onChange: (v: PayPalCredentials) => void }) {
  const live = value.environment === "live";
  const tab = live ? "live" : "sandbox";
  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="PayPal environment" className="grid gap-2 sm:grid-cols-2">
        {([
          { id: "sandbox", title: "Sandbox", sub: "Test money — for trying things out", icon: FlaskConical, tone: "border-sky-500/50 bg-sky-500/[0.07]" },
          { id: "live", title: "Live", sub: "Real money — your actual PayPal business account", icon: ShieldCheck, tone: "border-accent/60 bg-accent-soft/50" },
        ] as const).map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value.environment === o.id}
            onClick={() => onChange({ environment: o.id, clientId: "", clientSecret: "" })}
            className={cn("flex gap-3 rounded-xl border p-3.5 text-left transition-colors", value.environment === o.id ? o.tone : "border-line hover:border-line-strong")}
          >
            <o.icon className={cn("size-4 mt-0.5 shrink-0", o.id === "live" ? "text-accent" : "text-sky-300")} />
            <span>
              <span className="block text-sm font-medium">{o.title}</span>
              <span className="block text-xs text-muted mt-0.5">{o.sub}</span>
            </span>
          </button>
        ))}
      </div>

      <ol className="text-sm text-muted space-y-1.5 list-decimal pl-5">
        <li>
          Sign in at{" "}
          <a className="text-accent-strong inline-flex items-center gap-0.5" href={`https://developer.paypal.com/dashboard/applications/${tab}`} target="_blank" rel="noreferrer noopener">
            developer.paypal.com <ExternalLink className="size-3" />
          </a>{" "}
          and open <em>Apps & Credentials</em> → the <strong className="text-fg">{live ? "Live" : "Sandbox"}</strong> tab.
        </li>
        <li>Create (or open) a REST app. Under its features, turn on Transaction Search, Invoicing and Subscriptions.</li>
        <li>Copy its <strong className="text-fg">Client ID</strong> and <strong className="text-fg">Secret</strong> below.</li>
      </ol>

      <div className="space-y-4">
        <Field label={`${live ? "Live" : "Sandbox"} Client ID`}>{(id) => <Input id={id} value={value.clientId} onChange={(e) => onChange({ ...value, clientId: e.target.value })} autoComplete="off" spellCheck={false} className="font-mono text-xs" />}</Field>
        <Field label={`${live ? "Live" : "Sandbox"} Secret`}>{(id) => <Input id={id} type="password" value={value.clientSecret} onChange={(e) => onChange({ ...value, clientSecret: e.target.value })} autoComplete="new-password" spellCheck={false} className="font-mono text-xs" />}</Field>
      </div>

      {live ? (
        <p className="rounded-lg border border-accent/30 bg-accent-soft/40 p-3 text-xs text-emerald-100/90 leading-relaxed">
          <strong>Live moves real money.</strong> Refunds, captures and payment links will use your actual PayPal account. Every one still asks for confirmation, and the AI and automations can only request them for approval.
        </p>
      ) : (
        <p className="text-[11px] text-faint">Sandbox uses PayPal's test environment. Nothing you do here affects real money.</p>
      )}
      <p className="text-[11px] text-faint">Your secret is sent once over HTTPS, verified with PayPal, encrypted and stored on the server. It's never shown again or readable from the browser.</p>
    </div>
  );
}
