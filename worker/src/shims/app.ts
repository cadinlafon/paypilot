/** `firebase-admin/app` stand-in — the Worker authenticates per request with a service account. */
let inited = false;
export function initializeApp() {
  inited = true;
  return {};
}
export function getApps() {
  return inited ? [{}] : [];
}
