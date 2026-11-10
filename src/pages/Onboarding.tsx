import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, KeyRound, Bot, Building2, Check, FlaskConical, Globe2, Bell, PlugZap, Sparkles, Coins, Briefcase } from "lucide-react";
import { Logo } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select, Switch } from "@/components/ui/Form";
import { useAuth } from "@/context/AuthContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useToast } from "@/components/ui/Toast";
import { callFn } from "@/lib/firebase";
import { firebaseConfigured } from "@/lib/config";
import { SUPPORTED_CURRENCIES } from "@shared/money";
import { AI_MODELS, BUSINESS_TYPES, NOTIFICATION_CATEGORIES, TIMEZONES } from "@/lib/defaults";
import { cn, errorMessage } from "@/lib/utils";
import { PayPalConnectForm, emptyPayPalCredentials, validPayPalCredentials, type PayPalCredentials } from "@/components/paypal/PayPalConnectForm";

const STEPS = [
  { id: "welcome", label: "Welcome", icon: Sparkles },
  { id: "name", label: "Organization", icon: Building2 },
  { id: "business", label: "Business", icon: Briefcase },
  { id: "currency", label: "Currency", icon: Coins },
  { id: "timezone", label: "Timezone", icon: Globe2 },
  { id: "paypal", label: "Data source", icon: PlugZap },
  { id: "credentials", label: "PayPal account", icon: KeyRound },
  { id: "ai", label: "AI", icon: Bot },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "done", label: "Dashboard", icon: Check },
] as const;

