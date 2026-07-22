// Device claiming + unclaimed-device inventory (tenant-scoped device
// provisioning). Separate from lib/data.ts because claiming is keyed by the
// one-time pairing code, not the caller's organization.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { device as deviceTable, store as storeTable } from "./db/schema";
import { generateDeviceKey, id } from "./ids";
import { syncDeviceSubscription } from "./billing/device-subscription";
import { provisionDeviceMqtt } from "@/lib/mqtt";

export interface ClaimResult {
  deviceId: string;
  deviceName: string;
  /** Raw device key — shown ONCE; only its hash is stored. */
  deviceKey: string;
}

/**
 * Claim a device by its pairing code, binding it to a store and minting its
 * device key. Create-or-bind: if a pre-seeded row exists for the code (admin
 * "Add device" path) it is bound; otherwise a fresh row is created for a
 * device-generated code. The raw key is stashed in `pendingDeviceKey` for the
 * device's one-time claim-poll fetch and returned here once; the pairing code
 * is KEPT so the device can still poll by code. Throws if the device is already
 * claimed, the store is unknown, or the code collides.
 */
export async function claimDevice(
  pairingCode: string,
  storeId: string,
): Promise<ClaimResult> {
  const [store] = await db
    .select({ id: storeTable.id, organizationId: storeTable.organizationId })
    .from(storeTable)
    .where(eq(storeTable.id, storeId))
    .limit(1);
  if (!store) throw new Error("Store not found");

  const [existing] = await db
    .select()
    .from(deviceTable)
    .where(eq(deviceTable.pairingCode, pairingCode))
    .limit(1);
  if (existing?.claimedAt) throw new Error("Device already claimed");

  // Mint the key now; the raw key goes to pendingDeviceKey for the device's
  // one-time claim-poll fetch, only the hash is the durable credential.
  const { key, hash } = generateDeviceKey();

  if (existing) {
    // Bind a pre-seeded row (admin "Add device" path).
    if (store.organizationId !== existing.organizationId) {
      throw new Error("Store belongs to a different organization");
    }
    // Guard against a concurrent double-claim: only bind while still unclaimed,
    // so a racing second claim updates 0 rows rather than silently overwriting
    // the first claim's key.
    const bound = await db
      .update(deviceTable)
      .set({
        storeId,
        deviceKeyHash: hash,
        pendingDeviceKey: key, // device fetches once via /api/device/claim
        claimedAt: new Date(),
        status: "offline",
        // pairingCode intentionally KEPT so the device can still poll by code.
      })
      .where(and(eq(deviceTable.id, existing.id), isNull(deviceTable.claimedAt)))
      .returning({ id: deviceTable.id });
    if (bound.length === 0) throw new Error("Device already claimed");
    // Keep the per-device subscription quantity in sync (fail-open — a Stripe
    // hiccup must never fail a claim).
    try {
      await syncDeviceSubscription(store.organizationId);
    } catch (err) {
      console.error("device-subscription sync after claim failed", err);
    }
    // Provision the device's MQTT credential (device key = MQTT password).
    // Fail-open: a provisioning hiccup must never fail a claim — the device
    // just uses HTTP polling until it is reprovisioned.
    try {
      await provisionDeviceMqtt(existing.id, key);
    } catch (err) {
      console.error("mqtt provision after claim failed", err);
    }
    return { deviceId: existing.id, deviceName: existing.name, deviceKey: key };
  }

  // Create a row for a device-generated code with no pre-existing device.
  const deviceId = id("dev");
  const name = "New Printer";
  try {
    await db.insert(deviceTable).values({
      id: deviceId,
      organizationId: store.organizationId,
      storeId,
      name,
      status: "offline",
      connectionType: "wifi",
      firmwareVersion: "2.4.1",
      pairingCode, // KEEP so the device can poll for its key
      deviceKeyHash: hash,
      pendingDeviceKey: key,
      claimedAt: new Date(),
      createdAt: new Date(),
    });
  } catch (err) {
    // unique(pairingCode) violation (Postgres 23505) → two devices generated the
    // same code. Re-throw anything else so genuine faults aren't mislabelled.
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      throw new Error("Pairing code already in use");
    }
    throw err;
  }
  // Keep the per-device subscription quantity in sync (fail-open — a Stripe
  // hiccup must never fail a claim).
  try {
    await syncDeviceSubscription(store.organizationId);
  } catch (err) {
    console.error("device-subscription sync after claim failed", err);
  }
  // Provision the device's MQTT credential (device key = MQTT password).
  // Fail-open: a provisioning hiccup must never fail a claim — the device
  // just uses HTTP polling until it is reprovisioned.
  try {
    await provisionDeviceMqtt(deviceId, key);
  } catch (err) {
    console.error("mqtt provision after claim failed", err);
  }
  return { deviceId, deviceName: name, deviceKey: key };
}

/** List unclaimed devices for an org (have a pairing code, not yet bound). */
export async function getUnclaimedDevices(organizationId: string) {
  return db
    .select({
      id: deviceTable.id,
      name: deviceTable.name,
      pairingCode: deviceTable.pairingCode,
    })
    .from(deviceTable)
    .where(
      and(
        eq(deviceTable.organizationId, organizationId),
        isNull(deviceTable.claimedAt),
      ),
    );
}
