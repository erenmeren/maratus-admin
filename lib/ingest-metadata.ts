// lib/ingest-metadata.ts
// Pure: sanitize the OPTIONAL technical render metadata a device sends with a document.
// Holds NO parsed document semantics (no totals, no line items) — only render facts.

export interface DocumentMetadata {
  renderWidth?: number;
  renderHeight?: number;
  contentHash?: string;
  firmwareVersion?: string;
  renderMs?: number;
}

function intIn(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  if (n < min) return undefined; // below floor → drop (not a meaningful value)
  return n > max ? max : n; // above ceiling → clamp
}

function str(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export function parseDocumentMetadata(raw: unknown): DocumentMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: DocumentMetadata = {};

  const w = intIn(r.renderWidth, 1, 10000);
  if (w !== undefined) out.renderWidth = w;
  const h = intIn(r.renderHeight, 1, 10000);
  if (h !== undefined) out.renderHeight = h;
  const ms = intIn(r.renderMs, 0, 600000);
  if (ms !== undefined) out.renderMs = ms;
  const hash = str(r.contentHash, 64);
  if (hash !== undefined) out.contentHash = hash;
  const fw = str(r.firmwareVersion, 32);
  if (fw !== undefined) out.firmwareVersion = fw;

  return Object.keys(out).length === 0 ? null : out;
}
