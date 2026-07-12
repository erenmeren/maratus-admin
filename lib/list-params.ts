// Pure URL-state helpers for the paginated tenant list pages
// (docs/superpowers/specs/2026-07-12-fleet-scale-tenant-lists-design.md).
// Search / status filter / page number live in the URL; this module is the
// single owner of how those params are parsed and bounded.

export const PAGE_SIZE = 50;

export type DeviceStatusFilter = "all" | "online" | "offline" | "paused" | "pool" | "unclaimed";

const STATUSES: readonly DeviceStatusFilter[] = ["all", "online", "offline", "paused", "pool", "unclaimed"];

export interface ListParams {
  q: string;
  status: DeviceStatusFilter;
  page: number;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseListParams(sp: {
  q?: string | string[];
  status?: string | string[];
  page?: string | string[];
}): ListParams {
  const q = (first(sp.q) ?? "").trim().slice(0, 100);
  const rawStatus = first(sp.status) ?? "all";
  const status = (STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as DeviceStatusFilter)
    : "all";
  const rawPage = Number(first(sp.page));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  return { q, status, page };
}

export function pageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Escape LIKE/ILIKE wildcards so user input matches literally
 *  (backslash is Postgres's default escape character). */
export function escapeLike(q: string): string {
  return q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
