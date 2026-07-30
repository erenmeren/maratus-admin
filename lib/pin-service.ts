// lib/pin-service.ts
// Shared scoped pinned-QR mutation core. The public API routes and the tenant
// server actions all call these, so the money rule (1 credit per device that
// ends up showing a pin it wasn't showing before — clears are free, swapping
// one live URL for another via a mode change is free, same-URL is a no-op; see
// planScopedPinChange) and the delivery rule (deviceCommand row + best-effort
// MQTT publish, one per affected device) exist in exactly one place.
//
// NOTE: a mode change is therefore NOT unconditionally free — switching a
// "none" store/device back to "inherit" while a pin exists upstream bills the
// devices that light up. Callers must handle the insufficient_credits result
// on the mode path too, not just the URL path.

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
 *
 * `redelivery` marks convergence traffic (see pushEffectivePin) so reporting
 * can tell "the tenant changed a pin" apart from "a device was re-sent the pin
 * it already had". It is stored, never sent to the device.
 */
async function enqueuePinCommands(
  organizationId: string,
  batch: { deviceId: string; url: string | null }[],
  opts: { redelivery: boolean },
): Promise<void> {
  if (batch.length === 0) return;
  const rows = batch.map((b) => ({
    id: id("cmd"),
    deviceId: b.deviceId,
    organizationId,
    type: "pin" as const,
    status: "pending" as const,
    redelivery: opts.redelivery,
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

  // Charge-first; see file header for the crash posture on neon-http's lack
  // of transactions.
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
    // UPSERT, not UPDATE: an org can exist without a tenantSettings row (the
    // row is created lazily by Branding/Device Settings), and a bare UPDATE
    // would match zero rows — charging credits and fanning out commands for a
    // pin that silently reverts the next time the devices' config is rebuilt
    // (heartbeat republish or a fresh cfg/get on MQTT reconnect).
    await db
      .insert(tenantSettings)
      .values({ organizationId: a.organizationId, pinnedUrl: a.change.url, pinnedAt })
      .onConflictDoUpdate({
        target: tenantSettings.organizationId,
        set: { pinnedUrl: a.change.url, pinnedAt, updatedAt: new Date() },
      });
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
    { redelivery: false },
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
 * Fail-open wrapper around pushEffectivePin for callers that have ALREADY
 * committed the membership change (device moved, store deleted, claim issued).
 * Re-delivery is convergence traffic — devices also pick the pin up from their
 * next config fetch — so a hiccup here must never turn a committed mutation
 * into a thrown server action, which would skip the caller's revalidatePath
 * and show the user a failure for work that actually succeeded.
 */
export async function pushEffectivePinSafe(organizationId: string, deviceIds: string[]): Promise<void> {
  try {
    await pushEffectivePin(organizationId, deviceIds);
  } catch (err) {
    console.error("[pin-service] pushEffectivePin after a membership change failed", err);
  }
}

/**
 * Re-deliver the CURRENT effective pin to the given devices (free). Used after
 * membership changes (claim, move, store deletion) — idempotent on-device.
 * Private on purpose: every caller has already committed its change, so they
 * all go through the fail-open pushEffectivePinSafe above.
 */
async function pushEffectivePin(organizationId: string, deviceIds: string[]): Promise<void> {
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
  await enqueuePinCommands(organizationId, batch, { redelivery: true });
}
