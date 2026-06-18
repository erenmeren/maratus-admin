// Public receipt access (by token) + device provisioning.
// Separate from lib/data.ts because these are capability-scoped, not
// organization-scoped: the token IS the access grant.

import { after } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { deliverEvent } from "@/lib/webhooks/deliver";
import {
  device as deviceTable,
  organization as orgTable,
  receipt as receiptTable,
  store as storeTable,
} from "./db/schema";
import { generateDeviceKey, id } from "./ids";
import { presignedReceiptUrl } from "./storage";

export interface PublicReceipt {
  token: string;
  status: "pending" | "ready" | "downloaded";
  storeName: string | null;
  organizationName: string;
  mimeType: string;
  createdAt: Date;
  /** Fresh short-lived presigned URL to the rendered image (null if pending). */
  imageUrl: string | null;
}

/**
 * Look up a receipt by its capability token and, if ready, mint a fresh
 * presigned image URL. Marks the receipt `downloaded` on first view — this is
 * the "receipt sent ✓" signal. Returns null if the token is unknown.
 */
export async function getReceiptByToken(
  token: string,
): Promise<PublicReceipt | null> {
  const [row] = await db
    .select({
      receipt: receiptTable,
      storeName: storeTable.name,
      orgName: orgTable.name,
    })
    .from(receiptTable)
    .leftJoin(storeTable, eq(receiptTable.storeId, storeTable.id))
    .innerJoin(orgTable, eq(receiptTable.organizationId, orgTable.id))
    .where(eq(receiptTable.token, token))
    .limit(1);

  if (!row) return null;
  const r = row.receipt;

  let imageUrl: string | null = null;
  if (r.status !== "pending") {
    imageUrl = await presignedReceiptUrl(r.storageKey);
    // First view flips ready → downloaded and stamps the time.
    if (r.status === "ready") {
      await db
        .update(receiptTable)
        .set({ status: "downloaded", downloadedAt: new Date() })
        .where(eq(receiptTable.id, r.id));
      after(() =>
        deliverEvent(r.organizationId, "receipt.downloaded", {
          id: r.id,
          token: r.token,
          status: "downloaded",
          storeId: r.storeId,
          deviceId: r.deviceId,
          byteSize: r.byteSize,
          createdAt: r.createdAt,
        }),
      );
    }
  }

  return {
    token: r.token,
    status: r.status === "ready" ? "downloaded" : r.status,
    storeName: row.storeName,
    organizationName: row.orgName,
    mimeType: r.mimeType,
    createdAt: r.createdAt,
    imageUrl,
  };
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
    await db
      .update(deviceTable)
      .set({
        storeId,
        deviceKeyHash: hash,
        pendingDeviceKey: key, // device fetches once via /api/device/claim
        claimedAt: new Date(),
        status: "offline",
        // pairingCode intentionally KEPT so the device can still poll by code.
      })
      .where(eq(deviceTable.id, existing.id));
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
  } catch {
    // unique(pairingCode) violation → two devices generated the same code.
    throw new Error("Pairing code already in use");
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
