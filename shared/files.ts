/** Upload rules — enforced in the browser for UX and again on the server. */
export const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "text/csv": [".csv"],
};
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function validateUpload(name: string, type: string, size: number): string | null {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  const allowed = ALLOWED_UPLOAD_TYPES[type];
  if (!allowed || !allowed.includes(ext)) return "Unsupported file type. Use PDF, PNG, JPG, WEBP, HEIC or CSV.";
  if (size <= 0) return "The file is empty.";
  if (size > MAX_UPLOAD_BYTES) return `File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`;
  if (name.length > 180 || /[\\/\0]/.test(name)) return "Invalid file name.";
  return null;
}
