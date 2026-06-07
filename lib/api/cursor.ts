// Opaque keyset cursor for /api/v1/receipts. Encodes (created_at ISO, id);
// the route orders by (created_at DESC, id DESC) and pages with a row-value
// comparison. Pure + IO-free.

export interface Cursor {
  t: string; // created_at as ISO-8601
  id: string;
}

export function encodeCursor(c: Cursor): string {
  const json = JSON.stringify({ t: c.t, id: c.id });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(s: string): Cursor | null {
  try {
    const json = Buffer.from(s, "base64url").toString("utf8");
    const obj = JSON.parse(json) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const { t, id } = obj as Record<string, unknown>;
    if (typeof t !== "string" || typeof id !== "string" || !id) return null;
    if (Number.isNaN(new Date(t).getTime())) return null;
    return { t, id };
  } catch {
    return null;
  }
}
