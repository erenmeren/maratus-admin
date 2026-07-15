"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  tenantSettings,
  apiKey as apiKeyTable,
  invitation as invitationTable,
  factoryDevice,
  auditLog,
} from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { AUDIT, recordAudit } from "@/lib/audit";
import { getBalance } from "@/lib/credits";
import { getOrgDevicesForOffboard } from "@/lib/data";
import { syncDeviceSubscription } from "@/lib/billing/device-subscription";
import { deprovisionDeviceMqtt } from "@/lib/mqtt";
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
        frozenCreditsAvailable: 0,
        frozenCreditsHeld: 0,
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
  // Deprovision the MQTT broker credential for every returned-to-stock device
  // (fail-open — a broker hiccup must never fail the offboard). Outside any
  // DB transaction: each returnDeviceToStock call above already committed.
  for (const id of returnIds) {
    try {
      await deprovisionDeviceMqtt(id);
    } catch (err) {
      console.error("mqtt deprovision after offboard failed", err);
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

  // Step 3: freeze credits (read only) + archive stamp (LAST).
  const balance = await getBalance(organizationId);
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
      .where(and(eq(apiKeyTable.organizationId, organizationId), isNotNull(apiKeyTable.revokedAt)))
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

  // Keep the per-device subscription in sync (fail-open — a Stripe hiccup
  // must never fail an offboard). Covers both the disposition-driven claimed
  // device count drop (return-to-stock deletes rows) and the archive → wind
  // down to "credits" (cancel).
  try {
    await syncDeviceSubscription(organizationId);
  } catch (err) {
    console.error("device-subscription sync after offboard failed", err);
  }

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
  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.orgRestored,
    target: { type: "organization", id: organizationId },
  });

  // Keep the per-device subscription in sync (fail-open) — a restored org's
  // plan is live again, so a flat/base_usage plan should re-create/resume.
  try {
    await syncDeviceSubscription(organizationId);
  } catch (err) {
    console.error("device-subscription sync after restore failed", err);
  }

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${organizationId}`);
  return { ok: true };
}
