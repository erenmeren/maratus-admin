import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";

/**
 * True when the org has been offboarded (tenantSettings.archivedAt is
 * non-null). Platform-admin actions that mutate a SPECIFIC org (credits,
 * store/device provisioning, device edits) must refuse once archived — the
 * UI already goes read-only, but a stale tab or direct call can still hit
 * the server action, so this is the server-side backstop. Callers are
 * expected to have already gated auth (requirePlatformAdmin) before calling.
 */
export async function isOrgArchived(organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ archivedAt: tenantSettings.archivedAt })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, organizationId))
    .limit(1);
  return row?.archivedAt != null;
}
