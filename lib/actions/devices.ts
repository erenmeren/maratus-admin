"use server";

// Device mutations (tenant-scoped). Pause/activate persists device.status;
// guarded so a tenant can only touch devices in its active organization.

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { requirePlatformAdmin, requireTenant } from "@/lib/session";
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

