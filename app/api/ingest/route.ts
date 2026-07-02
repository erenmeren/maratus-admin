// POST /api/ingest — device → Ditto document ingestion.
//
// Authenticated by a DEVICE KEY (Authorization: Bearer <deviceKey>), NOT a user
// session. The device sends a rendered document image; we store it in R2, create
// a document row with an unguessable token, and return the public short URL the
// device turns into a QR code.
//
// Accepts either:
//   • multipart/form-data: field `file` (the image), optional `deviceId`
//   • application/json: { image: "<base64>", mimeType?, deviceId? }
//
// deviceId in the body is optional — the device key already identifies the
// device — but if supplied it must match, as a sanity check.

import { NextResponse } from "next/server";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, document as documentTable, tenantSettings, usageEvent as usageEventTable } from "@/lib/db/schema";
import { recordUsageEvent, reportUsageEvent } from "@/lib/billing/usage-metering";
import { isOrgPaymentBlocked } from "@/lib/billing/enforcement";
import { id, documentToken } from "@/lib/ids";
import { authenticateDevice } from "@/lib/device-auth";
import { putDocument, documentStorageKey } from "@/lib/storage";
import { getEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateDocumentPayload } from "@/lib/ingest-validation";
import { parseDocumentMetadata, type DocumentMetadata } from "@/lib/ingest-metadata";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  // --- 1. Authenticate the device by its bearer key ----------------------
  const device = await authenticateDevice(req);
  if (!device) return bad(401, "Unknown or missing device key");
  if (device.status === "paused") return bad(403, "Device is paused");

  // Block ingestion for orgs that are payment-blocked: suspended subscription
  // (403) or an unpaid invoice past the grace window (402). isOrgPaymentBlocked
  // fails open on a transient read error, so a DB blip can't lock out a customer.
  const block = await isOrgPaymentBlocked(device.organizationId);
  if (block.blocked) {
    return block.reason === "past_due"
      ? bad(402, "Account past due")
      : bad(403, "Subscription inactive");
  }

  // Throttle per device: 30 documents / minute is generous for a printer.
  // deviceKeyHash is non-null here: authenticateDevice only matches on a hash.
  const rl = await checkRateLimit(device.deviceKeyHash!, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  // --- 2. Read the rendered document payload ------------------------------
  let bytes: Buffer;
  let mimeType = "image/png";
  let bodyDeviceId: string | undefined;
  let metadata: DocumentMetadata | null = null;

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      bodyDeviceId = (form.get("deviceId") as string | null) ?? undefined;
      const metaRaw = form.get("metadata");
      if (typeof metaRaw === "string" && metaRaw) {
        try { metadata = parseDocumentMetadata(JSON.parse(metaRaw)); } catch { metadata = null; }
      }
      if (!(file instanceof File)) return bad(400, "Missing file field");
      bytes = Buffer.from(await file.arrayBuffer());
      mimeType = file.type || mimeType;
    } else {
      const json = (await req.json()) as {
        image?: string;
        mimeType?: string;
        deviceId?: string;
        metadata?: unknown;
      };
      if (!json.image) return bad(400, "Missing image field");
      // Accept raw base64 or a data: URL.
      const base64 = json.image.includes(",")
        ? json.image.split(",", 2)[1]
        : json.image;
      bytes = Buffer.from(base64, "base64");
      if (json.mimeType) mimeType = json.mimeType;
      bodyDeviceId = json.deviceId;
      metadata = parseDocumentMetadata(json.metadata);
    }
  } catch {
    return bad(400, "Malformed request body");
  }

  if (bodyDeviceId && bodyDeviceId !== device.id) {
    return bad(400, "deviceId does not match device key");
  }
  const payloadCheck = validateDocumentPayload(bytes.byteLength, mimeType);
  if (!payloadCheck.ok) return bad(payloadCheck.status, payloadCheck.error);

  // --- 3. Store in R2 + create the document row ---------------------------
  const documentId = id("rcp");
  const token = documentToken();
  const storageKey = documentStorageKey(device.organizationId, documentId);

  try {
    await putDocument(storageKey, bytes, mimeType);
  } catch (err) {
    console.error("R2 upload failed", err);
    reportError(err, { path: "ingest.r2-upload", extra: { orgId: device.organizationId, deviceId: device.id, documentId } });
    return bad(502, "Storage upload failed");
  }

  const now = new Date();
  await db.insert(documentTable).values({
    id: documentId,
    organizationId: device.organizationId,
    deviceId: device.id,
    storeId: device.storeId,
    token,
    storageKey,
    mimeType,
    byteSize: bytes.byteLength,
    status: "ready",
    source: "device",
    metadata,
    createdAt: now,
  });

  // Bump device heartbeat + mark online.
  const version = req.headers.get("x-device-version");
  await db
    .update(deviceTable)
    .set({ lastSeenAt: now, status: "online", ...(version ? { firmwareVersion: version } : {}) })
    .where(eq(deviceTable.id, device.id));

  // Durable metered usage. Write a usage_event ledger row for this document (the
  // ledger is the durability guarantee), then best-effort report it to Stripe
  // off the critical path. A dropped meter event stays "pending" and is retried
  // by /api/cron/usage — it can never silently un-bill the document.
  const [settings] = await db
    .select({ customerId: tenantSettings.stripeCustomerId })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, device.organizationId))
    .limit(1);
  after(async () => {
    const usageEventId = await recordUsageEvent({
      organizationId: device.organizationId,
      documentId,
      stripeCustomerId: settings?.customerId ?? null,
    });
    if (!usageEventId) return;
    const [row] = await db
      .select()
      .from(usageEventTable)
      .where(eq(usageEventTable.id, usageEventId))
      .limit(1);
    if (row) await reportUsageEvent(row);
  });

  // --- 4. Respond with the token + public short URL ----------------------
  const baseUrl = getEnv().BETTER_AUTH_URL;
  return NextResponse.json(
    { token, url: `${baseUrl}/d/${token}` },
    { status: 201 },
  );
}
