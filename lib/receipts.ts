// Public receipt access (by token) + device provisioning.
// Separate from lib/data.ts because these are capability-scoped, not
// organization-scoped: the token IS the access grant.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  device as deviceTable,
  organization as orgTable,
  receipt as receiptTable,
  store as storeTable,
} from "./db/schema";
import { generateDeviceKey } from "./ids";
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
 * Bind an unclaimed device (looked up by its pairing code) to a store, issue
 * its device key, and mark it claimed. The raw key is returned exactly once.
 * Throws if the pairing code is unknown or already claimed.
 */
export async function claimDevice(
  pairingCode: string,
  storeId: string,
): Promise<ClaimResult> {
  const [device] = await db
    .select()
    .from(deviceTable)
    .where(eq(deviceTable.pairingCode, pairingCode))
    .limit(1);

  if (!device) throw new Error("Unknown pairing code");
  if (device.claimedAt) throw new Error("Device already claimed");

  // Validate the target store belongs to the same organization.
  const [store] = await db
    .select({ id: storeTable.id, organizationId: storeTable.organizationId })
    .from(storeTable)
    .where(eq(storeTable.id, storeId))
    .limit(1);
  if (!store) throw new Error("Unknown store");
  if (store.organizationId !== device.organizationId) {
    throw new Error("Store belongs to a different organization");
  }

  const { key, hash } = generateDeviceKey();
  await db
    .update(deviceTable)
    .set({
      storeId,
      deviceKeyHash: hash,
      claimedAt: new Date(),
      pairingCode: null, // consume the one-time code
      status: "offline",
    })
    .where(eq(deviceTable.id, device.id));

  return { deviceId: device.id, deviceName: device.name, deviceKey: key };
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
