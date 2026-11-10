/**
 * PayPilot API on Cloudflare Workers (free plan).
 *
 * Runs the SAME server code as functions/ (Firebase Functions) by aliasing
 * the firebase-* imports to the shims in ./shims (see wrangler.toml):
 *   POST /api/call/<name>      callable functions (Firebase ID token in Authorization)
 *   POST /api/paypal/webhook   PayPal webhooks (signature-verified)
 *   GET  /api/pay/<org>/<link> payment-link checkout → PayPal
 *   GET  /api/pay-return       PayPal return → capture
 *   GET  /api/health
 * Cron Triggers replace Cloud Scheduler; the change sweeper replaces Firestore triggers.
 * Everything else is served from the built web app (../dist).
 */
import * as fns from "../../functions/src/index";
import { HttpsError, HTTP_STATUS, WorkerResponse, type CallableRequest } from "./shims/https";
import { setEnv, type Env } from "./runtime";
import { verifyIdToken } from "./auth";
import { sweep } from "./sweep";
import { startBudget, remaining, spend } from "../../functions/src/lib/budget";
import { getFirestore } from "./shims/firestore";
import { requireAuth, rateLimit } from "../../functions/src/lib/guard";

// Count every outbound request against the per-invocation subrequest budget.
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  spend(1);
  return realFetch(input, init);
}) as typeof fetch;

type Any = ((...a: any[]) => any) & { __kind?: string; schedule?: string; pattern?: string; event?: string };
const all = Object.entries(fns as unknown as Record<string, Any>);
const callables = new Map(all.filter(([, f]) => f.__kind === "callable"));
const triggers = all.filter(([, f]) => f.__kind === "trigger").map(([, f]) => f) as any[];
const schedules = all.filter(([, f]) => f.__kind === "schedule");

const BUDGET = 46; // Workers free plan: 50 subrequests per invocation; keep a margin.

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Max-Age": "600", Vary: "Origin" };
}

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

async function handleCallable(name: string, req: Request, h: Record<string, string>, ctx: ExecutionContext) {
  const fn = callables.get(name);
  if (!fn && name !== "sweepNow") return json({ error: { status: "not-found", message: "Unknown function" } }, 404, h);
  if (req.method !== "POST") return json({ error: { status: "invalid-argument", message: "POST required" } }, 405, h);
  if (Number(req.headers.get("content-length") ?? 0) > 12 * 1024 * 1024) return json({ error: { status: "invalid-argument", message: "Request too large" } }, 413, h);
  let body: { data?: unknown };
  try {
    body = (await req.json()) as { data?: unknown };
  } catch {
    return json({ error: { status: "invalid-argument", message: "Invalid JSON" } }, 400, h);
  }
  const cr: CallableRequest = { data: body?.data ?? {}, rawRequest: req };
  const bearer = /^Bearer (.+)$/.exec(req.headers.get("Authorization") ?? "")?.[1];
  if (bearer) {
    try {
      cr.auth = await verifyIdToken(bearer);
    } catch {
      return json({ error: { status: "unauthenticated", message: "Your session is invalid or expired. Sign in again." } }, 401, h);
    }
  }
  try {
    let result: unknown;
    if (name === "sweepNow") {
      // Client nudge after it writes customers/expenses directly, so automations and FX run promptly.
      const u = requireAuth(cr as any);
      await rateLimit(`sweep_${u.uid}`, 30, 600);
      await sweep(triggers);
      result = { ok: true };
    } else result = await fn!(cr);
    if (remaining() > 15) ctx.waitUntil(sweep(triggers).catch((e) => console.error("post-call sweep", e)));
    return json({ result: result ?? null }, 200, h);
  } catch (e) {
    if (e instanceof HttpsError) return json({ error: { status: e.code, message: e.message } }, HTTP_STATUS[e.code] ?? 500, h);
    console.error(`callable ${name} failed`, e);
    return json({ error: { status: "internal", message: "The operation failed." } }, 500, h);
  }
}

async function handleRequest(fn: Any, req: Request, url: URL, ctx: ExecutionContext) {
  let body: unknown = undefined;
  if (req.method === "POST") {
    const text = await req.text();
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
  }
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  const res = new WorkerResponse();
  await fn({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body }, res);
  if (remaining() > 15) ctx.waitUntil(sweep(triggers).catch((e) => console.error("post-request sweep", e)));
  return res.toResponse();
}

/** Map Firebase schedule strings to the Cron Triggers declared in wrangler.toml. */
function due(schedule: string, cron: string, at: Date): boolean {
  const s = schedule.toLowerCase();
  if (s === "every 15 minutes") return cron === "*/15 * * * *";
  if (s === "every 30 minutes") return cron === "*/15 * * * *" && at.getUTCMinutes() % 30 < 15;
  if (s === "every 60 minutes" || s === "every 1 hours") return cron === "0 * * * *";
  if (s.startsWith("every day")) return cron === "30 3 * * *";
  return false;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setEnv(env);
    startBudget(BUDGET);
    const url = new URL(req.url);
    const h = cors(req, env);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    try {
      if (url.pathname === "/api/health") {
        // ?deep=1 also proves the service account can reach Firestore (returns only booleans).
        let firestore: boolean | undefined;
        if (url.searchParams.get("deep") === "1") firestore = await getFirestore().collection("_system").doc("sweep").get().then(() => true, (e) => (console.error("health", e), false));
        return json({ ok: true, functions: callables.size, triggers: triggers.length, schedules: schedules.length, firestore }, 200, h);
      }
      const call = /^\/api\/call\/([A-Za-z0-9_]+)$/.exec(url.pathname);
      if (call) return await handleCallable(call[1], req, h, ctx);
      if (url.pathname === "/api/paypal/webhook") return await handleRequest(fns.paypalWebhook as Any, req, url, ctx);
      if (url.pathname.startsWith("/api/pay/")) return await handleRequest(fns.payLink as Any, req, url, ctx);
      if (url.pathname === "/api/pay-return") return await handleRequest(fns.payReturn as Any, req, url, ctx);
      return json({ error: { status: "not-found", message: "Not found" } }, 404, h);
    } catch (e) {
      console.error("unhandled", e);
      return json({ error: { status: "internal", message: "The operation failed." } }, 500, h);
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    setEnv(env);
    startBudget(BUDGET);
    const at = new Date(event.scheduledTime);
    const run = async () => {
      if (event.cron === "*/15 * * * *") {
        await sweep(triggers).catch((e) => console.error("sweep", e));
        // Expire old rate-limit counters (a TTL policy would need billing).
        const db = getFirestore();
        const old = await db.collection("_rateLimits").where("expiresAt", "<", new Date()).limit(200).get().catch(() => null);
        if (old && !old.empty) {
          const b = db.batch();
          old.docs.forEach((d) => b.delete(d.ref));
          await b.commit();
        }
      }
      for (const [name, fn] of schedules) {
        if (!due(fn.schedule!, event.cron, at)) continue;
        if (remaining() < 10) {
          console.warn(`skipping ${name}: subrequest budget exhausted`);
          continue;
        }
        await Promise.resolve(fn()).catch((e: unknown) => console.error(`schedule ${name}`, e));
      }
    };
    ctx.waitUntil(run());
  },
};
