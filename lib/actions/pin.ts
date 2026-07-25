"use server";

// Pinned-QR mutations (tenant-scoped), all scopes (org/store/device). Money/
// no-op/delivery rules live in lib/pin-service.ts — these wrappers only do
// session/RBAC/ownership guards and cache revalidation (mirrors
// lib/actions/devices.ts setDeviceActive).

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, store as storeTable } from "@/lib/db/schema";
import { requireTenant, type AppContext } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";
import { validatePinBody } from "@/lib/pin";
import { applyScopedPinChange } from "@/lib/pin-service";

export interface PinActionResult {
  ok: boolean;
  error?: string;
  pinnedUrl?: string | null;
}

export interface ScopedPinActionResult {
  ok: boolean;
  error?: string;
  affectedDevices?: number;
  creditsCharged?: number;
  pinnedUrl?: string | null;
}

type Guard =
  | { ok: true; ctx: AppContext; organizationId: string }
  | { ok: false; error: string };

async function guard(): Promise<Guard> {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!canManageTenant(role)) {
    return { ok: false, error: "You don't have permission to manage devices." };
  }
  return { ok: true, ctx, organizationId };
}

async function loadTenantDevice(deviceId: string, organizationId: string) {
  const [device] = await db
    .select()
    .from(deviceTable)
    .where(and(eq(deviceTable.id, deviceId), eq(deviceTable.organizationId, organizationId)))
    .limit(1);
  return device ?? null;
}

async function loadTenantStore(storeId: string, organizationId: string) {
  const [store] = await db
    .select()
    .from(storeTable)
    .where(and(eq(storeTable.id, storeId), eq(storeTable.organizationId, organizationId)))
    .limit(1);
  return store ?? null;
}

function revalidateDevicePages(storeId: string | null, deviceId: string) {
  if (storeId) {
    revalidatePath(`/tenant/stores/${storeId}`);
    revalidatePath(`/tenant/stores/${storeId}/${deviceId}`);
  }
  revalidatePath("/tenant/devices");
}

function revalidatePinSurfaces() {
  revalidatePath("/tenant/pinned-qr");
  revalidatePath("/tenant/devices");
  revalidatePath("/tenant/stores");
}

export async function setOrgPinAction(url: string): Promise<ScopedPinActionResult> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const v = validatePinBody({ url });
  if (!v.ok) return { ok: false, error: v.error };
  const res = await applyScopedPinChange({
    organizationId: g.organizationId,
    change: { scope: "org", url: v.url },
    actor: { type: "user", id: g.ctx.user.id, label: g.ctx.user.email },
    via: "ui",
    createdByUserId: g.ctx.user.id,
  });
  if (!res.ok) {
    return { ok: false, error: `Not enough credits — this change needs ${res.required}. Top up from Billing.` };
  }
  revalidatePinSurfaces();
  return { ok: true, affectedDevices: res.affectedDevices, creditsCharged: res.creditsCharged, pinnedUrl: v.url };
}

export async function clearOrgPinAction(): Promise<ScopedPinActionResult> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const res = await applyScopedPinChange({
    organizationId: g.organizationId,
    change: { scope: "org", url: null },
    actor: { type: "user", id: g.ctx.user.id, label: g.ctx.user.email },
    via: "ui",
    createdByUserId: g.ctx.user.id,
  });
  if (!res.ok) {
    return { ok: false, error: `Not enough credits — this change needs ${res.required}. Top up from Billing.` };
  }
  revalidatePinSurfaces();
  return { ok: true, affectedDevices: res.affectedDevices, creditsCharged: res.creditsCharged, pinnedUrl: null };
}

