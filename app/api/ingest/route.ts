// POST /api/ingest — device → Ditto receipt ingestion.
//
// Authenticated by a DEVICE KEY (Authorization: Bearer <deviceKey>), NOT a user
// session. The device sends a rendered receipt image; we store it in R2, create
// a receipt row with an unguessable token, and return the public short URL the
// device turns into a QR code.
//
// Accepts either:
//   • multipart/form-data: field `file` (the image), optional `deviceId`
//   • application/json: { image: "<base64>", mimeType?, deviceId? }
//
// deviceId in the body is optional — the device key already identifies the
// device — but if supplied it must match, as a sanity check.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, receipt as receiptTable, tenantSettings } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe";
import { reportReceiptUsage } from "@/lib/billing/stripe-billing";
import { hashDeviceKey, id, receiptToken } from "@/lib/ids";
import { putReceipt, receiptStorageKey } from "@/lib/storage";
import { getEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateReceiptPayload } from "@/lib/ingest-validation";

export const runtime = "nodejs";

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  // --- 1. Authenticate the device by its bearer key ----------------------
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad(401, "Missing device bearer token");

  const keyHash = hashDeviceKey(match[1].trim());
  const [device] = await db
    .select()
    .from(deviceTable)
    .where(eq(deviceTable.deviceKeyHash, keyHash))
    .limit(1);

  if (!device) return bad(401, "Unknown device key");
  if (device.status === "paused") return bad(403, "Device is paused");

  // Throttle per device: 30 receipts / minute is generous for a kiosk.
  const rl = checkRateLimit(keyHash, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  // --- 2. Read the rendered receipt payload ------------------------------
  let bytes: Buffer;
  let mimeType = "image/png";
  let bodyDeviceId: string | undefined;

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      bodyDeviceId = (form.get("deviceId") as string | null) ?? undefined;
      if (!(file instanceof File)) return bad(400, "Missing file field");
      bytes = Buffer.from(await file.arrayBuffer());
      mimeType = file.type || mimeType;
    } else {
      const json = (await req.json()) as {
        image?: string;
        mimeType?: string;
        deviceId?: string;
      };
      if (!json.image) return bad(400, "Missing image field");
      // Accept raw base64 or a data: URL.
      const base64 = json.image.includes(",")
        ? json.image.split(",", 2)[1]
        : json.image;
      bytes = Buffer.from(base64, "base64");
      if (json.mimeType) mimeType = json.mimeType;
      bodyDeviceId = json.deviceId;
    }
  } catch {
    return bad(400, "Malformed request body");
  }

  if (bodyDeviceId && bodyDeviceId !== device.id) {
    return bad(400, "deviceId does not match device key");
  }
  const payloadCheck = validateReceiptPayload(bytes.byteLength, mimeType);
  if (!payloadCheck.ok) return bad(payloadCheck.status, payloadCheck.error);

  // --- 3. Store in R2 + create the receipt row ---------------------------
  const receiptId = id("rcp");
  const token = receiptToken();
  const storageKey = receiptStorageKey(device.organizationId, receiptId);

  try {
    await putReceipt(storageKey, bytes, mimeType);
  } catch (err) {
    console.error("R2 upload failed", err);
    return bad(502, "Storage upload failed");
  }

  const now = new Date();
  await db.insert(receiptTable).values({
    id: receiptId,
    organizationId: device.organizationId,
    deviceId: device.id,
    storeId: device.storeId,
    token,
    storageKey,
    mimeType,
    byteSize: bytes.byteLength,
    status: "ready",
    createdAt: now,
  });

  // Bump device heartbeat + mark online.
  await db
    .update(deviceTable)
    .set({ lastSeenAt: now, status: "online" })
    .where(eq(deviceTable.id, device.id));

  // Report metered usage to Stripe (best-effort: never fail ingestion on this).
  if (stripe) {
    const [settings] = await db
      .select({ customerId: tenantSettings.stripeCustomerId })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, device.organizationId))
      .limit(1);
    if (settings?.customerId) {
      reportReceiptUsage(settings.customerId).catch((e) =>
        console.error("[ingest] meter event failed", e),
      );
    }
  }

  // --- 4. Respond with the token + public short URL ----------------------
  const baseUrl = getEnv().BETTER_AUTH_URL;
  return NextResponse.json(
    { token, url: `${baseUrl}/r/${token}` },
    { status: 201 },
  );
}
