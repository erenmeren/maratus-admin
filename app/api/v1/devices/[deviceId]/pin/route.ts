// app/api/v1/devices/[deviceId]/pin/route.ts
// PUT — set/replace the device's pinned QR URL (1 credit when the URL actually
// changes; identical URL is a free no-op). DELETE — clear the pin (free).
// Requires the devices:pin scope. Idempotency-Key is OPTIONAL on PUT (PUT is
// naturally idempotent; the header only guards the double-charge on a retried
// or concurrent change). When provided, the key is claimed (inserted) BEFORE
// charging — mirroring /trigger — so two concurrent PUTs with the same key
// spend at most one credit: the loser of the insert race replays the winner's
// claimed response instead of charging again, and a failed charge deletes the
// claim so a retry can proceed. Stored keys are prefixed "pin:" because the
// apiIdempotency table is shared with /trigger, and without the prefix a key
// reused across endpoints would replay the other endpoint's stored response.

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

  // Free no-op: identical URL, no idempotency claim, no charge.
  if (dev.pinnedUrl === v.url) {
    const pinnedAt = (dev.pinnedAt ?? new Date()).toISOString();
    return apiJson(pinBody(deviceId, { url: v.url, pinnedAt }), 200);
  }

  // apiIdempotency is shared with /trigger, so the key is namespaced to this
  // endpoint — otherwise a key reused across endpoints would replay the
  // wrong endpoint's stored response (e.g. a trigger's 202 body here).
  const idemKey = req.headers.get("idempotency-key")?.trim() || null;
  const nsKey = idemKey ? `pin:${idemKey}` : null;

  if (nsKey) {
    // Claim the key BEFORE charging — the insert conflict is the concurrency
    // gate (mirrors /trigger). The placeholder body is overwritten below once
    // the real pinnedAt is known; a concurrent loser that reads it in the
    // narrow window before the overwrite gets a near-correct timestamp.
    const claimedAt = new Date();
    const placeholder = pinBody(deviceId, { url: v.url, pinnedAt: claimedAt.toISOString() });
    const claim = await db
      .insert(apiIdempotency)
      .values({ key: nsKey, organizationId: auth.organizationId, responseStatus: 200, responseBody: placeholder, commandId: null })
      .onConflictDoNothing()
      .returning({ key: apiIdempotency.key });
    if (claim.length === 0) {
      // Another request (concurrent or prior) already claimed this key — replay its stored response.
      const [existing] = await db
        .select()
        .from(apiIdempotency)
        .where(and(eq(apiIdempotency.key, nsKey), eq(apiIdempotency.organizationId, auth.organizationId)))
        .limit(1);
      if (existing) return apiJson(existing.responseBody, existing.responseStatus);
      return apiError("conflict", "Concurrent request in progress.", 409);
    }
  }

  // We own the claim (or none was requested). Charge; on failure, release the
  // claim so a retry can proceed.
  const res = await setDevicePin({
    organizationId: auth.organizationId,
    device: { id: dev.id, pinnedUrl: dev.pinnedUrl, pinnedAt: dev.pinnedAt },
    url: v.url,
    actor: { type: "system" },
    via: "api",
  });
  if (!res.ok) {
    if (nsKey) {
      await db.delete(apiIdempotency).where(and(eq(apiIdempotency.key, nsKey), eq(apiIdempotency.organizationId, auth.organizationId)));
    }
    return apiError("insufficient_credits", "Not enough credits.", 402);
  }

  const body = pinBody(deviceId, { url: v.url, pinnedAt: res.pinnedAt.toISOString() });
  if (nsKey) {
    await db
      .update(apiIdempotency)
      .set({ responseBody: body })
      .where(and(eq(apiIdempotency.key, nsKey), eq(apiIdempotency.organizationId, auth.organizationId)));
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
