// lib/receipts-search.ts
// Pure parsing/normalization of receipt-search URL params (no IO).

export type ReceiptStatus = "pending" | "ready" | "downloaded";
export const PAGE_SIZE = 25;

const STATUSES: ReceiptStatus[] = ["pending", "ready", "downloaded"];

export interface ReceiptFilters {
  organizationId?: string;
  storeId?: string;
  deviceId?: string;
  status?: ReceiptStatus;
  from?: Date;
  to?: Date;
  token?: string;
  page: number;
}

function str(v: string | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : undefined;
}

function date(v: string | undefined): Date | undefined {
  const t = str(v);
  if (!t) return undefined;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Parse an upper-bound date. A `<input type="date">` yields a date-only string
 * (UTC midnight); extend it to the end of that day so the range is inclusive —
 * otherwise filtering from=to=today returns nothing.
 */
function endOfDayIfDateOnly(v: string | undefined): Date | undefined {
  const d = date(v);
  if (!d) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test((v ?? "").trim())) {
    return new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  return d;
}

/** Normalize raw URL search params into typed, validated filters. */
export function parseReceiptFilters(raw: Record<string, string | undefined>): ReceiptFilters {
  const statusRaw = str(raw.status);
  const status = STATUSES.includes(statusRaw as ReceiptStatus)
    ? (statusRaw as ReceiptStatus)
    : undefined;
  const pageNum = Number.parseInt(raw.page ?? "", 10);
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

  const f: ReceiptFilters = { page };
  const organizationId = str(raw.org);
  const storeId = str(raw.store);
  const deviceId = str(raw.device);
  const from = date(raw.from);
  const to = endOfDayIfDateOnly(raw.to);
  const token = str(raw.token);
  if (organizationId) f.organizationId = organizationId;
  if (storeId) f.storeId = storeId;
  if (deviceId) f.deviceId = deviceId;
  if (status) f.status = status;
  if (from) f.from = from;
  if (to) f.to = to;
  if (token) f.token = token;
  return f;
}

/** Total pages for a result count (never < 1). */
export function receiptPageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
