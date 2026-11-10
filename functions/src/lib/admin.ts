import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) initializeApp();
export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
export { FieldValue };

export const orgRef = (orgId: string) => db.collection("organizations").doc(orgId);
export const orgCol = (orgId: string, name: string) => orgRef(orgId).collection(name);
export const nowIso = () => new Date().toISOString();
