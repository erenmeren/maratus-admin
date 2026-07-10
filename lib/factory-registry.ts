// Factory-inventory data layer: import, allocation, and the claim-side
// serial operations (one-shot auto-claim + serial stamping). Pure decision
// logic lives in lib/provisioning.ts / lib/factory-registry-csv.ts.

import { and, count, eq, ilike, inArray, isNull, sql, TransactionRollbackError } from "drizzle-orm";
import { db, dbTx } from "./db";
import {
  device as deviceTable,
  factoryDevice,
  organization as orgTable,
  store as storeTable,
} from "./db/schema";
import { AUDIT, recordAudit } from "./audit";
import { chunk } from "./chunk";
import { generateDeviceKey, id } from "./ids";
import type { RegistryAllocationSnapshot, RegistryStatus } from "./provisioning";
import type { RegistryCsvRow } from "./factory-registry-csv";
import { clampPage, foldDeallocatedByOrg } from "./factory-registry-fold";

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505";
}

// One multi-row INSERT ... ON CONFLICT DO UPDATE per chunk instead of one
// round trip per row — a 10k-row CSV is 20 statements, not 10k.
const IMPORT_CHUNK_SIZE = 500;

/** Idempotent upsert of parsed CSV rows (re-import updates, never duplicates).
 *  Precondition: `rows` MUST be pre-deduped by serial — a serial repeated
 *  within one call lands in one multi-row INSERT and Postgres rejects it with
 *  "ON CONFLICT DO UPDATE command cannot affect row a second time". Current
 *  callers guarantee this: parseRegistryCsv Map-dedupes by serial, and
 *  addSerialAction passes a single row. */
export async function importFactoryDevices(
  rows: RegistryCsvRow[],
): Promise<{ imported: number }> {
  for (const batch of chunk(rows, IMPORT_CHUNK_SIZE)) {
    await db
      .insert(factoryDevice)
      .values(
        batch.map((row) => ({
          serial: row.serial,
          batchCode: row.batchCode,
          hardwareRevision: row.hardwareRevision,
          manufacturedAt: row.manufacturedAt,
        })),
      )
      .onConflictDoUpdate({
        target: factoryDevice.serial,
        set: {
          // Coalesce against the incoming (EXCLUDED) row so a serial-only
          // re-import (no batch metadata in that CSV) doesn't null out
          // batch/revision/manufacture data set by an earlier import. Postgres
          // resolves `excluded` per conflicting row, so this holds even when
          // the statement carries hundreds of rows at once.
          batchCode: sql`coalesce(excluded.batch_code, ${factoryDevice.batchCode})`,
          hardwareRevision: sql`coalesce(excluded.hardware_revision, ${factoryDevice.hardwareRevision})`,
          manufacturedAt: sql`coalesce(excluded.manufactured_at, ${factoryDevice.manufacturedAt})`,
        },
      });
  }
  return { imported: rows.length };
}

export interface InventoryRow {
  serial: string;
  batchCode: string | null;
  hardwareRevision: string | null;
  status: "manufactured" | "allocated" | "claimed" | "rma" | "retired";
  unregistered: boolean;
  allocatedOrganizationId: string | null;
  allocatedOrgName: string | null;
  allocatedStoreId: string | null;
  allocatedStoreName: string | null;
  deviceId: string | null;
  deviceName: string | null;
  manufacturedAt: Date | null;
  allocatedAt: Date | null;
  claimedAt: Date | null;
}

