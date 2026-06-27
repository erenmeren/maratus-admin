// Pure parsing/validation of /api/v1/documents query params. No IO.
import type { DocumentStatus } from "@/lib/documents-search";

const STATUSES: DocumentStatus[] = ["pending", "ready", "downloaded"];

export interface ListParams {
  storeId?: string;
  deviceId?: string;
  status?: DocumentStatus;
  createdAfter?: Date;
  createdBefore?: Date;
  token?: string;
  limit: number;
}

export type ParseResult =
  | { ok: true; value: ListParams }
  | { ok: false; error: string };

function str(v: string | null): string | undefined {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : undefined;
}

function parseDate(v: string | null, field: string): Date | undefined | { error: string } {
  const t = str(v);
  if (!t) return undefined;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? { error: `invalid_param: ${field}` } : d;
}

export function parseListParams(sp: URLSearchParams): ParseResult {
  const value: ListParams = { limit: 50 };

  const limitRaw = str(sp.get("limit"));
  if (limitRaw !== undefined) {
    const n = Number.parseInt(limitRaw, 10);
    if (Number.isFinite(n) && n >= 1) value.limit = Math.min(n, 100);
    // non-positive / NaN → keep default 50
  }

  const statusRaw = str(sp.get("status"));
  if (statusRaw !== undefined) {
    if (!STATUSES.includes(statusRaw as DocumentStatus)) return { ok: false, error: "invalid_param: status" };
    value.status = statusRaw as DocumentStatus;
  }

  value.storeId = str(sp.get("store_id"));
  value.deviceId = str(sp.get("device_id"));
  value.token = str(sp.get("token"));

  const after = parseDate(sp.get("created_after"), "created_after");
  if (after && "error" in (after as object)) return { ok: false, error: (after as { error: string }).error };
  if (after instanceof Date) value.createdAfter = after;

  const before = parseDate(sp.get("created_before"), "created_before");
  if (before && "error" in (before as object)) return { ok: false, error: (before as { error: string }).error };
  if (before instanceof Date) value.createdBefore = before;

  return { ok: true, value };
}
