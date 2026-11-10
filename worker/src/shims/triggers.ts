/**
 * `firebase-functions/v2/firestore` stand-in. Workers have no Firestore
 * triggers, so these handlers are invoked by the change sweeper (sweep.ts),
 * which detects created/changed documents and supplies before/after snapshots.
 */
type Snap = { exists: boolean; data(): any; ref: any; id: string };
type WrittenEvent = { params: Record<string, string>; data?: { before?: Snap; after?: Snap } };
type CreatedEvent = { params: Record<string, string>; data?: Snap };

export function onDocumentWritten(pattern: string, handler: (e: WrittenEvent) => Promise<unknown> | unknown) {
  return Object.assign(handler, { __kind: "trigger" as const, pattern, event: "written" as const });
}
export function onDocumentCreated(pattern: string, handler: (e: CreatedEvent) => Promise<unknown> | unknown) {
  return Object.assign(handler, { __kind: "trigger" as const, pattern, event: "created" as const });
}