export interface InventoryPage {
  rows: InventoryRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Server-paginated + server-filtered registry listing for the admin inventory
 * table. Mirrors the getOrgAuditPage precedent (lib/data.ts): count first,
 * clamp the requested page into range, then select that page's window.
 */
export async function getFactoryDevicePage(opts: {
  page: number;
  pageSize?: number;
  status?: RegistryStatus | "all";
  batch?: string;
}): Promise<InventoryPage> {
  const pageSize = opts.pageSize ?? 50;
  const batch = opts.batch?.trim();

  const conditions = [
    opts.status && opts.status !== "all" ? eq(factoryDevice.status, opts.status) : undefined,
    batch ? ilike(factoryDevice.batchCode, `%${batch}%`) : undefined,
  ].filter((c) => c !== undefined);
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(factoryDevice).where(where);
  // Clamp into the valid range so an over-range ?page= shows the last page
  // with data (not an empty table reading "Page 99 of 2").
  const { safePage, pageCount } = clampPage(opts.page, total, pageSize);

  const rows = await db
    .select({
      serial: factoryDevice.serial,
      batchCode: factoryDevice.batchCode,
      hardwareRevision: factoryDevice.hardwareRevision,
      status: factoryDevice.status,
      unregistered: factoryDevice.unregistered,
      allocatedOrganizationId: factoryDevice.allocatedOrganizationId,
      allocatedOrgName: orgTable.name,
      allocatedStoreId: factoryDevice.allocatedStoreId,
      allocatedStoreName: storeTable.name,
      deviceId: factoryDevice.deviceId,
      deviceName: deviceTable.name,
      manufacturedAt: factoryDevice.manufacturedAt,
      allocatedAt: factoryDevice.allocatedAt,
      claimedAt: factoryDevice.claimedAt,
    })
    .from(factoryDevice)
    .leftJoin(orgTable, eq(factoryDevice.allocatedOrganizationId, orgTable.id))
    .leftJoin(storeTable, eq(factoryDevice.allocatedStoreId, storeTable.id))
    .leftJoin(deviceTable, eq(factoryDevice.deviceId, deviceTable.id))
    .where(where)
    .orderBy(factoryDevice.serial)
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  return { rows, total, page: safePage, pageSize, pageCount };
}

const ALL_REGISTRY_STATUSES: RegistryStatus[] = [
  "manufactured", "allocated", "claimed", "rma", "retired",
];

/** Cheap grouped count across the WHOLE registry (ignores filters) so the
 *  inventory page's KPI tiles stay correct regardless of which page/filter
 *  the table is currently showing. */
export async function getFactoryStatusCounts(): Promise<Record<RegistryStatus, number>> {
  const rows = await db
    .select({ status: factoryDevice.status, total: count() })
    .from(factoryDevice)
    .groupBy(factoryDevice.status);
  const counts = Object.fromEntries(ALL_REGISTRY_STATUSES.map((s) => [s, 0])) as Record<
    RegistryStatus,
    number
  >;
  for (const r of rows) counts[r.status] = r.total;
  return counts;
}

export async function getRegistryBySerial(
  serial: string,
): Promise<RegistryAllocationSnapshot | null> {
  const [row] = await db
    .select({
      status: factoryDevice.status,
      allocatedOrganizationId: factoryDevice.allocatedOrganizationId,
      allocatedStoreId: factoryDevice.allocatedStoreId,
    })
    .from(factoryDevice)
    .where(eq(factoryDevice.serial, serial))
    .limit(1);
  return row ?? null;
}

/**
 * Allocate serials to a customer (+ optional store). Only rows still in
 * `manufactured` or `allocated` move; claimed/rma/retired rows are skipped.
 */
export async function allocateSerials(
  serials: string[],
  organizationId: string,
  storeId: string | null,
): Promise<{ updated: number; error?: string }> {
  if (serials.length === 0) return { updated: 0 };
  const [org] = await db
    .select({ id: orgTable.id })
    .from(orgTable)
    .where(eq(orgTable.id, organizationId))
    .limit(1);
  if (!org) return { updated: 0, error: "Customer not found." };
  if (storeId) {
    const [st] = await db
      .select({ organizationId: storeTable.organizationId })
      .from(storeTable)
      .where(eq(storeTable.id, storeId))
      .limit(1);
    if (!st || st.organizationId !== organizationId) {
      return { updated: 0, error: "Store does not belong to this customer." };
    }
  }
  const updated = await db
    .update(factoryDevice)
    .set({
      status: "allocated",
      allocatedOrganizationId: organizationId,
      allocatedStoreId: storeId,
      allocatedAt: new Date(),
    })
    .where(
      and(
        inArray(factoryDevice.serial, serials),
        inArray(factoryDevice.status, ["manufactured", "allocated"]),
      ),
    )
    .returning({ serial: factoryDevice.serial });
  return { updated: updated.length };
}

/**
 * Revert unclaimed allocations back to `manufactured`. Also returns `byOrg`
 * (previous `allocatedOrganizationId` → serials actually deallocated) so the
 * caller can audit-log per org — `RETURNING` only ever exposes POST-update
 * values, so the previous owner must be read separately. The SELECT and the
 * UPDATE run inside one transaction, with the SELECT taking `FOR UPDATE` row
 * locks and the UPDATE scoped to exactly the serials that SELECT locked (not
 * the caller's raw `serials` list), so a concurrent reallocation (allocated→
 * allocated moves are legal in allocateSerials) blocks until this commits and
 * the UPDATE can never touch a row outside the locked snapshot: `byOrg` is
 * always attributed to the org each updated row belonged to at lock time.
 * Rows that left `allocated` before we lock simply don't appear in the locked
 * snapshot and are excluded from both `updated` and `byOrg`.
 */
export async function deallocateSerials(
  serials: string[],
): Promise<{ updated: number; byOrg: Record<string, string[]> }> {
  if (serials.length === 0) return { updated: 0, byOrg: {} };

  return dbTx.transaction(async (tx) => {
    const before = await tx
      .select({
        serial: factoryDevice.serial,
        allocatedOrganizationId: factoryDevice.allocatedOrganizationId,
      })
      .from(factoryDevice)
      .where(and(inArray(factoryDevice.serial, serials), eq(factoryDevice.status, "allocated")))
      .for("update");

    if (before.length === 0) return { updated: 0, byOrg: {} };

    const lockedSerials = before.map((r) => r.serial);
    const updated = await tx
      .update(factoryDevice)
      .set({
        status: "manufactured",
        allocatedOrganizationId: null,
        allocatedStoreId: null,
        allocatedAt: null,
      })
      .where(
        and(inArray(factoryDevice.serial, lockedSerials), eq(factoryDevice.status, "allocated")),
      )
      .returning({ serial: factoryDevice.serial });

    const byOrg = foldDeallocatedByOrg(
      before.map((r) => ({ serial: r.serial, organizationId: r.allocatedOrganizationId })),
      updated.map((r) => r.serial),
    );

    return { updated: updated.length, byOrg };
  });
}

export async function setRegistryStatus(
  serial: string,
  status: "rma" | "retired",
): Promise<void> {
  await db.update(factoryDevice).set({ status }).where(eq(factoryDevice.serial, serial));
}

/**
 * Revert a `claimed` registry row back to `allocated`, re-arming zero-touch
 * auto-claim for this serial — the RMA-return / hijack-recovery
 * re-provisioning path (see docs/runbooks/factory-registry-hijack-recovery.md).
 * This is deliberately gated: it refuses while a live `device` row is still
 * linked (the runbook's step order — delete the device first, then revert),
 * so re-arming can never race a device that's still using the old key. Mirrors
 * `deallocateSerials`'s transaction shape: one `dbTx` transaction, `SELECT ...
 * FOR UPDATE` to lock the row before deciding, then the UPDATE. Allocation
 * columns (`allocatedOrganizationId`/`allocatedStoreId`) are left untouched —
 * that's what re-arms the pending install for the same customer/store.
 *
 * On success, `organizationId` is the row's `allocatedOrganizationId` read
 * under the same FOR UPDATE lock (null when the row has no allocation), so
 * the caller can attribute the audit event without a post-commit re-read —
 * same reason deallocateSerials returns `byOrg` from inside its transaction.
 */
export async function revertRegistryClaim(
  serial: string,
): Promise<{ ok: boolean; error?: string; organizationId?: string | null }> {
  return dbTx.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: factoryDevice.status,
        deviceId: factoryDevice.deviceId,
        allocatedOrganizationId: factoryDevice.allocatedOrganizationId,
      })
      .from(factoryDevice)
      .where(eq(factoryDevice.serial, serial))
      .for("update");

    if (!row || row.status !== "claimed") {
      return { ok: false, error: "Serial is not currently claimed." };
    }
    if (row.deviceId) {
      return { ok: false, error: "Delete the linked device first." };
    }

    await tx
      .update(factoryDevice)
      .set({ status: "allocated", claimedAt: null })
      .where(eq(factoryDevice.serial, serial));

    return { ok: true, organizationId: row.allocatedOrganizationId };
  });
}

