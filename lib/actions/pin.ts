"use server";

// Pinned-QR mutations (tenant-scoped). Money/no-op/delivery rules live in
// lib/pin-service.ts — these wrappers only do session/RBAC/ownership guards
// and cache revalidation (mirrors lib/actions/devices.ts setDeviceActive).

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";
import { validatePinBody } from "@/lib/pin";
import { setDevicePin, clearDevicePin } from "@/lib/pin-service";

export interface PinActionResult {
  ok: boolean;
  error?: string;
  pinnedUrl?: string | null;
}

async function loadTenantDevice(deviceId: string, organizationId: string) {
  const [device] = await db
    .select()
    .from(deviceTable)
    .where(and(eq(deviceTable.id, deviceId), eq(deviceTable.organizationId, organizationId)))
    .limit(1);
  return device ?? null;
}

function revalidateDevicePages(storeId: string | null, deviceId: string) {
  if (storeId) {
    revalidatePath(`/tenant/stores/${storeId}`);
    revalidatePath(`/tenant/stores/${storeId}/${deviceId}`);
  }
  revalidatePath("/tenant/devices");
}

export async function setDevicePinAction(deviceId: string, url: string): Promise<PinActionResult> {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!canManageTenant(role)) {
    return { ok: false, error: "You don't have permission to manage devices." };
  }
  const v = validatePinBody({ url });
  if (!v.ok) return { ok: false, error: v.error };
  const device = await loadTenantDevice(deviceId, organizationId);
  if (!device) return { ok: false, error: "Device not found." };

  const res = await setDevicePin({
    organizationId,
    device: { id: device.id, pinnedUrl: device.pinnedUrl, pinnedAt: device.pinnedAt },
    url: v.url,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    via: "ui",
    createdByUserId: ctx.user.id,
  });
  if (!res.ok) return { ok: false, error: "Not enough credits — top up from Billing to change the pinned QR." };

  revalidateDevicePages(device.storeId, deviceId);
  return { ok: true, pinnedUrl: v.url };
}

export async function clearDevicePinAction(deviceId: string): Promise<PinActionResult> {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!canManageTenant(role)) {
    return { ok: false, error: "You don't have permission to manage devices." };
  }
  const device = await loadTenantDevice(deviceId, organizationId);
  if (!device) return { ok: false, error: "Device not found." };

  await clearDevicePin({
    organizationId,
    device: { id: device.id, pinnedUrl: device.pinnedUrl },
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    via: "ui",
  });
  revalidateDevicePages(device.storeId, deviceId);
  return { ok: true, pinnedUrl: null };
}
