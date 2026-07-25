// app/api/v1/devices/[deviceId]/pin/route.ts
// PUT — set the device's pinned QR ({url}, paid: 1 credit when the device's
// EFFECTIVE URL actually changes; identical URL is a free no-op) or switch
// its pin mode ({mode:"none"|"inherit"}, free). DELETE — reset the device to
// "inherit" mode. NOTE (semantics change, spec §5): DELETE no longer forces a
// guaranteed-blank pin — it falls back to the store/tenant pin, if any, same
// as PUT {mode:"inherit"}. Requires the devices:pin scope. Idempotency-Key is
// OPTIONAL on the paid {url} path (PUT is naturally idempotent; the header
// only guards the double-charge on a retried or concurrent change). When
// provided, the key is claimed (inserted) BEFORE charging — mirroring
// /trigger — so two concurrent requests with the same key spend at most one
// credit: the loser of the insert race replays the winner's claimed response
// instead of charging again, and a failed charge deletes the claim so a retry
// can proceed. Stored keys are prefixed "pin:" (lib/api/pin-idempotency.ts)
// because the apiIdempotency table is shared with /trigger and the other pin
// endpoints, and without the prefix a key reused across endpoints would
// replay the wrong endpoint's stored response.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, store as storeTable, tenantSettings, apiKey as apiKeyTable } from "@/lib/db/schema";
import { guardApiRequest } from "@/lib/api/guard";
import { apiError, apiJson } from "@/lib/api/respond";
import { hasScope } from "@/lib/api-scopes";
import { validatePinPutBody, type PinMode } from "@/lib/pin";
import { applyScopedPinChange } from "@/lib/pin-service";
import { resolveEffectivePin } from "@/lib/pin-resolve";
import { isOrgArchived } from "@/lib/archived-guard";
import { claimPinIdempotency, releasePinIdempotency, storePinIdempotentResponse } from "@/lib/api/pin-idempotency";

export const runtime = "nodejs";

type PinState = { url: string; pinnedAt: string } | null;
const deviceBody = (
  deviceId: string,
  pinMode: PinMode,
  pin: PinState,
  effectiveUrl: string | null,
  affectedDevices: number,
  creditsCharged: number,
) => ({ deviceId, pinMode, pin, effectiveUrl, affectedDevices, creditsCharged });

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

/** Resolve what a device with the given storeId/pinMode/pinnedUrl currently
 * shows, per the device > store > tenant precedence (lib/pin-resolve.ts). */
async function resolveDeviceEffectiveUrl(
  organizationId: string,
  storeId: string | null,
  device: { pinMode: PinMode; pinnedUrl: string | null },
): Promise<string | null> {
  if (device.pinMode === "none") return null;
  if (device.pinMode === "custom") return device.pinnedUrl;
  const [storeRow, [ts]] = await Promise.all([
    storeId
      ? db
          .select({ pinMode: storeTable.pinMode, pinnedUrl: storeTable.pinnedUrl })
          .from(storeTable)
          .where(eq(storeTable.id, storeId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db.select({ pinnedUrl: tenantSettings.pinnedUrl }).from(tenantSettings).where(eq(tenantSettings.organizationId, organizationId)),
  ]);
  return resolveEffectivePin({ device, store: storeRow, tenant: { pinnedUrl: ts?.pinnedUrl ?? null } }).url;
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
  const v = validatePinPutBody(raw);
  if (!v.ok) return apiError("invalid_request", v.error, 422);

  const { deviceId } = await params;
  const dev = await loadOwnedDevice(deviceId, auth.organizationId);
  if (!dev) return apiError("device_not_found", "Device not found.", 404);

  if (v.kind === "mode") {
    // Free path: no idempotency claim, no archive gate.
    const res = await applyScopedPinChange({
      organizationId: auth.organizationId,
      change: { scope: "device", deviceId, mode: v.mode, url: null },
      actor: { type: "system" },
      via: "api",
    });
    const effectiveUrl = await resolveDeviceEffectiveUrl(auth.organizationId, dev.storeId, { pinMode: v.mode, pinnedUrl: null });
    return apiJson(
      deviceBody(deviceId, v.mode, null, effectiveUrl, res.ok ? res.affectedDevices : 0, res.ok ? res.creditsCharged : 0),
      200,
    );
  }

  // kind === "url": paid path.
  if (await isOrgArchived(auth.organizationId)) {
    return apiError("org_archived", "Organization is archived.", 403);
  }

  // Free no-op: identical URL, no idempotency claim, no charge.
  if (dev.pinnedUrl === v.url) {
    const pinnedAt = (dev.pinnedAt ?? new Date()).toISOString();
    return apiJson(deviceBody(deviceId, "custom", { url: v.url, pinnedAt }, v.url, 0, 0), 200);
  }

  const placeholder = deviceBody(deviceId, "custom", { url: v.url, pinnedAt: new Date().toISOString() }, v.url, 0, 0);
  const claim = await claimPinIdempotency({
    req,
    namespace: "pin",
    organizationId: auth.organizationId,
    placeholderBody: placeholder,
  });
  if (!claim.owned) {
    if (claim.replay) return apiJson(claim.replay.body, claim.replay.status);
    return apiError("conflict", "Concurrent request in progress.", 409);
  }
  const nsKey = claim.nsKey;

  const res = await applyScopedPinChange({
    organizationId: auth.organizationId,
    change: { scope: "device", deviceId, mode: "custom", url: v.url },
    actor: { type: "system" },
    via: "api",
  });
  if (!res.ok) {
    if (nsKey) await releasePinIdempotency(nsKey, auth.organizationId);
    return apiError("insufficient_credits", `Not enough credits — this change needs ${res.required}.`, 402);
  }

  const body = deviceBody(
    deviceId,
    "custom",
    { url: v.url, pinnedAt: (res.pinnedAt ?? new Date()).toISOString() },
    v.url,
    res.affectedDevices,
    res.creditsCharged,
  );
  if (nsKey) await storePinIdempotentResponse(nsKey, auth.organizationId, body);
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

  // Resetting to inherit is free and safe, so archived orgs may do it (spec:
  // archive guards apply to paid mutations; this only removes state).
  const res = await applyScopedPinChange({
    organizationId: auth.organizationId,
    change: { scope: "device", deviceId, mode: "inherit", url: null },
    actor: { type: "system" },
    via: "api",
  });
  const effectiveUrl = await resolveDeviceEffectiveUrl(auth.organizationId, dev.storeId, { pinMode: "inherit", pinnedUrl: null });
  return apiJson(deviceBody(deviceId, "inherit", null, effectiveUrl, res.ok ? res.affectedDevices : 0, 0), 200);
}
