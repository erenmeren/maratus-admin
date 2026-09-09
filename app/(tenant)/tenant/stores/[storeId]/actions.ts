"use server";

// Server action: claim (provision) an unclaimed device into a store.
// Binds the device to the store, issues its device key (returned ONCE), and
// consumes the pairing code. Guarded to org owners/admins, and scoped so a
// tenant can only claim into a store they own — claimDevice() additionally
// enforces device.org === store.org, so the device must be in the same org too.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { store as storeTable } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";
import { claimDevice } from "@/lib/device-claim";
import { recordAudit, AUDIT } from "@/lib/audit";
import { isValidPairingCode } from "@/lib/provisioning";

export interface ClaimDeviceResult {
  ok: boolean;
  error?: string;
  deviceName?: string;
  deviceKey?: string;
}

export async function claimDeviceAction(
  storeId: string,
  pairingCodeRaw: string,
): Promise<ClaimDeviceResult> {
  const { ctx, organizationId } = await requireTenant();

  // Authorize: only owners/admins may provision devices.
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !canManageTenant(membership.role)) {
    return { ok: false, error: "You don't have permission to claim devices." };
  }

  // Normalize the pairing code as it is read off the screen: spaces anywhere, and the
  // dash optional (the device shows ABCD-EFGH; people type ABCDEFGH).
  const typed = pairingCodeRaw.replace(/\s+/g, "").toUpperCase();
  const pairingCode = /^[A-HJ-NP-Z2-9]{8}$/.test(typed)
    ? `${typed.slice(0, 4)}-${typed.slice(4)}`
    : typed;
  // A code that cannot have been shown by a device must never reach
  // claimDevice: its create-row path would mint a phantom "New Printer" that
  // occupies a paid slot or gets prorated, while the real device keeps polling.
  if (!isValidPairingCode(pairingCode)) {
    return { ok: false, error: "Enter the 8-character code shown on the printer (e.g. ABCD-EFGH)." };
  }

  // Scope: the target store must belong to the active organization.
  const [store] = await db
    .select({ organizationId: storeTable.organizationId })
    .from(storeTable)
    .where(eq(storeTable.id, storeId))
    .limit(1);
  if (!store || store.organizationId !== organizationId) {
    return { ok: false, error: "Store not found." };
  }

  try {
    const result = await claimDevice(pairingCode, storeId);

    await recordAudit({
      organizationId,
      actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
      action: AUDIT.deviceClaimed,
      target: { type: "device", id: result.deviceId },
    });

    revalidatePath(`/tenant/stores/${storeId}`);
    revalidatePath("/tenant/stores");
    return {
      ok: true,
      deviceName: result.deviceName,
      deviceKey: result.deviceKey,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not claim device.";
    // Friendly mapping for the known throw cases.
    if (message.includes("Unknown pairing code")) {
      return { ok: false, error: "No device found with that pairing code." };
    }
    if (message.includes("already claimed")) {
      return { ok: false, error: "That device has already been claimed." };
    }
    if (message.includes("different organization")) {
      return { ok: false, error: "That device belongs to another account." };
    }
    return { ok: false, error: message };
  }
}
