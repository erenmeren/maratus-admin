"use server";

// Persist org-wide device policy settings to tenant_settings. Owners/admins only.
// On save, nudges every device in the org to re-pull GET /api/device/config.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";
import { normalizeDeviceSettings, hashSettingsPassword } from "@/lib/device-settings";
import { recordAudit, AUDIT } from "@/lib/audit";
import { enqueueConfigChangedForOrg } from "@/lib/data";

export interface SaveDeviceSettingsResult {
  ok: boolean;
  error?: string;
}

export async function saveDeviceSettings(
  formData: FormData,
): Promise<SaveDeviceSettingsResult> {
  const { ctx, organizationId } = await requireTenant();

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !canManageTenant(membership.role)) {
    return { ok: false, error: "You don't have permission to edit device settings." };
  }

  const num = (k: string) => Number(formData.get(k));
  const ds = normalizeDeviceSettings({
    qrVisibleSeconds: num("qrVisibleSeconds"),
    screenBrightness: num("screenBrightness"),
    screenSleepEnabled: formData.get("screenSleepEnabled") === "true",
    screenSleepTimeoutSeconds: num("screenSleepTimeoutSeconds"),
  });

  // Password: clear / set / leave unchanged.
  const clearPassword = formData.get("clearPassword") === "true";
  const newPassword = String(formData.get("password") ?? "").trim();
  let passwordUpdate: {
    deviceSettingsPasswordHash?: string | null;
    deviceSettingsPasswordSalt?: string | null;
  } = {};
  if (clearPassword) {
    passwordUpdate = { deviceSettingsPasswordHash: null, deviceSettingsPasswordSalt: null };
  } else if (newPassword) {
    if (!/^[0-9]{4,12}$/.test(newPassword)) {
      return { ok: false, error: "PIN must be 4–12 digits." };
    }
    const { hash, salt } = hashSettingsPassword(newPassword);
    passwordUpdate = { deviceSettingsPasswordHash: hash, deviceSettingsPasswordSalt: salt };
  }

  const now = new Date();
  await db
    .insert(tenantSettings)
    .values({ organizationId, ...ds, ...passwordUpdate })
    .onConflictDoUpdate({
      target: tenantSettings.organizationId,
      set: { ...ds, ...passwordUpdate, updatedAt: now },
    });

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.deviceSettingsUpdated,
  });

  revalidatePath("/tenant/device-settings");

  // Nudge devices to re-pull config. Best-effort: they also reconcile via ETag.
  try {
    await enqueueConfigChangedForOrg(organizationId, ctx.user.id);
  } catch (err) {
    console.error("config-changed enqueue failed (devices reconcile on next poll)", err);
  }

  return { ok: true };
}
