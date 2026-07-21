// app/api/v1/devices/[deviceId]/pin/route.ts
// PUT — set/replace the device's pinned QR URL (1 credit when the URL actually
// changes; identical URL is a free no-op). DELETE — clear the pin (free).
// Requires the devices:pin scope. Idempotency-Key is OPTIONAL on PUT (PUT is
// naturally idempotent; the header only guards the double-charge on a retried
// change). Known conscious trade-off: two concurrent PUTs with the same key can
// each charge once (no claim-first gate like trigger) — last-writer-wins.

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, apiKey as apiKeyTable, apiIdempotency } from "@/lib/db/schema";
import { guardApiRequest } from "@/lib/api/guard";
import { apiError, apiJson } from "@/lib/api/respond";
import { hasScope } from "@/lib/api-scopes";
import { validatePinBody } from "@/lib/pin";
import { setDevicePin, clearDevicePin } from "@/lib/pin-service";
import { isOrgArchived } from "@/lib/archived-guard";

export const runtime = "nodejs";

type PinState = { url: string; pinnedAt: string } | null;
const pinBody = (deviceId: string, pin: PinState) => ({ deviceId, pin });

async function requirePinScope(keyId: string) {
  const [key] = await db
    .select({ scopes: apiKeyTable.scopes })
    .from(apiKeyTable)
    .where(eq(apiKeyTable.id, keyId))
    .limit(1);
  return hasScope(key?.scopes, "devices:pin");
}

async function loadOwnedDevice(deviceId: string, organizationId: string) {
  const [dev] = await db.select().from(deviceTable).where(eq(deviceTable.id, deviceId)).limit(1);
  return dev && dev.organizationId === organizationId ? dev : null;
}

export async function PUT(req: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

  if (!(await requirePinScope(auth.keyId))) {
    return apiError("insufficient_scope", "API key lacks the devices:pin scope.", 403);
  }

  const idemKey = req.headers.get("idempotency-key")?.trim() || null;
  if (idemKey) {
    const [prior] = await db
      .select()
      .from(apiIdempotency)
      .where(and(eq(apiIdempotency.key, idemKey), eq(apiIdempotency.organizationId, auth.organizationId)))
      .limit(1);
    if (prior) return apiJson(prior.responseBody, prior.responseStatus);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError("invalid_request", "Malformed JSON body.", 422);
  }
  const v = validatePinBody(raw);
  if (!v.ok) return apiError("invalid_request", v.error, 422);

  const { deviceId } = await params;
  const dev = await loadOwnedDevice(deviceId, auth.organizationId);
  if (!dev) return apiError("device_not_found", "Device not found.", 404);
  if (await isOrgArchived(auth.organizationId)) {
    return apiError("org_archived", "Organization is archived.", 403);
  }

  const res = await setDevicePin({
    organizationId: auth.organizationId,
    device: { id: dev.id, pinnedUrl: dev.pinnedUrl, pinnedAt: dev.pinnedAt },
    url: v.url,
    actor: { type: "system" },
    via: "api",
  });
  if (!res.ok) return apiError("insufficient_credits", "Not enough credits.", 402);

  const body = pinBody(deviceId, { url: v.url, pinnedAt: res.pinnedAt.toISOString() });
  if (idemKey && !res.noop) {
    await db
      .insert(apiIdempotency)
      .values({ key: idemKey, organizationId: auth.organizationId, responseStatus: 200, responseBody: body, commandId: null })
      .onConflictDoNothing();
  }
  return apiJson(body, 200);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

  if (!(await requirePinScope(auth.keyId))) {
    return apiError("insufficient_scope", "API key lacks the devices:pin scope.", 403);
  }

  const { deviceId } = await params;
  const dev = await loadOwnedDevice(deviceId, auth.organizationId);
  if (!dev) return apiError("device_not_found", "Device not found.", 404);

  // Clearing is free and safe, so archived orgs may clear (spec: archive
  // guards apply to paid mutations; a clear only removes state).
  await clearDevicePin({
    organizationId: auth.organizationId,
    device: { id: dev.id, pinnedUrl: dev.pinnedUrl },
    actor: { type: "system" },
    via: "api",
  });
  return apiJson(pinBody(deviceId, null), 200);
}