/**
 * One-shot zero-touch claim for a pre-allocated serial. The claim-lock UPDATE
 * on `factory_device` (allocated→claimed), the new `device` INSERT, and the
 * deviceId link-back UPDATE all run inside one `dbTx` transaction, so the
 * three writes commit or roll back together — a racing second poll gets 0
 * rows and falls back to pending, and any failure (insert collision or
 * otherwise) restores the registry row to `allocated` via rollback instead of
 * a manual compensating update. Returns null (→ caller responds "pending") on
 * any race/collision; per spec the key is delivered and consumed in this same
 * response, so pendingDeviceKey is never persisted.
 */
export async function autoClaimDevice(
  serial: string,
  pairingCode: string,
): Promise<{ deviceKey: string; deviceId: string; organizationId: string } | null> {
  const { key, hash } = generateDeviceKey();
  const deviceId = id("dev");
  let claimedOrganizationId: string | null = null;

  try {
    await dbTx.transaction(async (tx) => {
      const [locked] = await tx
        .update(factoryDevice)
        .set({ status: "claimed", claimedAt: new Date() })
        .where(and(eq(factoryDevice.serial, serial), eq(factoryDevice.status, "allocated")))
        .returning({
          organizationId: factoryDevice.allocatedOrganizationId,
          storeId: factoryDevice.allocatedStoreId,
        });
      if (!locked || !locked.organizationId || !locked.storeId) {
        // No row hijacked (already claimed/raced), or an incomplete
        // allocation that shouldAutoClaim should have filtered — either way,
        // abort so the rollback restores `allocated` and fall back to the
        // human path.
        tx.rollback();
        return;
      }

      await tx.insert(deviceTable).values({
        id: deviceId,
        organizationId: locked.organizationId,
        storeId: locked.storeId,
        name: `Printer ${serial.slice(-4)}`,
        status: "offline",
        connectionType: "wifi",
        firmwareVersion: "2.4.1",
        pairingCode, // kept, mirrors claimDevice — the code stays pollable
        serial,
        deviceKeyHash: hash,
        pendingDeviceKey: null, // delivered + consumed in this same response
        claimedAt: new Date(),
        createdAt: new Date(),
      });
      // A pairing-code or serial unique collision throws here, which rolls
      // back the lock update above along with the failed insert.

      await tx.update(factoryDevice).set({ deviceId }).where(eq(factoryDevice.serial, serial));

      claimedOrganizationId = locked.organizationId;
    });
  } catch (err) {
    if (err instanceof TransactionRollbackError) return null;
    if (isUniqueViolation(err)) return null;
    throw err;
  }

  if (!claimedOrganizationId) return null; // defensive; unreachable in practice

  // Best-effort by design: audit failures must not unwind a claim that has
  // already committed, so this runs after (never inside) the transaction.
  await recordAudit({
    organizationId: claimedOrganizationId,
    actor: { type: "system" },
    action: AUDIT.deviceAutoClaimed,
    target: { type: "device", id: deviceId },
    metadata: { serial },
  });
  return { deviceKey: key, deviceId, organizationId: claimedOrganizationId };
}

