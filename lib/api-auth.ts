// Shared API-key authentication for /api/v1 routes.
// Mirrors lib/device-auth.ts: resolve the org from Authorization: Bearer <key>.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKey as apiKeyTable } from "@/lib/db/schema";
import { hashApiKey } from "@/lib/ids";

export interface ApiKeyAuth {
  organizationId: string;
  keyId: string;
  keyHash: string;
}

/** Resolve a non-revoked API key from the Bearer header, or null. Best-effort
 *  bumps last_used_at (non-blocking). */
export async function authenticateApiKey(req: Request): Promise<ApiKeyAuth | null> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const keyHash = hashApiKey(match[1].trim());

  const [row] = await db
    .select({ id: apiKeyTable.id, organizationId: apiKeyTable.organizationId })
    .from(apiKeyTable)
    .where(and(eq(apiKeyTable.keyHash, keyHash), isNull(apiKeyTable.revokedAt)))
    .limit(1);
  if (!row) return null;

  // Fire-and-forget last-used bump; never block or fail the request on it.
  void (async () => {
    try {
      await db.update(apiKeyTable).set({ lastUsedAt: new Date() }).where(eq(apiKeyTable.id, row.id));
    } catch {
      /* best-effort */
    }
  })();

  return { organizationId: row.organizationId, keyId: row.id, keyHash };
}
