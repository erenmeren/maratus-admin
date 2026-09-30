"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  tenantSettings,
  apiKey as apiKeyTable,
  device as deviceTable,
  invitation as invitationTable,
  factoryDevice,
  auditLog,
} from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { AUDIT, recordAudit } from "@/lib/audit";
import { getOrgDevicesForOffboard } from "@/lib/data";
import { fillFreeSlots } from "@/lib/invoices";
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

const offboardChoicesSchema = z.array(
  z.object({
    deviceId: z.string().min(1),
    disposition: z.enum(["return_to_stock", "leave_with_customer"]),
  }),
);

/** Count of this org's audit rows for a given action — used to report
 *  END-STATE device-disposition totals (not just this run's delta), so a
 *  recovery re-run still shows the true cumulative counts. */
async function countOrgAuditAction(organizationId: string, action: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(auditLog)
    .where(and(eq(auditLog.organizationId, organizationId), eq(auditLog.action, action)));
  return row?.total ?? 0;
}

export async function offboardCustomerAction(
  organizationId: string,
  choices: DeviceChoice[],
  note: string | null,
): Promise<{ ok: boolean; error?: string; summary?: OffboardSummary }> {
  const ctx = await requirePlatformAdmin();

  const parsedChoices = offboardChoicesSchema.safeParse(choices);
  if (!parsedChoices.success) {
    return { ok: false, error: "Invalid offboarding request." };
  }

  const normalizedNote = note || null;

  // Idempotency gate: if the org is already archived, do NOT re-run the
  // dispositions/sweep/revoke or re-stamp/re-audit. archivedAt is written LAST
  // in a successful run, so a non-null value means a prior run fully completed.
  const [existing] = await db
    .select({ archivedAt: tenantSettings.archivedAt })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, organizationId))
    .limit(1);
  if (existing?.archivedAt) {
    return {
      ok: true,
      summary: {
        returnedToStock: 0,
        leftWithCustomer: 0,
        revokedKeys: 0,
        sweptAllocations: 0,
      },
    };
  }

  // `choices` is client-trusted input — re-validate against the org's real
  // devices before touching anything:
  //  - a deviceId that doesn't belong to this org is refused outright.
  //  - a device that DOES belong to the org but is missing from `choices`
  //    (added between wizard render and confirm) defaults to
  //    return_to_stock, so no device is silently left behind.
  const orgDevices = await getOrgDevicesForOffboard(organizationId);
  const orgDeviceIds = new Set(orgDevices.map((d) => d.id));
  if (choices.some((c) => !orgDeviceIds.has(c.deviceId))) {
    return { ok: false, error: "Invalid device in offboarding request." };
  }
  const choiceIds = new Set(choices.map((c) => c.deviceId));
  const effectiveChoices: DeviceChoice[] = [
    ...choices,
    ...orgDevices
      .filter((d) => !choiceIds.has(d.id))
      .map((d) => ({ deviceId: d.id, disposition: "return_to_stock" as const })),
  ];

  const { returnIds, leaveIds } = partitionDispositions(effectiveChoices);

  // Step 1: device dispositions (each helper is idempotent). Per-run counts
  // aren't tracked here — the summary below counts END-STATE audit rows so a
  // recovery re-run still reports true totals (see Step 3).
  for (const id of returnIds) {
    const r = await returnDeviceToStock(id);
    if (r.ok && r.changed) {
      await recordAudit({
        organizationId,
        actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
        action: AUDIT.deviceReturnedToStock,
        target: { type: "device", id },
        metadata: { serial: r.serial, deviceName: r.deviceName },
      });
    }
  }

  for (const id of leaveIds) {
    const r = await retireDeviceWithCustomer(id);
    if (r.ok && r.changed) {
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
  await db
    .update(apiKeyTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeyTable.organizationId, organizationId), isNull(apiKeyTable.revokedAt)));
  await db
    .update(invitationTable)
    .set({ status: "canceled" })
    .where(and(eq(invitationTable.organizationId, organizationId), eq(invitationTable.status, "pending")));

  // Step 3: archive stamp (LAST).
  // Summary reflects END STATE at archive time, not just this run's delta —
  // a recovery re-run (after a partial failure left archivedAt null) must
  // still report the true cumulative totals, or the archived-detail summary
  // card would show zeros on the run that actually completes the archive.
  const [returnedToStockTotal, leftWithCustomerTotal, revokedKeysTotal] = await Promise.all([
    countOrgAuditAction(organizationId, AUDIT.deviceReturnedToStock),
    countOrgAuditAction(organizationId, AUDIT.deviceLeftWithCustomer),
    // END-STATE like the two counters above: counts ALL revoked keys for the
    // org, not just ones revoked by this run — intentional, don't narrow to
    // a per-run count.
    db
      .select({ total: count() })
      .from(apiKeyTable)
      // Ephemeral docs-playground keys (non-null expiresAt) are excluded — they
      // are not user-managed keys and would inflate the "revoked keys" count.
      .where(
        and(
          eq(apiKeyTable.organizationId, organizationId),
          isNotNull(apiKeyTable.revokedAt),
          isNull(apiKeyTable.expiresAt),
        ),
      )
      .then(([row]) => row?.total ?? 0),
  ]);
  const summary: OffboardSummary = {
    returnedToStock: returnedToStockTotal,
    leftWithCustomer: leftWithCustomerTotal,
    revokedKeys: revokedKeysTotal,
    // Run-scoped (best-effort): the sweep only ever touches this run's
    // still-allocated serials, so there's no meaningful cumulative total to
    // recompute — unlike the counters above, a re-run legitimately reports 0
    // here once the prior run already swept everything.
    sweptAllocations: sweep.updated,
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

  // No-op guard: if the org is already active (or has no tenantSettings row
  // at all), there's nothing to restore — return early WITHOUT writing a
  // spurious org.restored audit row.
  const [existing] = await db
    .select({ archivedAt: tenantSettings.archivedAt })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, organizationId))
    .limit(1);
  if (!existing?.archivedAt) {
    return { ok: true };
  }

  await db
    .update(tenantSettings)
    .set({ archivedAt: null, archivedNote: null })
    .where(eq(tenantSettings.organizationId, organizationId));

  // Un-retire the registry rows of devices this customer still has. A
  // "leave with customer" offboard marked them `retired`, and lib/invoices.ts
  // excludes `retired`/`rma` rows from BOTH free-slot activation and
  // proration issuance — so a restored customer's devices would be unpaid AND
  // invisible to every billing path. No invoice could ever make them work
  // again; recovery would be surgery (delete the device, revert the registry
  // claim, re-claim). Before the slot model, restore left a paid-if-paused
  // device that simply worked once unpaused, so leaving this would be a
  // regression against shipped behaviour.
  //
  // Scoped to rows still LINKED to a live device of THIS org: a retirement
  // recorded against hardware that has since left is genuine and stays.
  // `claimed` is the status to return to — the device row exists and is
  // claimed. (The device itself stays paused, as it did before this branch;
  // the tenant resumes it.)
  //
  // Fail-open: the archive stamp is already cleared above, which is the part
  // the operator asked for.
  try {
    await db
      .update(factoryDevice)
      .set({ status: "claimed" })
      .where(
        and(
          eq(factoryDevice.status, "retired"),
          inArray(
            factoryDevice.deviceId,
            db
              .select({ id: deviceTable.id })
              .from(deviceTable)
              .where(eq(deviceTable.organizationId, organizationId)),
          ),
        ),
      );
  } catch (err) {
    console.error("[offboarding] un-retiring registry rows on restore failed", err);
  }

  // Retirement cleared subscriptionPaidAt on every device but left
  // paidDeviceSlots intact (the customer's entitlement). Put the devices back
  // into those slots now, oldest claim first — otherwise they stay unpaid and
  // every trigger is refused after the trial. Fail-open, like the un-retire.
  try {
    await fillFreeSlots({
      organizationId,
      actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    });
  } catch (err) {
    console.error("[offboarding] re-activating devices into paid slots on restore failed", err);
  }

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
