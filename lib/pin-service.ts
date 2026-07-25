// lib/pin-service.ts
// Shared scoped pinned-QR mutation core. The public API routes and the tenant
// server actions all call these, so the money rule (1 credit per device whose
// EFFECTIVE pin URL actually changes, mode/clear changes are free, same-URL
// is a no-op) and the delivery rule (deviceCommand row + best-effort MQTT
// publish, one per affected device) exist in exactly one place.

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  device as deviceTable,
  store as storeTable,
  tenantSettings,
  deviceCommand,
} from "@/lib/db/schema";
import { spendCredit } from "@/lib/credits";
import { id } from "@/lib/ids";
import { chunk } from "@/lib/chunk";
import { publishCommand } from "@/lib/mqtt";
import { recordAudit, AUDIT, type AuditActor } from "@/lib/audit";
import {
  planScopedPinChange,
  resolveEffectivePin,
  changeSetsUrl,
  type ScopedPinChange,
  type DevicePinRow,
  type StorePinRow,
} from "@/lib/pin-resolve";

export const PIN_COST = 1;

export type ScopedPinResult =
  | { ok: true; noop: boolean; affectedDevices: number; creditsCharged: number; pinnedAt: Date | null }
  | { ok: false; reason: "insufficient_credits"; required: number };

const PIN_COMMAND_INSERT_CHUNK_SIZE = 500;

/**
 * Batched pin-command fan-out: one multi-row insert (chunked for very large
 * batches) followed by best-effort MQTT publishes fired concurrently. MQTT is
 * best-effort — devices also converge via command poll / config fetch — so
 * publish failures are swallowed (allSettled, no throw).
 */
async function enqueuePinCommands(
  organizationId: string,
  batch: { deviceId: string; url: string | null }[],
): Promise<void> {
  if (batch.length === 0) return;
  const rows = batch.map((b) => ({
    id: id("cmd"),
    deviceId: b.deviceId,
    organizationId,
    type: "pin" as const,
    status: "pending" as const,
    payload: { url: b.url },
    // No expiresAt: unlike triggers there is no hold to reclaim, and an
    // offline device must still receive the pin when it reconnects (the
    // config path also covers reboot recovery).
  }));
  for (const part of chunk(rows, PIN_COMMAND_INSERT_CHUNK_SIZE)) {
    await db.insert(deviceCommand).values(part);
  }
  await Promise.allSettled(
    rows.map((r) =>
      publishCommand(r.deviceId, { commandId: r.id, type: "pin", action: null, payload: r.payload }),
    ),
  );
}

async function loadPinWorld(organizationId: string): Promise<{
  devices: (DevicePinRow & { pinnedAt: Date | null })[];
  stores: (StorePinRow & { pinnedAt: Date | null })[];
  tenantPinnedUrl: string | null;
  tenantPinnedAt: Date | null;
}> {
  const [devices, stores, [ts]] = await Promise.all([
    db
      .select({
        id: deviceTable.id,
        storeId: deviceTable.storeId,
        pinMode: deviceTable.pinMode,
        pinnedUrl: deviceTable.pinnedUrl,
        pinnedAt: deviceTable.pinnedAt,
      })
      .from(deviceTable)
      .where(and(eq(deviceTable.organizationId, organizationId), isNotNull(deviceTable.claimedAt))),
    db
      .select({ id: storeTable.id, pinMode: storeTable.pinMode, pinnedUrl: storeTable.pinnedUrl, pinnedAt: storeTable.pinnedAt })
      .from(storeTable)
      .where(eq(storeTable.organizationId, organizationId)),
    db
      .select({ pinnedUrl: tenantSettings.pinnedUrl, pinnedAt: tenantSettings.pinnedAt })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, organizationId)),
  ]);
  return {
    devices,
    stores,
    tenantPinnedUrl: ts?.pinnedUrl ?? null,
    tenantPinnedAt: ts?.pinnedAt ?? null,
  };
}

/** Is the change a no-op against the level's current stored state? */
function isLevelNoop(
  change: ScopedPinChange,
  world: { stores: StorePinRow[]; devices: DevicePinRow[]; tenantPinnedUrl: string | null },
): boolean {
  if (change.scope === "org") return world.tenantPinnedUrl === change.url;
  if (change.scope === "store") {
    const s = world.stores.find((x) => x.id === change.storeId);
    return !!s && s.pinMode === change.mode && s.pinnedUrl === change.url;
  }
  const d = world.devices.find((x) => x.id === change.deviceId);
  return !!d && d.pinMode === change.mode && d.pinnedUrl === change.url;
}

