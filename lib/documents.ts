// Public document access (by token) + device provisioning.
// Separate from lib/data.ts because these are capability-scoped, not
// organization-scoped: the token IS the access grant.

import { after } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { deliverEvent } from "@/lib/webhooks/deliver";
import {
  device as deviceTable,
  organization as orgTable,
  document as documentTable,
  store as storeTable,
  tenantSettings,
} from "./db/schema";
import { generateDeviceKey, id } from "./ids";
import { presignedDocumentUrl, presignedGetUrl } from "./storage";

export interface PublicDocument {
  token: string;
  status: "pending" | "ready" | "downloaded";
  storeName: string | null;
  organizationName: string;
  organizationId: string;
  mimeType: string;
  createdAt: Date;
  /** Fresh short-lived presigned URL to the rendered image (null if pending). */
  imageUrl: string | null;
  /** Tenant brand accent color (hex); defaults to "#10A765" when unset. */
  brandColor: string;
  /** Presigned tenant logo URL, or null when no logo. */
  logoUrl: string | null;
  storeAddress: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
  /** Tenant return window in days; null = off. */
  returnWindowDays: number | null;
  /** Tenant warranty period in months; null = off. */
  warrantyPeriodMonths: number | null;
}

/**
 * Look up a document by its capability token and, if ready, mint a fresh
 * presigned image URL. Marks the document `downloaded` on first view — this is
 * the "document sent ✓" signal. Returns null if the token is unknown.
 */
export async function getDocumentByToken(
  token: string,
): Promise<PublicDocument | null> {
  const [row] = await db
    .select({
      document: documentTable,
      storeName: storeTable.name,
      storeAddress: storeTable.address,
      orgName: orgTable.name,
      brandColor: tenantSettings.brandColor,
      logoKey: tenantSettings.logoUrl,
      supportEmail: tenantSettings.supportEmail,
      supportUrl: tenantSettings.supportUrl,
      returnWindowDays: tenantSettings.returnWindowDays,
      warrantyPeriodMonths: tenantSettings.warrantyPeriodMonths,
    })
    .from(documentTable)
    .leftJoin(storeTable, eq(documentTable.storeId, storeTable.id))
    .innerJoin(orgTable, eq(documentTable.organizationId, orgTable.id))
    .leftJoin(tenantSettings, eq(documentTable.organizationId, tenantSettings.organizationId))
    .where(eq(documentTable.token, token))
    .limit(1);

  if (!row) return null;
  const r = row.document;

  let imageUrl: string | null = null;
  if (r.status !== "pending") {
    imageUrl = await presignedDocumentUrl(r.storageKey);
    // First view flips ready → downloaded and stamps the time.
    if (r.status === "ready") {
      await db
        .update(documentTable)
        .set({ status: "downloaded", downloadedAt: new Date() })
        .where(eq(documentTable.id, r.id));
      after(() =>
        deliverEvent(r.organizationId, "document.downloaded", {
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

  let logoUrl: string | null = null;
  if (row.logoKey) {
    try {
      logoUrl = await presignedGetUrl(row.logoKey);
    } catch (err) {
      console.error("logo presign failed", err);
      logoUrl = null; // never break the page over a logo
    }
  }

  return {
    token: r.token,
    status: r.status === "ready" ? "downloaded" : r.status,
    storeName: row.storeName,
    organizationName: row.orgName,
    organizationId: r.organizationId,
    mimeType: r.mimeType,
    createdAt: r.createdAt,
    imageUrl,
    brandColor: row.brandColor ?? "#10A765",
    logoUrl,
    storeAddress: row.storeAddress && row.storeAddress.trim() ? row.storeAddress : null,
    supportEmail: row.supportEmail ?? null,
    supportUrl: row.supportUrl ?? null,
    returnWindowDays: row.returnWindowDays ?? null,
    warrantyPeriodMonths: row.warrantyPeriodMonths ?? null,
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
  return { deviceId, deviceName: name, deviceKey: key };
}

/**
 * Lightweight meta-only lookup by token. Returns the document id,
 * organizationId, and org name WITHOUT minting a presigned URL or flipping
 * ready → downloaded. Used by the public "email me this document" action.
 */
export async function getDocumentByTokenMeta(
  token: string,
): Promise<{ id: string; organizationId: string; organizationName: string } | null> {
  const [row] = await db
    .select({
      id: documentTable.id,
      organizationId: documentTable.organizationId,
      organizationName: orgTable.name,
    })
    .from(documentTable)
    .innerJoin(orgTable, eq(orgTable.id, documentTable.organizationId))
    .where(eq(documentTable.token, token))
    .limit(1);
  return row ?? null;
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
