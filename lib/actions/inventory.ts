"use server";

// Platform-admin actions for the factory-device registry (/admin/inventory).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/session";
import { isOrgArchived } from "@/lib/archived-guard";
import { parseRegistryCsv } from "@/lib/factory-registry-csv";
import {
  allocateSerials,
  deallocateSerials,
  importFactoryDevices,
  revertRegistryClaim,
  setRegistryStatus,
} from "@/lib/factory-registry";
import { normalizeSerial } from "@/lib/provisioning";
import { AUDIT, recordAudit } from "@/lib/audit";

const MAX_CSV_BYTES = 2 * 1024 * 1024; // ~10k rows is well under 2 MB

// Server actions are a network boundary — a client can call them with any
// payload regardless of the TS signature, so every action re-validates its
// args with zod before touching the DB. `safeParse` (never `parse`) so a bad
// payload returns the action's normal `{ ok: false, ... }` shape instead of
// throwing.

/** Normalizes via `normalizeSerial` and produces the NORMALIZED value, so
 *  every downstream read/write sees the canonical 12-lowercase-hex form. */
const serialSchema = z.string().transform((raw, ctx) => {
  const normalized = normalizeSerial(raw);
  if (!normalized) {
    ctx.addIssue({ code: "custom", message: `Invalid serial "${raw}".` });
    return z.NEVER;
  }
  return normalized;
});

const serialsSchema = z
  .array(serialSchema)
  .min(1, "At least one serial is required.")
  .max(10000);
const nullableString = z.string().max(120).nullable().optional();

const importCsvInputSchema = z.object({ csvText: z.string() });
const addSerialInputSchema = z.object({
  serial: serialSchema,
  batchCode: nullableString,
  hardwareRevision: nullableString,
});
const allocateInputSchema = z.object({
  serials: serialsSchema,
  organizationId: z.string().min(1),
  storeId: z.string().nullable(),
});
const deallocateInputSchema = z.object({ serials: serialsSchema });
const setStatusInputSchema = z.object({
  serial: serialSchema,
  status: z.enum(["rma", "retired"]),
});
const revertClaimInputSchema = z.object({ serial: serialSchema });

export async function importRegistryCsvAction(
  csvText: string,
): Promise<{ ok: boolean; imported: number; errors: string[] }> {
  await requirePlatformAdmin();
  const parsed = importCsvInputSchema.safeParse({ csvText });
  if (!parsed.success) return { ok: false, imported: 0, errors: ["Invalid input."] };
  if (parsed.data.csvText.length > MAX_CSV_BYTES) {
    return { ok: false, imported: 0, errors: ["File too large (max 2 MB)."] };
  }
  const { rows, errors } = parseRegistryCsv(parsed.data.csvText);
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
  const parsed = addSerialInputSchema.safeParse({ serial, batchCode, hardwareRevision });
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  await importFactoryDevices([
    {
      serial: parsed.data.serial,
      batchCode: parsed.data.batchCode || null,
      hardwareRevision: parsed.data.hardwareRevision || null,
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
  const parsed = allocateInputSchema.safeParse({ serials, organizationId, storeId });
  if (!parsed.success) return { ok: false, updated: 0, error: "Invalid input." };
  // An archived org must never be re-armed for zero-touch auto-claim — the
  // picker already excludes archived orgs, but a stale tab / direct call
  // must be refused server-side too.
  if (await isOrgArchived(parsed.data.organizationId)) {
    return { ok: false, updated: 0, error: "Customer is archived." };
  }
  const result = await allocateSerials(
    parsed.data.serials,
    parsed.data.organizationId,
    parsed.data.storeId,
  );
  if (result.error) return { ok: false, updated: 0, error: result.error };
  if (result.updated > 0) {
    await recordAudit({
      organizationId: parsed.data.organizationId,
      actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
      action: AUDIT.registryAllocated,
      target: { type: "registry", id: parsed.data.serials.join(",") },
      metadata: { count: result.updated, storeId: parsed.data.storeId },
    });
  }
  revalidatePath("/admin/inventory");
  return { ok: true, updated: result.updated };
}

export async function deallocateSerialsAction(
  serials: string[],
): Promise<{ ok: boolean; updated: number; error?: string }> {
  const ctx = await requirePlatformAdmin();
  const parsed = deallocateInputSchema.safeParse({ serials });
  if (!parsed.success) return { ok: false, updated: 0, error: "Invalid input." };
  const result = await deallocateSerials(parsed.data.serials);
  // One audit row per previously-allocated org: deallocateSerials snapshots
  // the org each serial belonged to BEFORE clearing it (RETURNING only ever
  // exposes post-update values), so this is the one place that can still
  // attribute the event to the org that lost the allocation.
  for (const [organizationId, orgSerials] of Object.entries(result.byOrg)) {
    await recordAudit({
      organizationId,
      actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
      action: AUDIT.registryDeallocated,
      target: { type: "registry", id: orgSerials.join(",") },
      metadata: { count: orgSerials.length, serials: orgSerials },
    });
  }
  revalidatePath("/admin/inventory");
  return { ok: true, updated: result.updated };
}

export async function setRegistryStatusAction(
  serial: string,
  status: "rma" | "retired",
): Promise<{ ok: boolean; error?: string }> {
  await requirePlatformAdmin();
  const parsed = setStatusInputSchema.safeParse({ serial, status });
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  await setRegistryStatus(parsed.data.serial, parsed.data.status);
  revalidatePath("/admin/inventory");
  return { ok: true };
}

/** Revert a claimed serial back to `allocated`, re-arming zero-touch
 *  auto-claim (RMA-return / hijack-recovery re-provisioning) — see
 *  docs/runbooks/factory-registry-hijack-recovery.md. Platform-admin only,
 *  gated by revertRegistryClaim on the linked device already being deleted. */
export async function revertRegistryClaimAction(
  serial: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePlatformAdmin();
  const parsed = revertClaimInputSchema.safeParse({ serial });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const result = await revertRegistryClaim(parsed.data.serial);
  if (!result.ok) return { ok: false, error: result.error };

  // Attribute the audit event to the org whose pending install this re-arms —
  // organizationId was read under the revert's own FOR UPDATE lock, so it's
  // the org the row belonged to at revert time (no post-commit re-read that a
  // concurrent reallocation could skew). If the row has no allocated org (it
  // landed on the human-claim path), recordAudit has nothing sensible to
  // scope to — skip auditing rather than force a bogus organizationId
  // (recordAudit requires one).
  if (result.organizationId) {
    await recordAudit({
      organizationId: result.organizationId,
      actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
      action: AUDIT.registryClaimReverted,
      target: { type: "registry", id: parsed.data.serial },
      metadata: { serial: parsed.data.serial },
    });
  }
  revalidatePath("/admin/inventory");
  return { ok: true };
}
