/** `firebase-functions/v2/scheduler` stand-in; the Worker maps schedules to Cron Triggers. */
type Handler = (event?: unknown) => Promise<unknown> | unknown;
export function onSchedule(a: string | { schedule: string; [k: string]: unknown }, handler: Handler) {
  const schedule = typeof a === "string" ? a : a.schedule;
  return Object.assign(handler, { __kind: "schedule" as const, schedule });
}
