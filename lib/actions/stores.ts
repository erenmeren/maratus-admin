"use server";

// Store mutations (tenant-scoped). Create a new branch in the active org.

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organization as orgTable, store as storeTable } from "@/lib/db/schema";
import { requirePlatformAdmin, requireTenant } from "@/lib/session";
import { id } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";
import { normalizeTimezone } from "@/lib/timezones";

export interface CreateStoreResult {
  ok: boolean;
  error?: string;
  storeId?: string;
}

export async function createStore(
  formData: FormData,
): Promise<CreateStoreResult> {
  const { ctx, organizationId } = await requireTenant();

  // Authorize: only owners/admins may add stores.
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission to add stores." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const timezone = normalizeTimezone(String(formData.get("timezone") ?? ""));
  if (!name) return { ok: false, error: "Store name is required." };

  const storeId = id("str");
  await db.insert(storeTable).values({
    id: storeId,
    organizationId,
    name,
    address,
    timezone,
    createdAt: new Date(),
  });

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.storeCreated,
    target: { type: "store", id: storeId },
    metadata: { name },
  });

  revalidatePath("/tenant/stores");
  revalidatePath("/tenant");
  return { ok: true, storeId };
}

/**
 * Create a branch for a SPECIFIC customer (platform-admin). The superadmin
 * version of createStore — not scoped to an active org.
 */
export async function createStoreForOrg(
  organizationId: string,
  formData: FormData,
): Promise<CreateStoreResult> {
  const ctx = await requirePlatformAdmin();

  const [org] = await db
    .select({ id: orgTable.id })
    .from(orgTable)
    .where(eq(orgTable.id, organizationId))
    .limit(1);
  if (!org) return { ok: false, error: "Customer not found." };

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const timezone = normalizeTimezone(String(formData.get("timezone") ?? ""));
  if (!name) return { ok: false, error: "Branch name is required." };

  const storeId = id("str");
  await db.insert(storeTable).values({
    id: storeId,
    organizationId,
    name,
    address,
    timezone,
    createdAt: new Date(),
  });

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.storeCreated,
    target: { type: "store", id: storeId },
    metadata: { name },
  });

  revalidatePath(`/admin/customers/${organizationId}`);
  revalidatePath("/admin");
  return { ok: true, storeId };
}

/**
 * Update a store's name/address/timezone (tenant-scoped, owner/admin only).
 * Verifies the store belongs to the active org before mutating.
 */
export async function updateStore(
  storeId: string,
  formData: FormData,
): Promise<CreateStoreResult> {
  const { ctx, organizationId } = await requireTenant();

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission to edit stores." };
  }

  const [existing] = await db
    .select({ id: storeTable.id })
    .from(storeTable)
    .where(and(eq(storeTable.id, storeId), eq(storeTable.organizationId, organizationId)))
    .limit(1);
  if (!existing) return { ok: false, error: "Store not found." };

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const timezone = normalizeTimezone(String(formData.get("timezone") ?? ""));
  if (!name) return { ok: false, error: "Store name is required." };

  await db
    .update(storeTable)
    .set({ name, address, timezone })
    .where(and(eq(storeTable.id, storeId), eq(storeTable.organizationId, organizationId)));

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.storeUpdated,
    target: { type: "store", id: storeId },
    metadata: { name, timezone },
  });

  revalidatePath("/tenant/stores");
  revalidatePath(`/tenant/stores/${storeId}`);
  revalidatePath("/tenant");
  return { ok: true, storeId };
}
