// Factory-inventory data layer: import, allocation, and the claim-side
// serial operations (one-shot auto-claim + serial stamping). Pure decision
// logic lives in lib/provisioning.ts / lib/factory-registry-csv.ts.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  device as deviceTable,
  factoryDevice,
  organization as orgTable,
  store as storeTable,
} from "./db/schema";
import { AUDIT, recordAudit } from "./audit";
import { generateDeviceKey, id } from "./ids";
import type { RegistryAllocationSnapshot } from "./provisioning";
import type { RegistryCsvRow } from "./factory-registry-csv";

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505";
}

/** Idempotent upsert of parsed CSV rows (re-import updates, never duplicates). */
export async function importFactoryDevices(
  rows: RegistryCsvRow[],
): Promise<{ imported: number }> {
  for (const row of rows) {
    await db
      .insert(factoryDevice)
      .values({
        serial: row.serial,
        batchCode: row.batchCode,
        hardwareRevision: row.hardwareRevision,
        manufacturedAt: row.manufacturedAt,
      })
      .onConflictDoUpdate({
        target: factoryDevice.serial,
        set: {
          batchCode: row.batchCode,
          hardwareRevision: row.hardwareRevision,
          manufacturedAt: row.manufacturedAt,
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
  deviceId: string | null;
  deviceName: string | null;
  manufacturedAt: Date | null;
  allocatedAt: Date | null;
  claimedAt: Date | null;
}

export async function getFactoryDevices(): Promise<InventoryRow[]> {
  return db
    .select({
      serial: factoryDevice.serial,
      batchCode: factoryDevice.batchCode,
      hardwareRevision: factoryDevice.hardwareRevision,
      status: factoryDevice.status,
      unregistered: factoryDevice.unregistered,
      allocatedOrganizationId: factoryDevice.allocatedOrganizationId,
      allocatedOrgName: orgTable.name,
      allocatedStoreId: factoryDevice.allocatedStoreId,
      deviceId: factoryDevice.deviceId,
      deviceName: deviceTable.name,
      manufacturedAt: factoryDevice.manufacturedAt,
      allocatedAt: factoryDevice.allocatedAt,
      claimedAt: factoryDevice.claimedAt,
    })
    .from(factoryDevice)
    .leftJoin(orgTable, eq(factoryDevice.allocatedOrganizationId, orgTable.id))
    .leftJoin(deviceTable, eq(factoryDevice.deviceId, deviceTable.id))
    .orderBy(factoryDevice.serial);
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

/** Revert unclaimed allocations back to `manufactured`. */
export async function deallocateSerials(
  serials: string[],
): Promise<{ updated: number }> {
  if (serials.length === 0) return { updated: 0 };
  const updated = await db
    .update(factoryDevice)
    .set({
      status: "manufactured",
      allocatedOrganizationId: null,
      allocatedStoreId: null,
      allocatedAt: null,
    })
    .where(
      and(inArray(factoryDevice.serial, serials), eq(factoryDevice.status, "allocated")),
    )
    .returning({ serial: factoryDevice.serial });
  return { updated: updated.length };
}

export async function setRegistryStatus(
  serial: string,
  status: "rma" | "retired",
): Promise<void> {
  await db.update(factoryDevice).set({ status }).where(eq(factoryDevice.serial, serial));
}

/**
 * One-shot zero-touch claim for a pre-allocated serial. The registry row is
 * claim-locked FIRST (atomic allocated→claimed conditional update) so a racing
 * second poll gets 0 rows and falls back to pending. Returns null (→ caller
 * responds "pending") on any race/collision; per spec the key is delivered and
 * consumed in this same response, so pendingDeviceKey is never persisted.
 */
export async function autoClaimDevice(
  serial: string,
  pairingCode: string,
): Promise<{ deviceKey: string } | null> {
  const [locked] = await db
    .update(factoryDevice)
    .set({ status: "claimed", claimedAt: new Date() })
    .where(and(eq(factoryDevice.serial, serial), eq(factoryDevice.status, "allocated")))
    .returning({
      organizationId: factoryDevice.allocatedOrganizationId,
      storeId: factoryDevice.allocatedStoreId,
    });
  if (!locked) return null;
  if (!locked.organizationId || !locked.storeId) {
    // Incomplete allocation should have been filtered by shouldAutoClaim;
    // release the lock and fall back to the human path.
    await db
      .update(factoryDevice)
      .set({ status: "allocated", claimedAt: null })
      .where(eq(factoryDevice.serial, serial));
    return null;
  }

  const { key, hash } = generateDeviceKey();
  const deviceId = id("dev");
  try {
    await db.insert(deviceTable).values({
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
  } catch (err) {
    // pairing-code or serial unique collision → release the claim-lock.
    await db
      .update(factoryDevice)
      .set({ status: "allocated", claimedAt: null })
      .where(eq(factoryDevice.serial, serial));
    if (isUniqueViolation(err)) return null;
    throw err;
  }

  await db.update(factoryDevice).set({ deviceId }).where(eq(factoryDevice.serial, serial));
  await recordAudit({
    organizationId: locked.organizationId,
    actor: { type: "system" },
    action: AUDIT.deviceAutoClaimed,
    target: { type: "device", id: deviceId },
    metadata: { serial },
  });
  return { deviceKey: key };
}

/**
 * Stamp a human-claimed device with its serial at key delivery, then link (or
 * self-register) the registry row. A unique-index hit means the same physical
 * serial claimed twice: the new row keeps serial=null, gets serialConflict,
 * and the event is audited — nothing is silently overwritten.
 */
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
    .select({ serial: factoryDevice.serial })
    .from(factoryDevice)
    .where(eq(factoryDevice.serial, serial))
    .limit(1);
  if (existing) {
    await db
      .update(factoryDevice)
      .set({
        status: "claimed",
        deviceId,
        claimedAt: sql`coalesce(${factoryDevice.claimedAt}, now())`,
      })
      .where(eq(factoryDevice.serial, serial));
  } else {
    // Self-registration: serial was never imported (registry works even empty).
    await db.insert(factoryDevice).values({
      serial,
      status: "claimed",
      unregistered: true,
      deviceId,
      claimedAt: new Date(),
    });
  }
}
