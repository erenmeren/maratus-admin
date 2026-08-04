// Pure: archive-lifecycle row filter. Admin queries left-join tenant_settings
// and pass rows through this so "archived org" means the same thing everywhere
// (a missing settings row counts as not archived, matching loadAllOrgs).
export function excludeArchived<T extends { archivedAt: Date | null }>(rows: T[]): T[] {
  return rows.filter((r) => r.archivedAt === null);
}
