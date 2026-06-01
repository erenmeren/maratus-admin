// Pure validation for the ingest payload — size + mime guardrails.

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5 MB

type Ok = { ok: true };
type Err = { ok: false; status: number; error: string };

export function validateReceiptPayload(byteLength: number, mimeType: string): Ok | Err {
  if (byteLength === 0) return { ok: false, status: 400, error: "Empty receipt payload" };
  if (byteLength > MAX_RECEIPT_BYTES)
    return { ok: false, status: 413, error: "Receipt image too large" };
  if (!mimeType.startsWith("image/"))
    return { ok: false, status: 415, error: "Unsupported media type" };
  return { ok: true };
}
