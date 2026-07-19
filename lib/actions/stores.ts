"use server";

// Store mutations (tenant-scoped). Create a new branch in the active org.

import { revalidatePath } from "next/cache";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  device as deviceTable,
  factoryDevice,
  organization as orgTable,
  store as storeTable,
} from "@/lib/db/schema";
import { requirePlatformAdmin, requireTenant } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";
import { id } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";
import { normalizeTimezone } from "@/lib/timezones";
import { isOrgArchived } from "@/lib/archived-guard";

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
  if (!membership || !canManageTenant(membership.role)) {
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
  if (await isOrgArchived(organizationId)) {
    return { ok: false, error: "Customer is archived." };
  }

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
  if (!membership || !canManageTenant(membership.role)) {
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

export interface DeleteStoreResult {
  ok: boolean;
  error?: string;
}

// Shared body for both roles. Deleting the row nulls device.storeId and
// factoryDevice.allocatedStoreId via the FKs' onDelete: "set null" — devices
// drop into the tenant's Unassigned pool; armed allocations disarm.
async function performStoreDelete(
  organizationId: string,
  storeId: string,
  actor: { type: "user"; id: string; label: string },
): Promise<DeleteStoreResult> {
  const [existing] = await db
    .select({ id: storeTable.id, name: storeTable.name })
    .from(storeTable)
    .where(and(eq(storeTable.id, storeId), eq(storeTable.organizationId, organizationId)))
    .limit(1);
  if (!existing) return { ok: false, error: "Store not found." };

  // Only claimed devices actually enter the Unassigned pool — unclaimed
  // provisioned devices just lose their store link and stay out of it.
  const [{ n: unassignedDeviceCount }] = await db
    .select({ n: count() })
    .from(deviceTable)
    .where(and(eq(deviceTable.storeId, storeId), isNotNull(deviceTable.claimedAt)));
  const [{ n: disarmedAllocationCount }] = await db
    .select({ n: count() })
    .from(factoryDevice)
    .where(and(eq(factoryDevice.allocatedStoreId, storeId), eq(factoryDevice.status, "allocated")));

  await db
    .delete(storeTable)
    .where(and(eq(storeTable.id, storeId), eq(storeTable.organizationId, organizationId)));

  await recordAudit({
    organizationId,
    actor,
    action: AUDIT.storeDeleted,
    target: { type: "store", id: storeId },
    metadata: { name: existing.name, unassignedDeviceCount, disarmedAllocationCount },
  });
  return { ok: true };
}

/** Delete a store (tenant owner/admin). Its devices move to the Unassigned pool. */
export async function deleteStore(storeId: string): Promise<DeleteStoreResult> {
  const { ctx, organizationId } = await requireTenant();

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !canManageTenant(membership.role)) {
    return { ok: false, error: "You don't have permission to delete stores." };
  }

  const result = await performStoreDelete(organizationId, storeId, {
    type: "user",
    id: ctx.user.id,
    label: ctx.user.email,
  });
  if (!result.ok) return result;

  revalidatePath("/tenant/stores");
  revalidatePath("/tenant");
  return result;
}

/** Platform-admin variant (parity with createStoreForOrg). */
export async function deleteStoreForOrg(
  organizationId: string,
  storeId: string,
): Promise<DeleteStoreResult> {
  const ctx = await requirePlatformAdmin();

  const [org] = await db
    .select({ id: orgTable.id })
    .from(orgTable)
    .where(eq(orgTable.id, organizationId))
    .limit(1);
  if (!org) return { ok: false, error: "Customer not found." };
  if (await isOrgArchived(organizationId)) {
    return { ok: false, error: "Customer is archived." };
  }

  const result = await performStoreDelete(organizationId, storeId, {
    type: "user",
    id: ctx.user.id,
    label: ctx.user.email,
  });
  if (!result.ok) return result;

  revalidatePath(`/admin/customers/${organizationId}`);
  revalidatePath("/admin");
  return result;
}
