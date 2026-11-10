import { useState } from "react";
import { ShieldAlert, Check, X, Mail, Link2, Undo2, HandCoins, Zap, FlaskConical } from "lucide-react";
import type { ApprovalRequest } from "@shared/types";
import { formatMoney } from "@shared/money";
import { useCollection, useWorkspace } from "@/context/WorkspaceContext";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, relativeTime } from "@/lib/utils";

const ICON = { send_email: Mail, send_invoice: Mail, create_payment_link: Link2, refund: Undo2, capture: HandCoins, trigger_automation: Zap };
const PERM = { send_email: "invoices.send", send_invoice: "invoices.send", create_payment_link: "paymentLinks.create", refund: "transactions.refund", capture: "transactions.capture", trigger_automation: "automations.configure" } as const;

/** Shows exactly what will be executed, and requires an explicit human decision. */
export function ApprovalCard({ a, compact }: { a: ApprovalRequest; compact?: boolean }) {
  const { repo, mode, can } = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [showFull, setShowFull] = useState(!compact);
  const Icon = ICON[a.kind] ?? ShieldAlert;
  const p = a.payload as Record<string, any>;
  const allowed = can(PERM[a.kind]);

  const decide = async (approve: boolean) => {
    if (!repo) return;
    setBusy(approve ? "approve" : "reject");
    try {
      const r = await repo.decideApproval(a.id, approve);
      toast.result(r, approve ? "Approved & executed" : "Rejected");
    } catch (e) {
      toast.error("Couldn't complete the action", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-4">
      <div className="flex items-start gap-3">
        <div className="grid grid-cols-1 place-items-center size-8 rounded-lg bg-amber-500/15 text-amber-300 shrink-0"><Icon className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{a.title}</p>
            <StatusBadge status={a.status} label={a.status === "pending" ? "Needs approval" : undefined} />
          </div>
          <p className="text-xs text-muted mt-0.5">{a.description} · requested by {a.requestedBy === "ai" ? "AI assistant" : a.requestedBy} · {relativeTime(a.createdAt)}</p>
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-line bg-bg/60 p-3 text-xs space-y-1.5">
        {a.kind === "send_email" && (
          <>
            <Row k="To" v={`${p.toName ? `${p.toName} ` : ""}<${p.to}>`} />
            <Row k="Subject" v={p.subject} />
            <Row k="Provider" v={mode === "demo" ? "Simulated (Demo Mode — nothing is sent)" : "EmailJS"} />
            {showFull ? <pre className="mt-2 whitespace-pre-wrap font-sans text-muted leading-relaxed">{p.body}</pre> : <button className="text-accent-strong" onClick={() => setShowFull(true)}>Show full message</button>}
          </>
        )}
        {a.kind === "create_payment_link" && (
          <>
            <Row k="Amount" v={formatMoney(p.amount, p.currency)} />
            <Row k="Description" v={p.description} />
            {p.customerName && <Row k="Customer" v={p.customerName} />}
            <Row k="Creates" v={mode === "demo" ? "Sample link that cannot accept payments" : "Live PayPal checkout link in your connected environment"} />
          </>
        )}
        {(a.kind === "refund" || a.kind === "capture") && (
          <>
            <Row k="Transaction" v={p.transactionId} />
            {p.amount && <Row k="Amount" v={formatMoney(p.amount, p.currency ?? "USD")} />}
          </>
        )}
        {a.result && <Row k="Result" v={a.result} />}
      </div>
      {a.status === "pending" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={busy === "approve"} disabled={!!busy || !allowed} onClick={() => decide(true)}>
            {mode === "demo" ? "Approve (simulate)" : "Approve & execute"}
          </Button>
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} loading={busy === "reject"} disabled={!!busy} onClick={() => decide(false)}>Reject</Button>
          {!allowed && <span className="text-xs text-rose-300">Your role can't approve this action.</span>}
          {mode === "demo" && allowed && <span className="text-[11px] text-amber-300/80 inline-flex items-center gap-1"><FlaskConical className="size-3" /> Demo — no external action</span>}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-faint">{k}</span>
      <span className="text-fg break-all">{v}</span>
    </div>
  );
}

export function ApprovalCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const all = useCollection("approvals").rows;
  const [showHistory, setShowHistory] = useState(false);
  const pending = all.filter((a) => a.status === "pending");
  const history = all.filter((a) => a.status !== "pending").slice(0, 25);
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Pending approvals" description="Every external action — emails, payment links, refunds, captures — waits here for an explicit decision. Nothing runs automatically.">
      <div className="space-y-3">
        {pending.length ? pending.map((a) => <ApprovalCard key={a.id} a={a} compact />) : <EmptyState icon={<Check className="size-5 text-accent" />} title="All caught up" description="No actions are waiting for approval." />}
        {history.length > 0 && (
          <div className="pt-2">
            <button className="text-xs text-muted hover:text-fg" onClick={() => setShowHistory((s) => !s)}>{showHistory ? "Hide" : "Show"} decision history ({history.length})</button>
            {showHistory && (
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {history.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                    <span className="text-xs text-faint shrink-0">{a.decidedAt ? relativeTime(a.decidedAt) : ""}</span>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
