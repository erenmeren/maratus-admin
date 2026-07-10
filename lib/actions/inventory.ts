"use server";

// Platform-admin actions for the factory-device registry (/admin/inventory).

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/session";
import { parseRegistryCsv } from "@/lib/factory-registry-csv";
import {
  allocateSerials,
  deallocateSerials,
  importFactoryDevices,
  setRegistryStatus,
} from "@/lib/factory-registry";
import { normalizeSerial } from "@/lib/provisioning";
import { AUDIT, recordAudit } from "@/lib/audit";

const MAX_CSV_BYTES = 2 * 1024 * 1024; // ~10k rows is well under 2 MB

export async function importRegistryCsvAction(
  csvText: string,
): Promise<{ ok: boolean; imported: number; errors: string[] }> {
  await requirePlatformAdmin();
  if (csvText.length > MAX_CSV_BYTES) {
    return { ok: false, imported: 0, errors: ["File too large (max 2 MB)."] };
  }
  const { rows, errors } = parseRegistryCsv(csvText);
  if (rows.length === 0) {
    return { ok: false, imported: 0, errors: errors.length ? errors : ["No valid rows found."] };
  }
  const { imported } = await importFactoryDevices(rows);
  revalidatePath("/admin/inventory");
  return { ok: true, imported, errors };
}

/** Single-serial add (barcode-scanner entry point) — same coalescing upsert
 *  path as CSV import, just with a one-row batch. */
export async function addSerialAction(
  serial: string,
  batchCode?: string | null,
  hardwareRevision?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  await requirePlatformAdmin();
  const normalized = normalizeSerial(serial);
  if (!normalized) {
    return { ok: false, error: `Invalid serial "${serial}".` };
  }
  await importFactoryDevices([
    {
      serial: normalized,
      batchCode: batchCode || null,
      hardwareRevision: hardwareRevision || null,
      manufacturedAt: null,
    },
  ]);
  revalidatePath("/admin/inventory");
  return { ok: true };
}

export async function allocateSerialsAction(
  serials: string[],
  organizationId: string,
  storeId: string | null,
): Promise<{ ok: boolean; updated: number; error?: string }> {
  const ctx = await requirePlatformAdmin();
  const result = await allocateSerials(serials, organizationId, storeId);
  if (result.error) return { ok: false, updated: 0, error: result.error };
  if (result.updated > 0) {
    await recordAudit({
      organizationId,
      actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
      action: AUDIT.registryAllocated,
      target: { type: "registry", id: serials.join(",") },
      metadata: { count: result.updated, storeId },
    });
  }
  revalidatePath("/admin/inventory");
  return { ok: true, updated: result.updated };
}

export async function deallocateSerialsAction(
  serials: string[],
): Promise<{ ok: boolean; updated: number }> {
  await requirePlatformAdmin();
  const result = await deallocateSerials(serials);
  // deallocateSerialsAction intentionally skips recordAudit: the rows lose their org
  // reference at deallocation and recordAudit requires an organizationId. If needed,
  // fetch the previous allocatedOrganizationId per serial before deallocating.
  revalidatePath("/admin/inventory");
  return { ok: true, updated: result.updated };
}

export async function setRegistryStatusAction(
  serial: string,
  status: "rma" | "retired",
): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  await setRegistryStatus(serial, status);
  revalidatePath("/admin/inventory");
  return { ok: true };
}
