"use server";

// Device mutations (tenant-scoped). Pause/activate persists device.status;
// guarded so a tenant can only touch devices in its active organization.

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  device as deviceTable,
  organization as orgTable,
  store as storeTable,
} from "@/lib/db/schema";
import { requirePlatformAdmin, requireTenant } from "@/lib/session";
import { id, pairingCode } from "@/lib/ids";
import type { DeviceStatus } from "@/lib/types";

export interface ActionResult {
  ok: boolean;
  error?: string;
  status?: DeviceStatus;
}

/** Pause or activate a device. `active` true → online, false → paused. */
export async function setDeviceActive(
  deviceId: string,
  active: boolean,
): Promise<ActionResult> {
  const { organizationId } = await requireTenant();

  const [device] = await db
    .select()
    .from(deviceTable)
    .where(
      and(
        eq(deviceTable.id, deviceId),
        eq(deviceTable.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!device) return { ok: false, error: "Device not found." };
  if (device.status === "offline") {
    return { ok: false, error: "Device is offline and can't be changed." };
  }

  const next: DeviceStatus = active ? "online" : "paused";
  await db
    .update(deviceTable)
    .set({ status: next })
    .where(eq(deviceTable.id, deviceId));

  revalidatePath(`/tenant/stores/${device.storeId}`);
  revalidatePath(`/tenant/stores/${device.storeId}/${deviceId}`);
  revalidatePath("/tenant");
  revalidatePath("/tenant/stores");
  return { ok: true, status: next };
}

// ---- Platform-admin: fleet assign / unassign -------------------------------

/** Pause/activate any device (platform-admin, spans all orgs). */
export async function setDeviceActiveAdmin(
  deviceId: string,
  active: boolean,
): Promise<ActionResult> {
  await requirePlatformAdmin();
  const [device] = await db
    .select()
    .from(deviceTable)
    .where(eq(deviceTable.id, deviceId))
    .limit(1);
  if (!device) return { ok: false, error: "Device not found." };
  if (device.status === "offline") {
    return { ok: false, error: "Device is offline and can't be changed." };
  }
  const next: DeviceStatus = active ? "online" : "paused";
  await db
    .update(deviceTable)
    .set({ status: next })
    .where(eq(deviceTable.id, deviceId));

  revalidatePath("/admin/devices");
  if (device.storeId) revalidatePath(`/tenant/stores/${device.storeId}`);
  return { ok: true, status: next };
}

export interface ProvisionDeviceResult {
  ok: boolean;
  error?: string;
  deviceId?: string;
  pairingCode?: string;
}

/**
 * Provision a NEW device for a customer (platform-admin). Creates an unclaimed
 * device row with a one-time pairing code; optionally pre-binds it to a store.
 * The tenant then claims it on the device with the returned pairing code.
 */
export async function provisionDevice(
  organizationId: string,
  name: string,
  storeId?: string | null,
): Promise<ProvisionDeviceResult> {
  await requirePlatformAdmin();

  const [org] = await db
    .select({ id: orgTable.id })
    .from(orgTable)
    .where(eq(orgTable.id, organizationId))
    .limit(1);
  if (!org) return { ok: false, error: "Customer not found." };

  // If a store is given, it must belong to this organization.
  if (storeId) {
    const [store] = await db
      .select({ organizationId: storeTable.organizationId })
      .from(storeTable)
      .where(eq(storeTable.id, storeId))
      .limit(1);
    if (!store || store.organizationId !== organizationId) {
      return { ok: false, error: "Store does not belong to this customer." };
    }
  }

  const deviceId = id("dev");
  const code = pairingCode();
  await db.insert(deviceTable).values({
    id: deviceId,
    organizationId,
    storeId: storeId ?? null,
    name: name.trim() || "New Kiosk",
    status: "offline",
    connectionType: "wifi",
    firmwareVersion: "2.4.1",
    pairingCode: code,
    deviceKeyHash: null,
    claimedAt: null,
    createdAt: new Date(),
  });

  revalidatePath(`/admin/customers/${organizationId}`);
  revalidatePath("/admin/devices");
  revalidatePath("/admin");
  if (storeId) revalidatePath(`/tenant/stores/${storeId}`);
  return { ok: true, deviceId, pairingCode: code };
}

/** Unassign a device from its store (platform-admin, spans all orgs). */
export async function unassignDevice(deviceId: string): Promise<ActionResult> {
  await requirePlatformAdmin();
  const [device] = await db
    .select()
    .from(deviceTable)
    .where(eq(deviceTable.id, deviceId))
    .limit(1);
  if (!device) return { ok: false, error: "Device not found." };

  await db
    .update(deviceTable)
    .set({ storeId: null, status: "offline" })
    .where(eq(deviceTable.id, deviceId));

  revalidatePath("/admin/devices");
  if (device.storeId) revalidatePath(`/tenant/stores/${device.storeId}`);
  return { ok: true, status: "offline" };
}

