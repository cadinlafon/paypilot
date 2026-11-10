import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, CircleDashed, XCircle, RefreshCw, Unplug, PlugZap, Database, Bot, Mail, HardDrive, Coins, Lock, FlaskConical, AlertTriangle, Webhook, Flame } from "lucide-react";
import { useCollection, useWorkspace } from "@/context/WorkspaceContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Form";
import { PayPalConnectForm, emptyPayPalCredentials, validPayPalCredentials, type PayPalCredentials } from "@/components/paypal/PayPalConnectForm";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Dialog, ConfirmDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { callFn } from "@/lib/firebase";
import { firebaseConfig, firebaseConfigured, useEmulators } from "@/lib/config";
import { AI_MODELS } from "@/lib/defaults";
import type { SyncInterval } from "@shared/types";
import { formatDate } from "@shared/dates";
import { bytes, cn, errorMessage, relativeTime } from "@/lib/utils";

interface ServerStatus {
  openrouter: { configured: boolean; defaultModel: string; allowedModels: string[] };
  emailjs: { configured: boolean; serviceId?: string; publicKey?: string; templates: Record<string, string | undefined> };
  b2: { configured: boolean; bucketName?: string };
  fx: { provider: string; ok: boolean; lastUpdate?: string; error?: string };
  paypal: { liveOnboardingEnabled: boolean; webhookUrl: string };
}

const SYNC: { id: SyncInterval; label: string }[] = [
  { id: "15m", label: "Every 15 minutes" },
  { id: "30m", label: "Every 30 minutes" },
  { id: "1h", label: "Hourly" },
  { id: "6h", label: "Every 6 hours" },
  { id: "24h", label: "Daily" },
  { id: "manual", label: "Manual only" },
];

type State = "ok" | "off" | "error" | "demo";
function Dot({ s }: { s: State }) {
  if (s === "ok") return <CheckCircle2 className="size-4 text-accent" />;
  if (s === "error") return <XCircle className="size-4 text-danger" />;
  if (s === "demo") return <FlaskConical className="size-4 text-amber-300" />;
  return <CircleDashed className="size-4 text-faint" />;
}

function IntegrationCard({ icon, title, subtitle, state, stateLabel, children, actions, className }: { icon: ReactNode; title: string; subtitle: string; state: State; stateLabel: string; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-start gap-3 p-5">
        <span className="grid grid-cols-1 place-items-center size-10 rounded-xl border border-line bg-surface-2 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted mt-0.5">{subtitle}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted whitespace-nowrap"><Dot s={state} />{stateLabel}</span>
      </div>
      {children && <div className="px-5 pb-4 text-sm space-y-2 flex-1">{children}</div>}
      {actions && <div className="flex flex-wrap gap-2 px-5 py-3 border-t border-line">{actions}</div>}
    </Card>
  );
}
const KV = ({ k, v }: { k: string; v: ReactNode }) => <div className="flex justify-between gap-4 text-xs"><span className="text-muted">{k}</span><span className="text-right truncate">{v}</span></div>;