/**
 * Stamp a human-claimed device with its serial at key delivery, then link (or
 * self-register) the registry row. A unique-index hit means the same physical
 * serial claimed twice: the new row keeps serial=null, gets serialConflict,
 * and the event is audited — nothing is silently overwritten.
 */
/**
 * Offboarding "return to stock": delete the device row (commands cascade; the
 * key hash dies with it) and, if the device carried a serial, revert that
 * registry row to `manufactured` clearing all allocation/claim linkage — the
 * serial becomes re-allocatable. One transaction; idempotent (missing device →
 * ok with null serial). Audit is recorded by the caller (needs the org id).
 */
export async function returnDeviceToStock(
  deviceId: string,
): Promise<{ ok: boolean; changed: boolean; serial: string | null; deviceName: string | null }> {
  return dbTx.transaction(async (tx) => {
    const [dev] = await tx
      .select({ id: deviceTable.id, name: deviceTable.name, serial: deviceTable.serial })
      .from(deviceTable)
      .where(eq(deviceTable.id, deviceId))
      .for("update");
    // Missing device row → already returned (or never existed): idempotent no-op.
    if (!dev) return { ok: true, changed: false, serial: null, deviceName: null };

    if (dev.serial) {
      await tx
        .update(factoryDevice)
        .set({
          status: "manufactured",
          allocatedOrganizationId: null,
          allocatedStoreId: null,
          deviceId: null,
          claimedAt: null,
        })
        .where(eq(factoryDevice.deviceId, deviceId));
    }
    await tx.delete(deviceTable).where(eq(deviceTable.id, deviceId));
    return { ok: true, changed: true, serial: dev.serial, deviceName: dev.name };
  });
}

/**
 * Offboarding "leave with customer": pause the device and mark its registry row
 * `retired` (deviceId kept, for traceability). Idempotent.
 */
