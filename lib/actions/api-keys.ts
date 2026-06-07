"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKey as apiKeyTable } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { id, generateApiKey } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";

function canManage(role: string | undefined): boolean {
  return !!role && ["owner", "admin"].includes(role);
}

export interface CreateApiKeyResult {
  ok: boolean;
  error?: string;
  key?: string; // raw key, returned ONCE
}

export async function createApiKey(formData: FormData): Promise<CreateApiKeyResult> {
  const { ctx, organizationId } = await requireTenant();
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!canManage(membership?.role)) return { ok: false, error: "You don't have permission to create API keys." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Key name is required." };
  if (name.length > 100) return { ok: false, error: "Key name must be 100 characters or fewer." };

  const { key, hash, prefix } = generateApiKey();
  const keyId = id("ak");
  await db.insert(apiKeyTable).values({
    id: keyId,
    organizationId,
    name,
    keyHash: hash,
    prefix,
    createdByUserId: ctx.user.id,
    createdAt: new Date(),
  });

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.apiKeyCreated,
    target: { type: "api_key", id: keyId },
    metadata: { name, prefix },
  });

  revalidatePath("/tenant/api");
  return { ok: true, key };
}

export interface RevokeApiKeyResult {
  ok: boolean;
  error?: string;
}

export async function revokeApiKey(keyId: string): Promise<RevokeApiKeyResult> {
  const { ctx, organizationId } = await requireTenant();
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!canManage(membership?.role)) return { ok: false, error: "You don't have permission to revoke API keys." };

  const [existing] = await db
    .select({ id: apiKeyTable.id })
    .from(apiKeyTable)
    .where(and(eq(apiKeyTable.id, keyId), eq(apiKeyTable.organizationId, organizationId), isNull(apiKeyTable.revokedAt)))
    .limit(1);
  if (!existing) return { ok: false, error: "Key not found." };

  await db
    .update(apiKeyTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeyTable.id, keyId), eq(apiKeyTable.organizationId, organizationId), isNull(apiKeyTable.revokedAt)));

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.apiKeyRevoked,
    target: { type: "api_key", id: keyId },
  });

  revalidatePath("/tenant/api");
  return { ok: true };
}