export default function Integrations() {
  const { mode, org, paypal, repo, can, orgId } = useWorkspace();
  const toast = useToast();
  const syncRuns = useCollection("syncRuns").rows;
  const webhooks = useCollection("webhookEvents").rows;
  const emailLogs = useCollection("emailLogs").rows;
  const files = useCollection("files").rows;
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const manage = can("integrations.manage");
  const demo = mode === "demo";
  const tz = org?.timezone ?? "UTC";

  useEffect(() => {
    if (demo || !firebaseConfigured || !orgId) return;
    callFn<object, ServerStatus>("integrationStatus", { orgId }).then(setStatus).catch((e) => setStatusError(errorMessage(e)));
  }, [demo, orgId]);

  const sync = async (kind: "manual" | "reconciliation") => {
    setBusy(kind);
    try {
      toast.result(await repo!.syncNow(kind), kind === "manual" ? "Sync started" : "Reconciliation started");
    } catch (e) {
      toast.error("Sync failed", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await callFn("paypalDisconnect", { orgId, environment: paypal?.environment ?? "sandbox" });
      toast.success("PayPal disconnected", "Credentials were deleted. Previously synced records are kept.");
      setDisconnectOpen(false);
    } catch (e) {
      toast.error("Couldn't disconnect", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const connected = paypal?.status === "connected";
  const failedWebhooks = webhooks.filter((w) => w.status === "failed");
  const storage = files.filter((f) => !f.isSample).reduce((a, f) => a + f.size, 0);

  return (
    <div>
      <PageHeader title="Integrations" description={demo ? "Demo Mode doesn't connect to any external service. Statuses below describe what's simulated." : "Connections for this organization. Secrets are stored server-side and never sent to the browser."} />
      {!manage && <div className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted"><Lock className="size-4" />You can view integrations, but only roles with “Manage integrations” can change them.</div>}
      {statusError && <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/5 px-4 py-3 text-sm text-rose-200"><AlertTriangle className="size-4" />Couldn't reach Cloud Functions: {statusError}. Integration statuses may be incomplete.</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IntegrationCard
          className="lg:col-span-2"
          icon={<PlugZap className="size-5 text-sky-300" />}
          title="PayPal"
          subtitle="Transactions, invoicing, subscriptions, checkout links, refunds, captures and webhooks."
          state={demo ? "demo" : connected ? "ok" : paypal?.status === "error" ? "error" : "off"}
          stateLabel={demo ? "Not used in Demo" : connected ? `${paypal!.environment === "live" ? "Live" : "Sandbox"} connected` : paypal?.status === "error" ? "Error" : "Not connected"}
          actions={
            !demo && manage && (
              <>
                {connected ? (
                  <>
                    <Button size="sm" icon={<RefreshCw className={cn("size-3.5", busy === "manual" && "animate-spin")} />} loading={busy === "manual"} onClick={() => sync("manual")}>Sync now</Button>
                    <Button size="sm" loading={busy === "reconciliation"} onClick={() => sync("reconciliation")}>Reconcile 90 days</Button>
                    <Button size="sm" variant="ghost" icon={<Unplug className="size-3.5" />} onClick={() => setDisconnectOpen(true)}>Disconnect</Button>
                  </>
                ) : (
                  <Button size="sm" variant="primary" disabled={!firebaseConfigured} onClick={() => setConnectOpen(true)}>Connect PayPal</Button>
                )}
                {connected && paypal!.environment === "sandbox" && <Button size="sm" variant="ghost" onClick={() => setConnectOpen(true)}>Switch to Live…</Button>}
              </>
            )
          }
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-faint uppercase tracking-wide mb-2">Connection</div>
              <KV k="Environment" v={demo ? "—" : connected ? <Badge tone={paypal!.environment === "live" ? "green" : "blue"}>{paypal!.environment}</Badge> : "None"} />
              <KV k="Account" v={paypal?.accountEmail ?? paypal?.merchantId ?? "—"} />
              <KV k="Connected" v={paypal?.connectedAt ? formatDate(paypal.connectedAt, tz) : "—"} />
              <KV k="Webhooks" v={paypal ? <StatusBadge status={paypal.webhookStatus === "active" ? "active" : paypal.webhookStatus === "error" ? "error" : "disabled"} label={paypal.webhookStatus.replace("_", " ")} /> : "—"} />
              {paypal?.capabilities && <KV k="Capabilities" v={Object.entries(paypal.capabilities).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"} />}
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-faint uppercase tracking-wide mb-2">Synchronization</div>
              <KV k="Last sync" v={paypal?.lastSyncAt ? relativeTime(paypal.lastSyncAt) : "Never"} />
              <KV k="Status" v={paypal?.lastSyncStatus ? <StatusBadge status={paypal.lastSyncStatus} /> : "—"} />
              {paypal?.lastSyncError && <p className="text-xs text-rose-300">{paypal.lastSyncError}</p>}
              <div className="pt-1">
                <Select aria-label="Sync interval" className="h-8 text-xs" disabled={demo || !manage} value={org?.settings.syncInterval ?? "1h"} onChange={(e) => repo!.updateOrg({ settings: { ...org!.settings, syncInterval: e.target.value as SyncInterval } }).then(() => toast.success("Sync interval updated")).catch((er) => toast.error("Couldn't save", errorMessage(er)))}>
                  {SYNC.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
                <p className="text-[11px] text-faint mt-1">Webhooks deliver events in real time regardless of this interval.</p>
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-faint uppercase tracking-wide mb-2">Recent activity</div>
              {syncRuns.length || webhooks.length ? (
                <ul className="space-y-1.5 text-xs max-h-40 overflow-y-auto">
                  {syncRuns.slice(0, 6).map((s) => <li key={s.id} className="flex justify-between gap-2"><span className="text-muted truncate">{s.kind} sync · {s.itemsUpserted} records</span><StatusBadge status={s.status} /></li>)}
                  {webhooks.slice(0, 6).map((w) => <li key={w.id} className="flex justify-between gap-2"><span className="text-muted truncate inline-flex items-center gap-1"><Webhook className="size-3" />{w.eventType}</span><StatusBadge status={w.status} /></li>)}
                </ul>
              ) : <p className="text-xs text-muted">{demo ? "Demo data is generated locally." : "No sync history yet."}</p>}
              {failedWebhooks.length > 0 && <p className="mt-2 text-xs text-rose-300">{failedWebhooks.length} webhook event(s) failed processing — they're retried automatically.</p>}
            </div>
          </div>
          {!demo && (
            <div className="mt-4 rounded-lg border border-line bg-surface-2/50 p-3 text-xs text-muted leading-relaxed">
              <strong className="text-fg">Sandbox vs Live:</strong> Sandbox uses PayPal's test money; Live uses your real PayPal business account via a Live REST app's credentials. Credentials are stored separately per environment, and when both are connected PayPilot uses Live. Connecting <em>other</em> businesses' accounts on their behalf would additionally need PayPal partner approval.
            </div>
          )}
        </IntegrationCard>

        <IntegrationCard icon={<Flame className="size-5 text-orange-300" />} title="Firebase" subtitle="Authentication, Firestore database and Cloud Functions." state={firebaseConfigured ? "ok" : "off"} stateLabel={firebaseConfigured ? "Configured" : "Not configured"}>
          <KV k="Project" v={firebaseConfig.projectId ?? "—"} />
          <KV k="Authentication" v={firebaseConfigured ? "Email/password, Google" : "Unavailable"} />
          <KV k="Database" v={firebaseConfigured ? "Cloud Firestore (org-scoped, rules enforced)" : "—"} />
          <KV k="Backend services" v={status ? <span className="text-accent-strong">Cloud Functions reachable</span> : firebaseConfigured && !demo ? (statusError ? <span className="text-rose-300">Unreachable</span> : "Checking…") : "—"} />
          {useEmulators && <Badge tone="violet">Using local emulators</Badge>}
        </IntegrationCard>

        <IntegrationCard icon={<Bot className="size-5 text-violet-300" />} title="OpenRouter" subtitle="Server-side AI requests with tool calling." state={demo ? "demo" : status?.openrouter.configured ? "ok" : status ? "off" : "off"} stateLabel={demo ? "Simulated in Demo" : status?.openrouter.configured ? "Connected" : "API key not set"}>
          <KV k="API key" v={demo ? "Not used" : status?.openrouter.configured ? "Stored as server secret" : "Missing — set OPENROUTER_API_KEY"} />
          <KV k="Default model" v={status?.openrouter.defaultModel ?? "—"} />
          <div className="flex items-center justify-between gap-3 text-xs pt-1">
            <span className="text-muted">Organization model</span>
            <Select aria-label="AI model" className="h-8 text-xs w-48" disabled={!can("settings.manage")} value={org?.settings.ai.model} onChange={(e) => repo!.updateOrg({ settings: { ...org!.settings, ai: { ...org!.settings.ai, model: e.target.value } } }).then(() => toast.success("Model updated"))}>{AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
          </div>
          <KV k="Monthly token budget" v={org?.settings.ai.monthlyTokenBudget.toLocaleString()} />
        </IntegrationCard>

        <IntegrationCard icon={<Mail className="size-5 text-sky-300" />} title="EmailJS" subtitle="Invoice emails, reminders and notifications — only after approval." state={demo ? "demo" : status?.emailjs.configured ? "ok" : "off"} stateLabel={demo ? "Simulated in Demo" : status?.emailjs.configured ? "Connected" : "Not configured"}>
          <KV k="Service ID" v={status?.emailjs.serviceId ?? "—"} />
          <KV k="Public key" v={status?.emailjs.publicKey ? `${status.emailjs.publicKey.slice(0, 4)}…` : "—"} />
          <KV k="Private key" v={demo ? "Not used" : status?.emailjs.configured ? "Stored as server secret" : "Missing"} />
          {status && Object.entries(status.emailjs.templates).map(([k, v]) => <KV key={k} k={`Template · ${k}`} v={v ?? <span className="text-faint">not set</span>} />)}
          <div className="pt-2">
            <div className="text-xs text-faint mb-1">Sending history</div>
            {emailLogs.length ? <ul className="space-y-1 max-h-32 overflow-y-auto">{emailLogs.slice(0, 8).map((e) => <li key={e.id} className="flex justify-between gap-2 text-xs"><span className="truncate text-muted">{e.to} · {e.subject}</span><StatusBadge status={e.status} /></li>)}</ul> : <p className="text-xs text-muted">No emails yet.</p>}
          </div>
        </IntegrationCard>

        <IntegrationCard icon={<HardDrive className="size-5 text-red-300" />} title="Backblaze B2" subtitle="Private storage for receipts, attachments and documents." state={demo ? "demo" : status?.b2.configured ? "ok" : "off"} stateLabel={demo ? "Browser-only in Demo" : status?.b2.configured ? "Connected" : "Not configured"}>
          <KV k="Bucket" v={status?.b2.bucketName ?? "—"} />
          <KV k="Access" v="Private · server-authorized uploads · 5-minute signed downloads" />
          <KV k="Storage used" v={`${bytes(storage)} · ${files.filter((f) => !f.isSample).length} file(s)`} />
          <div className="pt-2">
            <div className="text-xs text-faint mb-1">Recent files</div>
            {files.length ? <ul className="space-y-1 max-h-28 overflow-y-auto">{files.slice(0, 6).map((f) => <li key={f.id} className="flex justify-between gap-2 text-xs"><span className="truncate text-muted">{f.name}</span><span className="text-faint">{bytes(f.size)}{f.isSample ? " · sample" : ""}</span></li>)}</ul> : <p className="text-xs text-muted">No files.</p>}
          </div>
        </IntegrationCard>

        <IntegrationCard icon={<Coins className="size-5 text-amber-300" />} title="Exchange rates" subtitle="Historical rates for consolidated multi-currency reporting." state={demo ? "demo" : status?.fx.ok ? "ok" : status ? "error" : "off"} stateLabel={demo ? "Sample rates" : status?.fx.ok ? "Operational" : status ? "Error" : "Unknown"}>
          <KV k="Provider" v={demo ? "Sample rates (demo)" : status?.fx.provider ?? "—"} />
          <KV k="Reporting currency" v={org?.reportingCurrency} />
          <KV k="Last rate update" v={status?.fx.lastUpdate ? formatDate(status.fx.lastUpdate, tz, true) : "—"} />
          {status?.fx.error && <p className="text-xs text-rose-300">{status.fx.error}</p>}
          <p className="text-[11px] text-faint">Rates are stored per organization with provider and timestamp. Conversions without a same-day rate are marked “estimated”.</p>
        </IntegrationCard>

        <IntegrationCard icon={<Database className="size-5 text-muted" />} title="Webhook endpoint" subtitle="Where PayPal sends real-time events for this organization." state={demo ? "demo" : paypal?.webhookStatus === "active" ? "ok" : "off"} stateLabel={demo ? "Not used" : paypal?.webhookStatus === "active" ? "Receiving" : "Not registered"}>
          <KV k="URL" v={<span className="font-mono">{status?.paypal.webhookUrl ? `${status.paypal.webhookUrl}?org=${orgId}` : "—"}</span>} />
          <KV k="Verification" v="PayPal signature verified on every event" />
          <KV k="Deduplication" v="By PayPal event ID" />
          <KV k="Events received" v={webhooks.length} />
        </IntegrationCard>
      </div>

      <ConnectPayPal open={connectOpen} onClose={() => setConnectOpen(false)} />
      <ConfirmDialog open={disconnectOpen} onClose={() => setDisconnectOpen(false)} onConfirm={disconnect} loading={busy === "disconnect"} danger title="Disconnect PayPal?" description="Stored credentials are deleted and the webhook is removed. Synced transactions stay in PayPilot. You can reconnect any time." confirmLabel="Disconnect" />
    </div>
  );
}

function ConnectPayPal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { orgId } = useWorkspace();
  const toast = useToast();
  const [creds, setCreds] = useState<PayPalCredentials>(emptyPayPalCredentials());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setCreds(emptyPayPalCredentials());
      setError(null);
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Connect PayPal"
      footer={
        <>
          {error && <p className="text-sm text-rose-300 sm:mr-auto self-center" role="alert">{error}</p>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!validPayPalCredentials(creds)}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await callFn<object, { ok: boolean; message: string }>("paypalConnect", { orgId, environment: creds.environment, clientId: creds.clientId.trim(), clientSecret: creds.clientSecret.trim() });
                setCreds(emptyPayPalCredentials(creds.environment));
                toast.success(`PayPal ${creds.environment === "live" ? "Live" : "Sandbox"} connected`, r.message);
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Verify & connect {creds.environment === "live" ? "Live" : "Sandbox"}
          </Button>
        </>
      }
    >
      <PayPalConnectForm value={creds} onChange={setCreds} />
    </Dialog>
  );
}