export default function Onboarding() {
  const { user } = useAuth();
  const { requestMode, refreshOrgs, switchOrg } = useWorkspace();
  const nav = useNavigate();
  const toast = useToast();
  const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: "",
    businessType: BUSINESS_TYPES[0],
    industry: "",
    country: "US",
    website: "",
    reportingCurrency: "USD",
    timezone: TIMEZONES.includes(guess) ? guess : "America/New_York",
    start: "paypal" as "paypal" | "demo",
    aiEnabled: true,
    aiModel: AI_MODELS[0].id,
    notifications: Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c.id, true])) as Record<string, boolean>,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const canReal = firebaseConfigured && user && !user.isGuest;
  const [creds, setCreds] = useState<PayPalCredentials>(emptyPayPalCredentials());
  const [connectLater, setConnectLater] = useState(false);
  const step = STEPS[i].id;
  const valid = step === "name" ? f.name.trim().length >= 2 : step === "credentials" ? connectLater || validPayPalCredentials(creds) : true;
  // The credentials step only applies when connecting PayPal with a real account.
  const skips = (id: string) => id === "credentials" && (f.start !== "paypal" || !canReal);
  const go = (dir: 1 | -1) => {
    let n = i + dir;
    while (n > 0 && n < STEPS.length - 1 && skips(STEPS[n].id)) n += dir;
    setI(n);
  };

  const finish = async () => {
    if (!canReal) {
      requestMode("demo");
      nav("/");
      return;
    }
    setBusy(true);
    try {
      const res = await callFn<object, { orgId: string }>("createOrganization", {
        name: f.name.trim(),
        businessType: f.businessType,
        industry: f.industry,
        country: f.country,
        website: f.website,
        reportingCurrency: f.reportingCurrency,
        timezone: f.timezone,
        ai: { enabled: f.aiEnabled, model: f.aiModel },
        notifications: f.notifications,
      });
      refreshOrgs();
      switchOrg(res.orgId);
      requestMode(f.start === "demo" ? "demo" : "real");
      toast.success("Organization created", f.name);
      if (f.start === "paypal" && !connectLater && validPayPalCredentials(creds)) {
        try {
          const r = await callFn<object, { message: string }>("paypalConnect", { orgId: res.orgId, environment: creds.environment, clientId: creds.clientId.trim(), clientSecret: creds.clientSecret.trim() });
          setCreds(emptyPayPalCredentials(creds.environment));
          toast.success(`PayPal ${creds.environment === "live" ? "Live" : "Sandbox"} connected`, r.message);
          nav("/");
        } catch (e) {
          toast.error("Organization created, but PayPal didn't connect", `${errorMessage(e)} You can try again on the Integrations page.`);
          nav("/integrations");
        }
        return;
      }
      nav(f.start === "paypal" ? "/integrations" : "/");
    } catch (e) {
      toast.error("Couldn't create organization", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between px-6 h-16 border-b border-line">
        <Logo />
        <button className="text-sm text-muted hover:text-fg" onClick={() => { requestMode("demo"); nav("/"); }}>Skip — explore demo</button>
      </header>
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[240px_1fr]">
        <ol className="hidden lg:block border-r border-line p-6 space-y-1">
          {STEPS.map((s, idx) => (
            <li key={s.id} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm", idx === i ? "bg-surface-2 text-fg" : idx < i ? "text-muted" : "text-faint")}>
              <span className={cn("grid place-items-center size-6 rounded-full border text-[11px]", idx < i ? "bg-accent border-accent text-black" : idx === i ? "border-accent text-accent" : "border-line")}>{idx < i ? <Check className="size-3.5" /> : idx + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>
        <div className="flex items-start justify-center p-6 sm:p-10">
          <Card className="w-full max-w-xl p-6 sm:p-8 animate-slide-up" key={step}>
            <p className="text-xs text-faint mb-2 lg:hidden">Step {i + 1} of {STEPS.length}</p>
            {step === "welcome" && (
              <>
                <h1 className="text-xl font-semibold">Welcome{user?.displayName ? `, ${user.displayName.split(" ")[0]}` : ""} 👋</h1>
                <p className="text-sm text-muted mt-2 leading-relaxed">Let's set up your organization. It takes about two minutes, and you can skip integrations and connect them later from <strong className="text-fg">Integrations</strong>.</p>
                {!canReal && <p className="mt-4 text-sm rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-amber-200/90">{!firebaseConfigured ? "Firebase isn't configured, so this walkthrough will finish in Demo Mode." : "You're a guest, so this walkthrough will finish in Demo Mode. Create an account to save a real organization."}</p>}
              </>
            )}
            {step === "name" && (
              <>
                <h2 className="text-lg font-semibold">What's your organization called?</h2>
                <p className="text-sm text-muted mt-1">This appears on invoices and emails.</p>
                <Field label="Organization name" className="mt-5" required>{(id) => <Input id={id} autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Northwind Studio" maxLength={80} />}</Field>
              </>
            )}
            {step === "business" && (
              <>
                <h2 className="text-lg font-semibold">Tell us about the business</h2>
                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Business type" className="sm:col-span-2">{(id) => <Select id={id} value={f.businessType} onChange={(e) => set("businessType", e.target.value)}>{BUSINESS_TYPES.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
                  <Field label="Industry (optional)">{(id) => <Input id={id} value={f.industry} onChange={(e) => set("industry", e.target.value)} placeholder="Design, coffee, SaaS…" />}</Field>
                  <Field label="Country">{(id) => <Input id={id} value={f.country} onChange={(e) => set("country", e.target.value.toUpperCase().slice(0, 2))} placeholder="US" />}</Field>
                  <Field label="Website (optional)" className="sm:col-span-2">{(id) => <Input id={id} type="url" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" />}</Field>
                </div>
              </>
            )}
            {step === "currency" && (
              <>
                <h2 className="text-lg font-semibold">Reporting currency</h2>
                <p className="text-sm text-muted mt-1">Totals and charts are converted to this currency using historical exchange rates. Original transaction amounts are always kept.</p>
                <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <button key={c.code} onClick={() => set("reportingCurrency", c.code)} className={cn("rounded-xl border px-3 py-2.5 text-left transition-colors", f.reportingCurrency === c.code ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}>
                      <div className="text-sm font-semibold">{c.code}</div>
                      <div className="text-xs text-muted truncate">{c.name}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
            {step === "timezone" && (
              <>
                <h2 className="text-lg font-semibold">Business timezone</h2>
                <p className="text-sm text-muted mt-1">Used for daily totals, due dates and scheduled automations like the morning briefing.</p>
                <Field label="Timezone" className="mt-5">{(id) => <Select id={id} value={f.timezone} onChange={(e) => set("timezone", e.target.value)}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select>}</Field>
                <p className="text-xs text-faint mt-2">Current time there: {new Date().toLocaleString("en-US", { timeZone: f.timezone, weekday: "short", hour: "numeric", minute: "2-digit" })}</p>
              </>
            )}
            {step === "paypal" && (
              <>
                <h2 className="text-lg font-semibold">How do you want to start?</h2>
                <div className="mt-5 space-y-2">
                  <Choice active={f.start === "paypal"} onClick={() => set("start", "paypal")} icon={<PlugZap className="size-4" />} title="Connect PayPal" body="Next you'll choose Sandbox (test money) or Live (your real PayPal business account) and enter that app's credentials. You can also skip and connect later." />
                  <Choice active={f.start === "demo"} onClick={() => set("start", "demo")} icon={<FlaskConical className="size-4" />} title="Explore Demo Mode first" body="Look around with realistic sample data. Your real organization stays empty and separate until you connect PayPal." />
                </div>
              </>
            )}
            {step === "credentials" && (
              <>
                <h2 className="text-lg font-semibold">Connect your PayPal account</h2>
                <p className="text-sm text-muted mt-1 mb-5">Pick the environment, then paste the credentials from your PayPal developer app.</p>
                {connectLater ? (
                  <p className="text-sm text-muted rounded-xl border border-line p-4">No problem — you can connect PayPal any time from <strong className="text-fg">Integrations</strong>.</p>
                ) : (
                  <PayPalConnectForm value={creds} onChange={setCreds} />
                )}
                <button type="button" className="mt-4 text-xs text-muted hover:text-fg underline-offset-2 hover:underline" onClick={() => setConnectLater((v) => !v)}>
                  {connectLater ? "Enter PayPal credentials now" : "Skip — I'll connect PayPal later"}
                </button>
              </>
            )}
            {step === "ai" && (
              <>
                <h2 className="text-lg font-semibold">AI assistant</h2>
                <p className="text-sm text-muted mt-1">Requests run on PayPilot's servers through OpenRouter. The assistant can analyze and draft, but every external action needs your approval.</p>
                <div className="mt-5 flex items-center justify-between rounded-xl border border-line p-4">
                  <div><div className="text-sm font-medium">Enable AI assistant</div><div className="text-xs text-muted">You can turn this off any time in Settings.</div></div>
                  <Switch checked={f.aiEnabled} onChange={(v) => set("aiEnabled", v)} label="Enable AI" />
                </div>
                {f.aiEnabled && <Field label="Model" className="mt-4">{(id) => <Select id={id} value={f.aiModel} onChange={(e) => set("aiModel", e.target.value)}>{AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.note}</option>)}</Select>}</Field>}
              </>
            )}
            {step === "notifications" && (
              <>
                <h2 className="text-lg font-semibold">Notification preferences</h2>
                <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
                  {NOTIFICATION_CATEGORIES.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div><div className="text-sm">{c.label}</div><div className="text-xs text-muted">{c.description}</div></div>
                      <Switch checked={f.notifications[c.id]} onChange={(v) => set("notifications", { ...f.notifications, [c.id]: v })} label={c.label} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {step === "done" && (
              <>
                <h2 className="text-lg font-semibold">You're all set</h2>
                <p className="text-sm text-muted mt-2">{canReal ? <>We'll create <strong className="text-fg">{f.name || "your organization"}</strong> with you as Owner{f.start === "demo" ? " and open the demo workspace." : connectLater || !validPayPalCredentials(creds) ? " and take you to Integrations to connect PayPal." : <>, then verify and connect your PayPal <strong className="text-fg">{creds.environment === "live" ? "Live" : "Sandbox"}</strong> account.</>}</> : "We'll open the demo workspace with sample data."}</p>
              </>
            )}
            <div className="mt-8 flex items-center justify-between">
              <Button variant="ghost" icon={<ArrowLeft className="size-4" />} disabled={i === 0} onClick={() => go(-1)}>Back</Button>
              {i < STEPS.length - 1 ? (
                <Button variant="primary" disabled={!valid} onClick={() => go(1)}>Continue <ArrowRight className="size-4" /></Button>
              ) : (
                <Button variant="primary" loading={busy} onClick={finish}>Go to dashboard <ArrowRight className="size-4" /></Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Choice({ active, onClick, icon, title, body }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; body: string }) {
  return (
    <button onClick={onClick} className={cn("w-full flex gap-3 rounded-xl border p-4 text-left transition-colors", active ? "border-accent bg-accent-soft/50" : "border-line hover:border-line-strong")}>
      <span className={cn("grid place-items-center size-8 rounded-lg shrink-0", active ? "bg-accent text-black" : "bg-surface-3 text-muted")}>{icon}</span>
      <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted mt-0.5 leading-relaxed">{body}</span></span>
    </button>
  );
}
