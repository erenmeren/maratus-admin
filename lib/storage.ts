// Cloudflare R2 (S3-compatible) object storage for rendered receipts.
//
// Receipts are PRIVATE — the bucket is never public. Access is granted only via
// short-lived presigned GET URLs, minted on demand when someone presents a
// valid receipt token. The token is the capability; the URL is the delivery.

import {
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

/** Upload a rendered receipt to R2. Returns the storage key. */
export async function putReceipt(
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
 * Mint a short-lived presigned GET URL for a private receipt object.
 * Default TTL 5 minutes — long enough to view/download, short enough that a
 * leaked URL expires fast. The token check happens before this is ever called.
 */
export async function presignedReceiptUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/** Object key convention for a receipt's rendered image. */
export function receiptStorageKey(
  organizationId: string,
  receiptId: string,
): string {
  return `receipts/${organizationId}/${receiptId}`;
}
