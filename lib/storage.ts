// Cloudflare R2 (S3-compatible) object storage.
//
// Objects are PRIVATE — the bucket is never public. Access is granted only via
// short-lived presigned GET URLs minted on demand server-side. Used for tenant
// branding assets and firmware binaries.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "./env";

const env = getEnv();

const client = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

// ---- Generic object helpers -------------------------------------------------

/** Upload any object to R2. Returns the storage key. */
export async function putObject(
  key: string,
  bytes: Uint8Array | Buffer,
  mimeType: string,
): Promise<string> {
  await client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: mimeType,
    }),
  );
  return key;
}

/**
 * Mint a short-lived presigned GET URL for a private object.
 * Default TTL 5 minutes — long enough to view/download, short enough that a
 * leaked URL expires fast.
 */
export async function presignedGetUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/**
 * Delete an object from R2. Best-effort: never throws — a failed cleanup of an
 * orphaned object must not break the user-facing operation that triggered it.
 * Returns true if the delete call succeeded.
 */
export async function deleteObject(key: string): Promise<boolean> {
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    );
    return true;
  } catch (err) {
    console.error(`R2 deleteObject failed for key ${key}`, err);
    return false;
  }
}

// ---- Tenant branding assets -------------------------------------------------

/** Object key convention for a tenant's uploaded logo. */
export function logoStorageKey(
  organizationId: string,
  assetId: string,
): string {
  return `logos/${organizationId}/${assetId}`;
}

/** Object key convention for a tenant's uploaded printer image. */
export function imageStorageKey(
  organizationId: string,
  assetId: string,
): string {
  return `branding/${organizationId}/images/${assetId}`;
}

// ---- Firmware OTA -----------------------------------------------------------

/** R2 key for a published firmware binary. */
export function firmwareStorageKey(version: string): string {
  return `firmware/${version}/ditto-firmware.bin`;
}
