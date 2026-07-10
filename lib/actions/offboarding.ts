"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  tenantSettings,
  apiKey as apiKeyTable,
  invitation as invitationTable,
  factoryDevice,
} from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { AUDIT, recordAudit } from "@/lib/audit";
import { getBalance } from "@/lib/credits";
import {
  returnDeviceToStock,
  retireDeviceWithCustomer,
  deallocateSerials,
} from "@/lib/factory-registry";
import {
  partitionDispositions,
  buildOffboardMetadata,
  type DeviceChoice,
  type OffboardSummary,
} from "@/lib/offboarding";

export async function offboardCustomerAction(
  organizationId: string,
  choices: DeviceChoice[],
  note: string | null,
): Promise<{ ok: boolean; error?: string; summary?: OffboardSummary }> {
  const ctx = await requirePlatformAdmin();
  const normalizedNote = note || null;

  const { returnIds, leaveIds } = partitionDispositions(choices);

  // Step 1: device dispositions (each helper is idempotent).
  let returnedToStock = 0;
  for (const id of returnIds) {
    const r = await returnDeviceToStock(id);
    if (r.ok && r.deviceName !== null) {
      returnedToStock++;
      await recordAudit({
        organizationId,
        actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
        action: AUDIT.deviceReturnedToStock,
        target: { type: "device", id },
        metadata: { serial: r.serial, deviceName: r.deviceName },
      });
    }
  }
  let leftWithCustomer = 0;
  for (const id of leaveIds) {
    const r = await retireDeviceWithCustomer(id);
    if (r.ok && r.deviceName !== null) {
      leftWithCustomer++;
      await recordAudit({
        organizationId,
        actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
        action: AUDIT.deviceLeftWithCustomer,
        target: { type: "device", id },
        metadata: { serial: r.serial, deviceName: r.deviceName },
      });
    }
  }

  // Allocation sweep: any still-allocated serials for this org → manufactured.
  const orgAllocatedSerials = await db
    .select({ serial: factoryDevice.serial })
    .from(factoryDevice)
    .where(
      and(
        eq(factoryDevice.allocatedOrganizationId, organizationId),
        eq(factoryDevice.status, "allocated"),
      ),
    );
  const sweep = await deallocateSerials(orgAllocatedSerials.map((r) => r.serial));

  // Step 2: access shutdown — revoke keys, cancel pending invitations.
  const revoked = await db
    .update(apiKeyTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeyTable.organizationId, organizationId), isNull(apiKeyTable.revokedAt)))
    .returning({ id: apiKeyTable.id });
  await db
    .update(invitationTable)
    .set({ status: "canceled" })
    .where(and(eq(invitationTable.organizationId, organizationId), eq(invitationTable.status, "pending")));

  // Step 3: freeze credits (read only) + archive stamp (LAST).
  const balance = await getBalance(organizationId);
  const summary: OffboardSummary = {
    returnedToStock,
    leftWithCustomer,
    revokedKeys: revoked.length,
    sweptAllocations: sweep.updated,
    frozenCreditsAvailable: balance.available,
    frozenCreditsHeld: balance.held,
  };

  await db
    .update(tenantSettings)
    .set({ archivedAt: new Date(), archivedNote: normalizedNote })
    .where(eq(tenantSettings.organizationId, organizationId));

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.orgArchived,
    target: { type: "organization", id: organizationId },
    metadata: buildOffboardMetadata(summary, normalizedNote),
  });

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${organizationId}`);
  return { ok: true, summary };
}

export async function restoreCustomerAction(
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePlatformAdmin();
  await db
    .update(tenantSettings)
    .set({ archivedAt: null, archivedNote: null })
    .where(eq(tenantSettings.organizationId, organizationId));
  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.orgRestored,
    target: { type: "organization", id: organizationId },
  });
  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${organizationId}`);
  return { ok: true };
}