export async function retireDeviceWithCustomer(
  deviceId: string,
): Promise<{ ok: boolean; changed: boolean; serial: string | null; deviceName: string | null }> {
  return dbTx.transaction(async (tx) => {
    const [dev] = await tx
      .select({ id: deviceTable.id, name: deviceTable.name, serial: deviceTable.serial, status: deviceTable.status })
      .from(deviceTable)
      .where(eq(deviceTable.id, deviceId))
      .for("update");
    // Missing device row → nothing to retire: idempotent no-op.
    if (!dev) return { ok: true, changed: false, serial: null, deviceName: null };

    // The row is never deleted, so distinguish "already retired" from a real
    // transition by inspecting current state: device paused AND (no serial, or
    // registry row already `retired`) means a prior run already did this work.
    let registryRetired = true;
    if (dev.serial) {
      const [reg] = await tx
        .select({ status: factoryDevice.status })
        .from(factoryDevice)
        .where(eq(factoryDevice.deviceId, deviceId));
      registryRetired = reg?.status === "retired";
    }
    if (dev.status === "paused" && registryRetired) {
      return { ok: true, changed: false, serial: dev.serial, deviceName: dev.name };
    }

    await tx.update(deviceTable).set({ status: "paused" }).where(eq(deviceTable.id, deviceId));
    if (dev.serial) {
      await tx
        .update(factoryDevice)
        .set({ status: "retired" })
        .where(eq(factoryDevice.deviceId, deviceId));
    }
    return { ok: true, changed: true, serial: dev.serial, deviceName: dev.name };
  });
}

export async function stampDeviceSerial(
  deviceId: string,
  organizationId: string,
  serial: string,
): Promise<void> {
  try {
    const stamped = await db
      .update(deviceTable)
      .set({ serial })
      .where(and(eq(deviceTable.id, deviceId), isNull(deviceTable.serial)))
      .returning({ id: deviceTable.id });
    if (stamped.length === 0) return; // already stamped
  } catch (err) {
    if (isUniqueViolation(err)) {
      await db
        .update(deviceTable)
        .set({ serialConflict: true })
        .where(eq(deviceTable.id, deviceId));
      await recordAudit({
        organizationId,
        actor: { type: "system" },
        action: AUDIT.deviceSerialConflict,
        target: { type: "device", id: deviceId },
        metadata: { serial },
      });
      return;
    }
    throw err;
  }

  const [existing] = await db
    .select({
      status: factoryDevice.status,
      allocatedOrganizationId: factoryDevice.allocatedOrganizationId,
      notes: factoryDevice.notes,
    })
    .from(factoryDevice)
    .where(eq(factoryDevice.serial, serial))
    .limit(1);
  if (existing) {
    if (existing.status === "retired") {
      // A retired serial stays retired and visible as such: link the device
      // for traceability, but do NOT flip status back to "claimed" — that
      // would hide the retirement from the inventory view.
      await db
        .update(factoryDevice)
        .set({ deviceId, claimedAt: sql`coalesce(${factoryDevice.claimedAt}, now())` })
        .where(eq(factoryDevice.serial, serial));
    } else {
      await db
        .update(factoryDevice)
        .set({
          status: "claimed",
          deviceId,
          claimedAt: sql`coalesce(${factoryDevice.claimedAt}, now())`,
        })
        .where(eq(factoryDevice.serial, serial));
    }

    // Cross-org claim: this serial was allocated to one org's pending
    // install but a different org's device just consumed it (silent
    // allocation consumption). Flag it against the org that lost the pending
    // install — best-effort, wrapped so a failure here can never unwind the
    // stamp that already committed above.
    if (existing.allocatedOrganizationId && existing.allocatedOrganizationId !== organizationId) {
      try {
        await recordAudit({
          organizationId: existing.allocatedOrganizationId,
          actor: { type: "system" },
          action: AUDIT.registryAllocationConflict,
          target: { type: "device", id: deviceId },
          metadata: { serial, claimingOrganizationId: organizationId, deviceId },
        });
        const conflictNote = `claimed by another organization (${organizationId}) on ${new Date().toISOString()}`;
        const nextNotes = existing.notes ? `${existing.notes}\n${conflictNote}` : conflictNote;
        await db
          .update(factoryDevice)
          .set({ notes: nextNotes })
          .where(eq(factoryDevice.serial, serial));
      } catch (err) {
        console.error("[factory-registry] cross-org claim audit failed", serial, err);
      }
    }
  } else {
    // Self-registration: serial was never imported (registry works even empty).
    try {
      await db.insert(factoryDevice).values({
        serial,
        status: "claimed",
        unregistered: true,
        deviceId,
        claimedAt: new Date(),
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Two concurrent polls self-registering the same serial: the other
      // request's insert already created the row. Treat as success — the
      // row exists, which is all this branch is trying to guarantee.
    }
  }
}
