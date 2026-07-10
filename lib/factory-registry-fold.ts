// Pure helpers extracted from lib/factory-registry.ts — no DB, no I/O, so the
// fold/clamp math can be unit-tested directly instead of only indirectly
// through integration tests of the DB-backed functions that use them.

/**
 * Groups deallocated serials by the org they belonged to BEFORE the update,
 * keeping only serials that appear in BOTH `before` (the pre-update snapshot)
 * and `updatedSerials` (the rows the UPDATE actually touched). Rows with a
 * null `organizationId`, or present in only one of the two lists, are
 * excluded. Mirrors the semantics inline in `deallocateSerials`.
 */
export function foldDeallocatedByOrg(
  before: { serial: string; organizationId: string | null }[],
  updatedSerials: string[],
): Record<string, string[]> {
  const updated = new Set(updatedSerials);
  const byOrg: Record<string, string[]> = {};
  for (const row of before) {
    if (!row.organizationId || !updated.has(row.serial)) continue;
    (byOrg[row.organizationId] ??= []).push(row.serial);
  }
  return byOrg;
}

/**
 * Clamps a requested page number into `[1, pageCount]`, where `pageCount` is
 * derived from `total`/`pageSize` (minimum 1, so a zero-row table still
 * reports "Page 1 of 1" instead of "Page 1 of 0"). Mirrors the clamp math
 * inline in `getFactoryDevicePage`.
 */
export function clampPage(
  requestedPage: number,
  total: number,
  pageSize: number,
): { safePage: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const normalizedRequest = Math.max(1, Math.floor(requestedPage) || 1);
  const safePage = Math.min(normalizedRequest, pageCount);
  return { safePage, pageCount };
}
