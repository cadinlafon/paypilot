/**
 * Server-side AI assistant via OpenRouter with tool calling.
 * Tools are the shared, pure implementations in shared/aiTools.ts and run
 * against this organization's data only. Tools can read and create internal
 * drafts; anything external becomes a pending approval request.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { AiConversation, AiMessage, AiToolCallTrace, ApprovalRequest, ChartSpec, Organization } from "../../../shared/types";
import { systemPrompt, toolByName, toolSchemas } from "../../../shared/aiTools";
import { db, orgCol, orgRef, nowIso, FieldValue } from "../lib/admin";
import { requireMember, rateLimit, str, safeError } from "../lib/guard";
import { loadDataset } from "../lib/dataset";
import { audit } from "../lib/audit";
import { OPENROUTER_API_KEY, OPENROUTER_ALLOWED_MODELS, OPENROUTER_DEFAULT_MODEL, ONLY_FREE_MODELS, APP_BASE_URL, secretValue } from "../lib/params";

interface ORMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** Only models with a ":free" id (zero cost on OpenRouter) unless ONLY_FREE_MODELS=false. */
const isAllowedPrice = (id: string) => ONLY_FREE_MODELS.value() === "false" || id.endsWith(":free");

async function openrouter(model: string, fallbacks: string[], messages: ORMessage[]) {
  const key = secretValue(OPENROUTER_API_KEY);
  if (!key) throw new HttpsError("failed-precondition", "The AI assistant isn't configured (OPENROUTER_API_KEY).");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": APP_BASE_URL.value(), "X-Title": "PayPilot" },
    // `models` lets OpenRouter fall back to the next free model when one is rate-limited upstream.
    body: JSON.stringify({ model, models: [model, ...fallbacks.filter((m) => m !== model)].slice(0, 3), messages, tools: toolSchemas(), tool_choice: "auto", temperature: 0.2, max_tokens: 1800 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (res.status === 402) throw new HttpsError("resource-exhausted", "The OpenRouter account is out of credits.");
  if (res.status === 429) throw new HttpsError("resource-exhausted", "The free AI models are busy or this account hit its daily free-model limit. Try again in a minute.");
  if (!res.ok) throw new HttpsError("unavailable", `The AI provider returned an error (${res.status}).`);
  return (await res.json()) as { choices: { message: ORMessage; finish_reason: string }[]; usage?: { prompt_tokens: number; completion_tokens: number }; model: string };
}

const month = () => new Date().toISOString().slice(0, 7);

export const aiChat = onCall({ secrets: [OPENROUTER_API_KEY], timeoutSeconds: 180, memory: "1GiB" }, async (req) => {
  try {
    const c = await requireMember(req, "ai.use");
    await rateLimit(`ai_${c.uid}`, 30, 600);
    const message = str(req.data?.message, "Message", { min: 1, max: 4000 });
    const org = (await orgRef(c.orgId).get()).data() as Organization;
    if (!org.settings.ai.enabled) throw new HttpsError("failed-precondition", "The AI assistant is disabled for this organization.");
    const allowed = OPENROUTER_ALLOWED_MODELS.value().split(",").map((s) => s.trim()).filter((m) => m && isAllowedPrice(m));
    const requested = typeof req.data?.model === "string" ? req.data.model : org.settings.ai.model;
    const fallbackDefault = isAllowedPrice(OPENROUTER_DEFAULT_MODEL.value()) ? OPENROUTER_DEFAULT_MODEL.value() : allowed[0];
    const model = allowed.includes(requested) ? requested : fallbackDefault;
    if (!model) throw new HttpsError("failed-precondition", "No allowed AI model is configured.");

    // Budget check
    const usageRef = orgCol(c.orgId, "analytics").doc(`aiUsage_${month()}`);
    const usage = (await usageRef.get()).data() ?? { promptTokens: 0, completionTokens: 0 };
    if (usage.promptTokens + usage.completionTokens >= org.settings.ai.monthlyTokenBudget) throw new HttpsError("resource-exhausted", "This organization reached its monthly AI token budget. An admin can raise it in Settings → AI.");

    // Conversation
    const convId = typeof req.data?.conversationId === "string" && req.data.conversationId ? str(req.data.conversationId, "Conversation", { max: 64 }) : null;
    const convRef = convId ? orgCol(c.orgId, "aiConversations").doc(convId) : orgCol(c.orgId, "aiConversations").doc();
    const existing = convId ? ((await convRef.get()).data() as AiConversation | undefined) : undefined;
    if (convId && !existing) throw new HttpsError("not-found", "Conversation not found.");
    const history = (existing?.messages ?? []).slice(-12);

    const ds = await loadDataset(c.orgId);
    const messages: ORMessage[] = [{ role: "system", content: systemPrompt(ds, "real") }, ...history.map((m) => ({ role: m.role, content: m.content }) as ORMessage), { role: "user", content: message }];
    const traces: AiToolCallTrace[] = [];
    const charts: ChartSpec[] = [];
    const actionIds: string[] = [];
    let promptTokens = 0, completionTokens = 0, final = "";

    for (let step = 0; step < 6; step++) {
      const r = await openrouter(model, allowed, messages);
      promptTokens += r.usage?.prompt_tokens ?? 0;
      completionTokens += r.usage?.completion_tokens ?? 0;
      const msg = r.choices[0].message;
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });
      if (!msg.tool_calls?.length) {
        final = msg.content ?? "";
        break;
      }
      for (const call of msg.tool_calls) {
        const tool = toolByName(call.function.name);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* leave empty */
        }
        if (!tool) {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Unknown tool" }) });
          traces.push({ name: call.function.name, args, status: "error", summary: "Unknown tool" });
          continue;
        }
        try {
          const res = tool.run(ds, args);
          if (res.charts) charts.push(...res.charts.filter((x) => x.data.length));
          for (const eff of res.effects ?? []) {
            if (eff.type === "create_invoice_draft") {
              const prefix = org.settings.invoicePrefix;
              const ref = orgCol(c.orgId, "invoices").doc();
              const number = `${prefix}${Date.now().toString().slice(-6)}`;
              await ref.set({ ...eff.invoice, id: ref.id, orgId: c.orgId, number, createdAt: nowIso(), updatedAt: nowIso(), archivedAt: null });
              await audit(c.orgId, `AI (for ${c.email})`, "Created invoice draft", number);
            } else if (eff.type === "approval") {
              const ref = orgCol(c.orgId, "aiActions").doc();
              const a: ApprovalRequest = { ...eff.approval, id: ref.id, orgId: c.orgId, status: "pending", requestedBy: "ai", conversationId: convRef.id, createdAt: nowIso() };
              await ref.set(a);
              actionIds.push(ref.id);
            }
          }
          traces.push({ name: tool.name, args, status: "done", summary: res.summary });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(res.data).slice(0, 24_000) });
        } catch (e) {
          traces.push({ name: tool.name, args, status: "error", summary: (e as Error).message.slice(0, 120) });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Tool failed" }) });
        }
      }
    }
    if (!final) final = "I gathered the data above but couldn't finish a written answer. Try asking more specifically.";

    const now = nowIso();
    const userMsg: AiMessage = { id: `u_${Date.now()}`, role: "user", content: message, createdAt: now };
    const botMsg: AiMessage = { id: `a_${Date.now()}`, role: "assistant", content: final, createdAt: now, toolCalls: traces, charts: charts.slice(0, 4), actionIds, usage: { promptTokens, completionTokens, model } };
    const conv: AiConversation = existing
      ? { ...existing, messages: [...existing.messages, userMsg, botMsg].slice(-100), updatedAt: now, model }
      : { id: convRef.id, orgId: c.orgId, title: message.slice(0, 60), model, messages: [userMsg, botMsg], createdAt: now, updatedAt: now, createdBy: c.uid };
    await convRef.set(conv);
    await usageRef.set({ month: month(), promptTokens: FieldValue.increment(promptTokens), completionTokens: FieldValue.increment(completionTokens), requests: FieldValue.increment(1) }, { merge: true });
    await db.collection("_aiAudit").add({ orgId: c.orgId, uid: c.uid, conversationId: convRef.id, tools: traces.map((t) => t.name), actionIds, model, promptTokens, completionTokens, at: now });
    return { conversationId: convRef.id };
  } catch (e) {
    throw safeError(e, "The assistant couldn't respond.");
  }
});
