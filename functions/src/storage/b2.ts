/**
 * Backblaze B2 private storage. The browser never receives B2 credentials:
 *  - uploads are proxied through this function after type/size/permission checks;
 *  - downloads use a 5-minute download authorization scoped to ONE file.
 * Object keys are namespaced by organization: orgs/{orgId}/{purpose}/{fileId}-{name}
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { B2_APPLICATION_KEY, B2_BUCKET_ID, B2_BUCKET_NAME, B2_KEY_ID, secretValue } from "../lib/params";
import { requireMember, rateLimit, str, safeError, ID } from "../lib/guard";
import { orgCol, nowIso } from "../lib/admin";
import { audit } from "../lib/audit";
import { validateUpload, MAX_UPLOAD_BYTES } from "../../../shared/files";
import type { FileRecord } from "../../../shared/types";

let auth: { apiUrl: string; downloadUrl: string; token: string; exp: number } | null = null;

async function authorize() {
  if (auth && auth.exp > Date.now()) return auth;
  const id = secretValue(B2_KEY_ID), key = secretValue(B2_APPLICATION_KEY);
  if (!id || !key || !B2_BUCKET_ID.value()) throw new HttpsError("failed-precondition", "File storage isn't configured (Backblaze B2).");
  const r = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", { headers: { Authorization: `Basic ${Buffer.from(`${id}:${key}`).toString("base64")}` } });
  if (!r.ok) throw new HttpsError("unavailable", "Couldn't authorize with Backblaze B2.");
  const j = (await r.json()) as any;
  auth = { apiUrl: j.apiInfo.storageApi.apiUrl, downloadUrl: j.apiInfo.storageApi.downloadUrl, token: j.authorizationToken, exp: Date.now() + 20 * 3600 * 1000 };
  return auth;
}

/** Sniff magic bytes so a renamed executable can't pass as a PDF/image. */
function contentMatches(type: string, buf: Buffer): boolean {
  const hex = buf.subarray(0, 12).toString("hex");
  if (type === "application/pdf") return buf.subarray(0, 5).toString() === "%PDF-";
  if (type === "image/png") return hex.startsWith("89504e47");
  if (type === "image/jpeg") return hex.startsWith("ffd8ff");
  if (type === "image/webp") return buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
  if (type === "image/heic") return buf.subarray(4, 12).toString().startsWith("ftyp");
  if (type === "text/csv") return !buf.subarray(0, 512).includes(0);
  return false;
}

export const uploadFile = onCall({ secrets: [B2_KEY_ID, B2_APPLICATION_KEY], memory: "512MiB" }, async (req) => {
  try {
    const c = await requireMember(req, "files.upload");
    await rateLimit(`upload_${c.uid}`, 60, 3600);
    const name = str(req.data?.name, "File name", { min: 1, max: 180 });
    const type = str(req.data?.contentType, "Content type", { max: 100 });
    const purpose = req.data?.purpose as FileRecord["purpose"];
    if (!["receipt", "invoice_attachment", "document"].includes(purpose)) throw new HttpsError("invalid-argument", "Invalid purpose.");
    const data = Buffer.from(String(req.data?.data ?? ""), "base64");
    const err = validateUpload(name, type, data.length);
    if (err) throw new HttpsError("invalid-argument", err);
    if (data.length > MAX_UPLOAD_BYTES || !contentMatches(type, data)) throw new HttpsError("invalid-argument", "File contents don't match its type.");
    const related = req.data?.related as { type?: string; id?: string } | undefined;
    if (related && (!["expense", "invoice", "customer"].includes(related.type ?? "") || !ID.test(related.id ?? ""))) throw new HttpsError("invalid-argument", "Invalid related record.");

    const a = await authorize();
    const up = (await (await fetch(`${a.apiUrl}/b2api/v3/b2_get_upload_url?bucketId=${B2_BUCKET_ID.value()}`, { headers: { Authorization: a.token } })).json()) as any;
    const fileId = crypto.randomUUID();
    const sha1 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", data))).map((b) => b.toString(16).padStart(2, "0")).join("");
    const safe = name.replace(/[^A-Za-z0-9._-]/g, "_");
    const key = `orgs/${c.orgId}/${purpose}/${fileId}-${safe}`;
    const put = await fetch(up.uploadUrl, {
      method: "POST",
      headers: { Authorization: up.authorizationToken, "X-Bz-File-Name": encodeURIComponent(key), "Content-Type": type, "Content-Length": String(data.length), "X-Bz-Content-Sha1": sha1 },
      body: data,
    });
    if (!put.ok) throw new HttpsError("unavailable", "Upload to storage failed.");
    const rec: FileRecord = { id: fileId, orgId: c.orgId, name, contentType: type, size: data.length, purpose, relatedType: related?.type, relatedId: related?.id, storageKey: key, uploadedBy: c.email, createdAt: nowIso(), isSample: false };
    await orgCol(c.orgId, "files").doc(fileId).set(rec);
    await audit(c.orgId, c.email, "Uploaded file", name, purpose);
    return rec;
  } catch (e) {
    throw safeError(e, "Upload failed.");
  }
});

export const getFileUrl = onCall({ secrets: [B2_KEY_ID, B2_APPLICATION_KEY] }, async (req) => {
  try {
    const c = await requireMember(req);
    const fileId = str(req.data?.fileId, "File", { pattern: ID });
    const f = await orgCol(c.orgId, "files").doc(fileId).get();
    if (!f.exists) throw new HttpsError("not-found", "File not found.");
    const rec = f.data() as FileRecord;
    // Receipts follow expense access; other documents follow invoice/customer access.
    const needed = rec.purpose === "receipt" ? "expenses.view" : rec.relatedType === "customer" ? "customers.view" : "invoices.view";
    if (!c.member.permissions.includes(needed)) throw new HttpsError("permission-denied", "You don't have access to this file.");
    const a = await authorize();
    const r = await fetch(`${a.apiUrl}/b2api/v3/b2_get_download_authorization`, { method: "POST", headers: { Authorization: a.token }, body: JSON.stringify({ bucketId: B2_BUCKET_ID.value(), fileNamePrefix: rec.storageKey, validDurationInSeconds: 300 }) });
    if (!r.ok) throw new HttpsError("unavailable", "Couldn't create a download link.");
    const j = (await r.json()) as any;
    const url = `${a.downloadUrl}/file/${B2_BUCKET_NAME.value()}/${rec.storageKey.split("/").map(encodeURIComponent).join("/")}?Authorization=${encodeURIComponent(j.authorizationToken)}&b2ContentDisposition=${encodeURIComponent(`inline; filename="${rec.name.replace(/"/g, "")}"`)}`;
    return { url, expiresInSeconds: 300 };
  } catch (e) {
    throw safeError(e);
  }
});
