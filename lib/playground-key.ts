// lib/playground-key.ts
// Ephemeral "Docs playground" API keys for the docs site's Scalar "Try it"
// console. A signed-in user gets a short-lived key for their active org,
// minted on demand; the raw key is returned once and lives only in browser
// memory. A non-null `apiKey.expiresAt` is what marks a playground key: it is
// rejected by authenticateApiKey once past, and hidden from the tenant API-key
// list (lib/data.ts getApiKeys). Same key format/hashing as normal keys.

import { and, eq, gt, isNotNull, isNull, lte, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKey as apiKeyTable } from "@/lib/db/schema";
import { id, generateApiKey } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";
import { API_SCOPES, type ApiScope } from "@/lib/api-scopes";
import { canManageTenant } from "@/lib/roles";

export const PLAYGROUND_KEY_NAME = "Docs playground";
export const PLAYGROUND_KEY_TTL_MINUTES = 60;

/** Scopes a playground key gets for a tenant role: owner/admin → every scope,
 *  member (or anything else) → read-only usage. Mirrors the tenant RBAC model:
 *  members can't manage devices, so they can't trigger/pin via the console. */
export function playgroundScopes(role: string | null | undefined): ApiScope[] {
  return canManageTenant(role) ? [...API_SCOPES] : ["usage:read"];
}

/** Pure expiry check: null expiresAt (a normal key) never expires. */
export function isApiKeyExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  return expiresAt != null && expiresAt.getTime() <= now.getTime();
}

/** SQL twin of !isApiKeyExpired — for WHERE clauses. */
export function apiKeyNotExpiredSql(now: Date = new Date()): SQL {
  return or(isNull(apiKeyTable.expiresAt), gt(apiKeyTable.expiresAt, now))!;
}

export interface MintedPlaygroundKey {
  key: string; // raw key, returned ONCE
  expiresAt: Date;
  scopes: ApiScope[];
}

/**
 * Mint a fresh playground key for (org, user). Housekeeping first: delete the
 * org's expired playground keys, and revoke any still-live playground key this
 * user already holds in this org — so there is at most one live playground
 * key per user per org. Caller is responsible for auth (session + membership
 * + archived check); see lib/actions/playground.ts.
 */
export async function mintPlaygroundKey(input: {
  organizationId: string;
  userId: string;
  role: string | null | undefined;
  /** Audit actor label (the user's email); defaults to userId. */
  actorLabel?: string;
}): Promise<MintedPlaygroundKey> {
  const { organizationId, userId, role } = input;
  const now = new Date();

  await db
    .delete(apiKeyTable)
    .where(
      and(
        eq(apiKeyTable.organizationId, organizationId),
        isNotNull(apiKeyTable.expiresAt),
        lte(apiKeyTable.expiresAt, now),
      ),
    );

  await db
    .update(apiKeyTable)
    .set({ revokedAt: now })
    .where(
      and(
        eq(apiKeyTable.organizationId, organizationId),
        eq(apiKeyTable.createdByUserId, userId),
        isNotNull(apiKeyTable.expiresAt),
        gt(apiKeyTable.expiresAt, now),
        isNull(apiKeyTable.revokedAt),
      ),
    );

  const scopes = playgroundScopes(role);
  const expiresAt = new Date(now.getTime() + PLAYGROUND_KEY_TTL_MINUTES * 60_000);
  const { key, hash, prefix } = generateApiKey();
  const keyId = id("ak");
  await db.insert(apiKeyTable).values({
    id: keyId,
    organizationId,
    name: PLAYGROUND_KEY_NAME,
    keyHash: hash,
    prefix,
    scopes,
    createdByUserId: userId,
    createdAt: now,
    expiresAt,
  });

  await recordAudit({
    organizationId,
    actor: { type: "user", id: userId, label: input.actorLabel ?? userId },
    action: AUDIT.apiKeyPlaygroundIssued,
    target: { type: "api_key", id: keyId },
    metadata: { prefix, scopes, expiresAt: expiresAt.toISOString() },
  });

  return { key, expiresAt, scopes };
}