export async function setStorePinAction(storeId: string, url: string): Promise<ScopedPinActionResult> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const v = validatePinBody({ url });
  if (!v.ok) return { ok: false, error: v.error };
  const store = await loadTenantStore(storeId, g.organizationId);
  if (!store) return { ok: false, error: "Store not found." };
  const res = await applyScopedPinChange({
    organizationId: g.organizationId,
    change: { scope: "store", storeId, mode: "custom", url: v.url },
    actor: { type: "user", id: g.ctx.user.id, label: g.ctx.user.email },
    via: "ui",
    createdByUserId: g.ctx.user.id,
  });
  if (!res.ok) {
    return { ok: false, error: `Not enough credits — this change needs ${res.required}. Top up from Billing.` };
  }
  revalidatePinSurfaces();
  return { ok: true, affectedDevices: res.affectedDevices, creditsCharged: res.creditsCharged, pinnedUrl: v.url };
}

export async function setStorePinModeAction(
  storeId: string,
  mode: "none" | "inherit",
): Promise<ScopedPinActionResult> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const store = await loadTenantStore(storeId, g.organizationId);
  if (!store) return { ok: false, error: "Store not found." };
  const res = await applyScopedPinChange({
    organizationId: g.organizationId,
    change: { scope: "store", storeId, mode, url: null },
    actor: { type: "user", id: g.ctx.user.id, label: g.ctx.user.email },
    via: "ui",
    createdByUserId: g.ctx.user.id,
  });
  if (!res.ok) {
    return { ok: false, error: `Not enough credits — this change needs ${res.required}. Top up from Billing.` };
  }
  revalidatePinSurfaces();
  return { ok: true, affectedDevices: res.affectedDevices, creditsCharged: res.creditsCharged, pinnedUrl: null };
}

export async function setDevicePinAction(deviceId: string, url: string): Promise<PinActionResult> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const v = validatePinBody({ url });
  if (!v.ok) return { ok: false, error: v.error };
  const device = await loadTenantDevice(deviceId, g.organizationId);
  if (!device) return { ok: false, error: "Device not found." };

  const res = await applyScopedPinChange({
    organizationId: g.organizationId,
    change: { scope: "device", deviceId, mode: "custom", url: v.url },
    actor: { type: "user", id: g.ctx.user.id, label: g.ctx.user.email },
    via: "ui",
    createdByUserId: g.ctx.user.id,
  });
  if (!res.ok) {
    return { ok: false, error: `Not enough credits — this change needs ${res.required}. Top up from Billing.` };
  }

  revalidateDevicePages(device.storeId, deviceId);
  revalidatePath("/tenant/pinned-qr");
  return { ok: true, pinnedUrl: v.url };
}

export async function clearDevicePinAction(deviceId: string): Promise<PinActionResult> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const device = await loadTenantDevice(deviceId, g.organizationId);
  if (!device) return { ok: false, error: "Device not found." };

  const res = await applyScopedPinChange({
    organizationId: g.organizationId,
    change: { scope: "device", deviceId, mode: "inherit", url: null },
    actor: { type: "user", id: g.ctx.user.id, label: g.ctx.user.email },
    via: "ui",
    createdByUserId: g.ctx.user.id,
  });
  if (!res.ok) {
    return { ok: false, error: `Not enough credits — this change needs ${res.required}. Top up from Billing.` };
  }

  revalidateDevicePages(device.storeId, deviceId);
  revalidatePath("/tenant/pinned-qr");
  return { ok: true, pinnedUrl: null };
}

export async function setDevicePinModeAction(
  deviceId: string,
  mode: "none" | "inherit",
): Promise<ScopedPinActionResult> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const device = await loadTenantDevice(deviceId, g.organizationId);
  if (!device) return { ok: false, error: "Device not found." };

  const res = await applyScopedPinChange({
    organizationId: g.organizationId,
    change: { scope: "device", deviceId, mode, url: null },
    actor: { type: "user", id: g.ctx.user.id, label: g.ctx.user.email },
    via: "ui",
    createdByUserId: g.ctx.user.id,
  });
  if (!res.ok) {
    return { ok: false, error: `Not enough credits — this change needs ${res.required}. Top up from Billing.` };
  }

  revalidateDevicePages(device.storeId, deviceId);
  revalidatePath("/tenant/pinned-qr");
  return { ok: true, affectedDevices: res.affectedDevices, creditsCharged: res.creditsCharged, pinnedUrl: null };
}