export async function applyScopedPinChange(a: {
  organizationId: string;
  change: ScopedPinChange;
  actor: AuditActor;
  via: "api" | "ui";
  createdByUserId?: string | null;
}): Promise<ScopedPinResult> {
  const world = await loadPinWorld(a.organizationId);
  if (isLevelNoop(a.change, world)) {
    // Report the level's ACTUAL stored pinnedAt — a repeated identical set
    // must not mint a fresh timestamp the DB doesn't have (null when the
    // level has no pin, e.g. a no-op clear).
    const change = a.change;
    const storedPinnedAt =
      change.scope === "org"
        ? world.tenantPinnedAt
        : change.scope === "store"
          ? (world.stores.find((s) => s.id === change.storeId)?.pinnedAt ?? null)
          : (world.devices.find((d) => d.id === change.deviceId)?.pinnedAt ?? null);
    return { ok: true, noop: true, affectedDevices: 0, creditsCharged: 0, pinnedAt: storedPinnedAt };
  }
  const plan = planScopedPinChange({ ...world, change: a.change });

  // Paid ⇔ the change sets a URL (charge-first; see file header for the
  // crash posture on neon-http's lack of transactions).
  if (plan.chargedCount > 0) {
    const spent = await spendCredit({
      organizationId: a.organizationId,
      deviceId: a.change.scope === "device" ? a.change.deviceId : null,
      action: "pin_change",
      cost: plan.chargedCount * PIN_COST,
      createdByUserId: a.createdByUserId ?? null,
    });
    if (!spent.ok) {
      return { ok: false, reason: "insufficient_credits", required: plan.chargedCount * PIN_COST };
    }
  }

  const pinnedAt = a.change.url !== null ? new Date() : null;
  if (a.change.scope === "org") {
    await db
      .update(tenantSettings)
      .set({ pinnedUrl: a.change.url, pinnedAt })
      .where(eq(tenantSettings.organizationId, a.organizationId));
  } else if (a.change.scope === "store") {
    await db
      .update(storeTable)
      .set({ pinMode: a.change.mode, pinnedUrl: a.change.url, pinnedAt })
      .where(and(eq(storeTable.id, a.change.storeId), eq(storeTable.organizationId, a.organizationId)));
  } else {
    await db
      .update(deviceTable)
      .set({ pinMode: a.change.mode, pinnedUrl: a.change.url, pinnedAt })
      .where(and(eq(deviceTable.id, a.change.deviceId), eq(deviceTable.organizationId, a.organizationId)));
  }

  await enqueuePinCommands(
    a.organizationId,
    plan.affected.map((dev) => ({ deviceId: dev.deviceId, url: dev.newUrl })),
  );

  const set = changeSetsUrl(a.change);
  const modeNone = !set && a.change.scope !== "org" && a.change.mode === "none";
  const action =
    a.change.scope === "org"
      ? set ? AUDIT.orgPinSet : AUDIT.orgPinCleared
      : a.change.scope === "store"
        ? set ? AUDIT.storePinSet : modeNone ? AUDIT.storePinModeNone : AUDIT.storePinCleared
        : set ? AUDIT.devicePinSet : modeNone ? AUDIT.devicePinModeNone : AUDIT.devicePinCleared;
  const target =
    a.change.scope === "org"
      ? { type: "organization", id: a.organizationId }
      : a.change.scope === "store"
        ? { type: "store", id: a.change.storeId }
        : { type: "device", id: a.change.deviceId };
  await recordAudit({
    organizationId: a.organizationId,
    actor: a.actor,
    action,
    target,
    metadata: {
      via: a.via,
      ...(set ? { url: a.change.url } : {}),
      ...(a.change.scope !== "org" && !set ? { mode: a.change.mode } : {}),
      affectedDevices: plan.affected.length,
      creditsCharged: plan.chargedCount * PIN_COST,
    },
  });
  return {
    ok: true,
    noop: false,
    affectedDevices: plan.affected.length,
    creditsCharged: plan.chargedCount * PIN_COST,
    pinnedAt,
  };
}

/**
 * Re-deliver the CURRENT effective pin to the given devices (free). Used after
 * membership changes (claim, move, store deletion) — idempotent on-device.
 */
export async function pushEffectivePin(organizationId: string, deviceIds: string[]): Promise<void> {
  if (deviceIds.length === 0) return;
  const world = await loadPinWorld(organizationId);
  const storeById = new Map(world.stores.map((s) => [s.id, s]));
  const rows = await db
    .select({ id: deviceTable.id, storeId: deviceTable.storeId, pinMode: deviceTable.pinMode, pinnedUrl: deviceTable.pinnedUrl })
    .from(deviceTable)
    .where(
      and(
        inArray(deviceTable.id, deviceIds),
        eq(deviceTable.organizationId, organizationId),
        isNotNull(deviceTable.claimedAt),
      ),
    );
  const batch = rows.map((d) => {
    const eff = resolveEffectivePin({
      device: d,
      store: d.storeId ? (storeById.get(d.storeId) ?? null) : null,
      tenant: { pinnedUrl: world.tenantPinnedUrl },
    });
    return { deviceId: d.id, url: eff.url };
  });
  await enqueuePinCommands(organizationId, batch);
}
