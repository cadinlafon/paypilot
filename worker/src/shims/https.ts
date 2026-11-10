/** `firebase-functions/v2/https` stand-in. The Worker router discovers these by their `__kind`. */
export type FunctionsErrorCode =
  | "ok" | "cancelled" | "unknown" | "invalid-argument" | "deadline-exceeded" | "not-found" | "already-exists"
  | "permission-denied" | "resource-exhausted" | "failed-precondition" | "aborted" | "out-of-range"
  | "unimplemented" | "internal" | "unavailable" | "data-loss" | "unauthenticated";

export const HTTP_STATUS: Record<FunctionsErrorCode, number> = {
  ok: 200, cancelled: 499, unknown: 500, "invalid-argument": 400, "deadline-exceeded": 504, "not-found": 404, "already-exists": 409,
  "permission-denied": 403, "resource-exhausted": 429, "failed-precondition": 400, aborted: 409, "out-of-range": 400,
  unimplemented: 501, internal: 500, unavailable: 503, "data-loss": 500, unauthenticated: 401,
};

export class HttpsError extends Error {
  constructor(public code: FunctionsErrorCode, message: string, public details?: unknown) {
    super(message);
  }
}

export interface CallableRequest<T = any> {
  data: T;
  auth?: { uid: string; token: Record<string, any> };
  rawRequest?: Request;
}

type CallableHandler = (req: CallableRequest) => Promise<unknown> | unknown;
type Marked<T> = T & { __kind: "callable" };
export function onCall(handler: CallableHandler): Marked<CallableHandler>;
export function onCall(opts: object, handler: CallableHandler): Marked<CallableHandler>;
export function onCall(a: unknown, b?: CallableHandler) {
  const handler = (typeof a === "function" ? a : b) as CallableHandler;
  return Object.assign(handler, { __kind: "callable" as const });
}

/** Minimal Express-like request/response for onRequest handlers. */
export interface WorkerRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: any;
}
export class WorkerResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  bodyText = "";
  status(n: number) {
    this.statusCode = n;
    return this;
  }
  send(s: string) {
    this.bodyText = String(s);
    return this;
  }
  json(o: unknown) {
    this.headers["Content-Type"] = "application/json";
    this.bodyText = JSON.stringify(o);
    return this;
  }
  redirect(code: number, url: string) {
    this.statusCode = code;
    this.headers.Location = url;
    return this;
  }
  toResponse() {
    return new Response(this.statusCode >= 300 && this.statusCode < 400 ? null : this.bodyText, { status: this.statusCode, headers: this.headers });
  }
}
type RequestHandler = (req: WorkerRequest, res: WorkerResponse) => Promise<unknown> | unknown;
export function onRequest(handler: RequestHandler): RequestHandler & { __kind: "request" };
export function onRequest(opts: object, handler: RequestHandler): RequestHandler & { __kind: "request" };
export function onRequest(a: unknown, b?: RequestHandler) {
  const handler = (typeof a === "function" ? a : b) as RequestHandler;
  return Object.assign(handler, { __kind: "request" as const });
}
