import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Plus, Send, Wrench, CheckCircle2, MessageSquare, FlaskConical, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { useCollection, useWorkspace } from "@/context/WorkspaceContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Form";
import { Badge } from "@/components/ui/Badge";
import { SpecChart } from "@/components/ui/Charts";
import { EmptyState } from "@/components/ui/Feedback";
import { ApprovalCard } from "@/components/approvals/ApprovalCenter";
import { useToast } from "@/components/ui/Toast";
import { AI_MODELS } from "@/lib/defaults";
import type { AiConversation, AiMessage } from "@shared/types";
import { cn, errorMessage, relativeTime } from "@/lib/utils";

const SUGGESTIONS = [
  "Give me today's briefing",
  "How much revenue did we make this month?",
  "Which invoices are overdue?",
  "Find unusual transactions",
  "Generate a business report for the last 90 days",
  "Explain our failed payments",
  "Recommend automations for us",
  "Suggest ways to improve the business",
];

export default function Assistant() {
  const { repo, mode, org, can } = useWorkspace();
  const toast = useToast();
  const convs = useCollection("aiConversations");
  const approvals = useCollection("approvals").rows;
  const [params, setParams] = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [model, setModel] = useState(org?.settings.ai.model ?? AI_MODELS[0].id);
  const scroller = useRef<HTMLDivElement>(null);
  const handledPrompt = useRef<string | null>(null);
  const active = convs.rows.find((c) => c.id === activeId) ?? null;
  const aiOff = mode === "real" && org && !org.settings.ai.enabled;

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || !repo || sending) return;
    setSending(msg);
    setInput("");
    try {
      const r = await repo.aiChat(activeId, msg, model);
      setActiveId(r.conversationId);
    } catch (e) {
      toast.error("The assistant couldn't respond", errorMessage(e));
      setInput(msg);
    } finally {
      setSending(null);
    }
  };

  useEffect(() => {
    const p = params.get("prompt");
    if (p && repo && handledPrompt.current !== p) {
      handledPrompt.current = p;
      setParams({}, { replace: true });
      setActiveId(null);
      void send(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, repo]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, sending]);

  const usage = useMemo(() => {
    let p = 0, c = 0;
    for (const conv of convs.rows) for (const m of conv.messages) if (m.usage) { p += m.usage.promptTokens; c += m.usage.completionTokens; }
    return { p, c };
  }, [convs.rows]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr] h-[calc(100dvh-10.5rem)]">
      <Card className="hidden lg:flex flex-col overflow-hidden">
        <div className="p-3 border-b border-line">
          <Button variant="primary" className="w-full justify-center" icon={<Plus className="size-4" />} onClick={() => setActiveId(null)}>New chat</Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {convs.rows.length === 0 && <p className="p-3 text-xs text-faint">No conversations yet.</p>}
          {convs.rows.map((c) => (
            <button key={c.id} onClick={() => setActiveId(c.id)} className={cn("w-full text-left rounded-lg px-2.5 py-2 text-sm flex gap-2", c.id === activeId ? "bg-surface-3" : "hover:bg-surface-2 text-muted")}>
              <MessageSquare className="size-4 shrink-0 mt-0.5" />
              <span className="min-w-0"><span className="block truncate">{c.title}</span><span className="block text-[11px] text-faint">{relativeTime(c.updatedAt)}</span></span>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-line text-[11px] text-faint space-y-1">
          <div className="flex justify-between"><span>Usage (tokens)</span><span className="tabular">{(usage.p + usage.c).toLocaleString()}</span></div>
          {mode === "real" && org && <div className="flex justify-between"><span>Monthly budget</span><span className="tabular">{org.settings.ai.monthlyTokenBudget.toLocaleString()}</span></div>}
          {mode === "demo" && <div>Demo assistant is simulated — no tokens used.</div>}
        </div>
      </Card>

      <Card className="flex flex-col overflow-hidden min-h-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
          <div className="grid grid-cols-1 place-items-center size-8 rounded-lg bg-accent-soft text-accent"><Bot className="size-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold flex items-center gap-2">PayPilot Assistant {mode === "demo" ? <Badge tone="amber"><FlaskConical className="size-3" />Simulated AI · sample data</Badge> : <Badge tone="green">OpenRouter</Badge>}</div>
            <div className="text-xs text-muted truncate">Analyzes and drafts freely. External actions always need your approval.</div>
          </div>
          {mode === "real" ? (
            <Select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} className="w-auto max-w-48 h-8 text-xs">
              {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>
          ) : null}
          <Button size="sm" variant="ghost" className="lg:hidden" icon={<Plus className="size-4" />} onClick={() => setActiveId(null)}>New</Button>
        </div>

        <div ref={scroller} className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6">
          {aiOff ? (
            <EmptyState icon={<AlertCircle className="size-5" />} title="AI assistant is disabled" description="An administrator turned the assistant off for this organization in Settings → AI." />
          ) : !active && !sending ? (
            <div className="max-w-2xl mx-auto pt-6">
              <div className="flex items-center gap-2 text-accent"><Sparkles className="size-4" /><span className="text-sm font-medium">Ask about {org?.name}</span></div>
              <h2 className="text-lg font-semibold mt-2">What would you like to know?</h2>
              <p className="text-sm text-muted mt-1">I can answer revenue questions, analyze customers, draft invoices and emails, prepare payment links and spot unusual activity.</p>
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="text-left rounded-xl border border-line bg-surface-2/40 px-3.5 py-2.5 text-sm text-muted hover:text-fg hover:border-line-strong transition-colors">{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {active?.messages.map((m) => <Message key={m.id} m={m} approvals={approvals} />)}
              {sending && (
                <>
                  <Message m={{ id: "pending", role: "user", content: sending, createdAt: new Date().toISOString() }} approvals={[]} />
                  <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin text-accent" /> Running tools and analyzing your data…</div>
                </>
              )}
            </>
          )}
        </div>

        <form
          className="border-t border-line p-3 sm:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={aiOff ? "AI assistant is disabled" : "Ask anything about your business…"}
              rows={1}
              className="min-h-10 max-h-40"
              disabled={!!aiOff || !can("ai.use")}
              aria-label="Message"
            />
            <Button type="submit" variant="primary" size="icon" disabled={!input.trim() || !!sending || !!aiOff} aria-label="Send"><Send className="size-4" /></Button>
          </div>
          <p className="mt-2 text-[11px] text-faint">AI output can be wrong. It is not financial, accounting or tax advice. {mode === "demo" ? "Demo answers come from sample data." : "Conversations are stored in your organization for audit."}</p>
        </form>
      </Card>
    </div>
  );
}

function Message({ m, approvals }: { m: AiMessage; approvals: ReturnType<typeof useCollection<"approvals">>["rows"] }) {
  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5 text-sm whitespace-pre-wrap">{m.content}</div>
      </div>
    );
  const acts = (m.actionIds ?? []).map((id) => approvals.find((a) => a.id === id)).filter(Boolean);
  return (
    <div className="flex gap-3 max-w-3xl">
      <div className="grid grid-cols-1 place-items-center size-7 rounded-lg bg-accent-soft text-accent shrink-0 mt-0.5"><Bot className="size-3.5" /></div>
      <div className="min-w-0 flex-1 space-y-3">
        {!!m.toolCalls?.length && (
          <div className="flex flex-wrap gap-1.5">
            {m.toolCalls.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-muted" title={JSON.stringify(t.args)}>
                <Wrench className="size-3" />
                <span className="font-mono">{t.name}</span>
                {t.status === "done" ? <CheckCircle2 className="size-3 text-accent" /> : t.status === "error" ? <AlertCircle className="size-3 text-danger" /> : <Loader2 className="size-3 animate-spin" />}
                <span className="hidden sm:inline text-faint">· {t.summary}</span>
              </span>
            ))}
          </div>
        )}
        {m.error ? (
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3 text-sm text-rose-200">{m.error}</div>
        ) : (
          <div className="md text-muted">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
          </div>
        )}
        {m.charts?.map((c, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface-2/40 p-4">
            <div className="text-xs font-medium text-muted mb-3">{c.title}</div>
            <SpecChart spec={c} />
          </div>
        ))}
        {acts.map((a) => <ApprovalCard key={a!.id} a={a!} />)}
        {m.usage && m.usage.model !== "simulated-demo" && <div className="text-[10px] text-faint">{m.usage.model} · {m.usage.promptTokens + m.usage.completionTokens} tokens</div>}
      </div>
    </div>
  );
}

export type { AiConversation };
