// Device claiming + unclaimed-device inventory (tenant-scoped device
// provisioning). Separate from lib/data.ts because claiming is keyed by the
// one-time pairing code, not the caller's organization.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  device as deviceTable,
  store as storeTable,
  tenantSettings,
} from "./db/schema";
import { generateDeviceKey, id } from "./ids";
import { provisionDeviceMqtt } from "@/lib/mqtt";
import { pushEffectivePinSafe } from "@/lib/pin-service";
import { periodEndFor, periodStartFor } from "@/lib/billing-period";
import { monthsRemainingUntil } from "@/lib/invoicing";
import { issueProrationInvoice, prorationMonths } from "@/lib/invoices";

/**
 * A device claimed mid-year is billed for the remaining months of the org's
 * subscription year and stays UNPAID (contributing no quota) until that
 * invoice is marked paid. No subscription yet → nothing to pro-rate; the
 * device rides the org's first subscription invoice instead — and if that
 * invoice is issued but not yet paid, markInvoicePaid issues the proration at
 * payment time, once the anchor exists.
 *
 * Fail-open, matching the MQTT/pin posture above: the device is already
 * bound and its key already returned to the caller by the time this runs, so
 * a failed invoice write must never undo a successful claim.
 */
async function issueProrationForClaimSafe(
  organizationId: string,
  deviceId: string,
): Promise<void> {
  try {
    const [settings] = await db
      .select({
        startedAt: tenantSettings.subscriptionStartedAt,
        renewsAt: tenantSettings.subscriptionRenewsAt,
        price: tenantSettings.pricePerDeviceCents,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, organizationId))
      .limit(1);

    if (!settings?.startedAt || !settings.renewsAt) return;

    const now = new Date();
    await issueProrationInvoice({
      organizationId,
      deviceId,
      pricePerDeviceCents: settings.price,
      // Clamped to at least one month: a device claimed at or after the
      // renewal instant (routine while a renewal sits unpaid — there is no
      // cut-off) would otherwise price at zero, produce no invoice at all,
      // and be claimed, unpaid and invisible.
      monthsRemaining: prorationMonths(
        monthsRemainingUntil(settings.renewsAt, now),
        { deviceId, organizationId },
      ),
      periodStart: periodStartFor(settings.startedAt, now),
      periodEnd: periodEndFor(settings.startedAt, now),
      issuedAt: now,
    });
  } catch (err) {
    console.error("proration invoice after claim failed", err);
  }
}

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
    // Provision the device's MQTT credential (device key = MQTT password).
    // Fail-open: a provisioning hiccup must never fail a claim. There is no HTTP
    // fallback — MQTT is the only transport — so the cost is real: the device
    // ends up holding a key the broker will reject, and since the raw key is
    // returned exactly once and only its hash is stored, the cloud cannot
    // re-provision it later. Recovery is a re-claim (which mints a fresh key).
    try {
      await provisionDeviceMqtt(existing.id, key);
    } catch (err) {
      console.error("mqtt provision after claim failed", err);
    }
    // Membership changed → re-deliver the (possibly different) effective pin.
    // Free. Fail-open, matching the subscription/MQTT posture above — a pin
    // hiccup must never fail a claim.
    await pushEffectivePinSafe(store.organizationId, [existing.id]);
    await issueProrationForClaimSafe(store.organizationId, existing.id);
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
  // Provision the device's MQTT credential (device key = MQTT password).
  // Fail-open: a provisioning hiccup must never fail a claim. There is no HTTP
  // fallback — MQTT is the only transport — so the cost is real: the device ends
  // up holding a key the broker will reject, and since the raw key is returned
  // exactly once and only its hash is stored, the cloud cannot re-provision it
  // later. Recovery is a re-claim (which mints a fresh key).
  try {
    await provisionDeviceMqtt(deviceId, key);
  } catch (err) {
    console.error("mqtt provision after claim failed", err);
  }
  // Membership changed → re-deliver the (possibly different) effective pin.
  // Free. Fail-open, matching the subscription/MQTT posture above — a pin
  // hiccup must never fail a claim.
  await pushEffectivePinSafe(store.organizationId, [deviceId]);
  await issueProrationForClaimSafe(store.organizationId, deviceId);
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
