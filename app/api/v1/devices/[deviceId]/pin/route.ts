// app/api/v1/devices/[deviceId]/pin/route.ts
// PUT — set the device's pinned QR ({url}; identical URL is a free no-op) or
// switch its pin mode ({mode:"none"|"inherit"}). NOTE (semantics change, spec
// §5): DELETE no longer forces a guaranteed-blank pin — it falls back to the
// store/tenant pin, if any, same as PUT {mode:"inherit"}. Pin changes are free
// under the subscription model — nothing here is billed. Requires the
// devices:pin scope. Idempotency-Key is OPTIONAL (PUT is naturally idempotent;
// the header only guards against a retried or concurrent request enqueuing
// duplicate device commands). Stored keys are prefixed "pin:"
// (lib/api/pin-idempotency.ts) because the apiIdempotency table is shared with
// /trigger and the other pin endpoints, and without the prefix a key reused
// across endpoints would replay the wrong endpoint's stored response.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, store as storeTable, tenantSettings } from "@/lib/db/schema";
import { guardApiRequest, requireScope } from "@/lib/api/guard";
import { apiError, apiJson } from "@/lib/api/respond";
import { validatePinPutBody, type PinMode } from "@/lib/pin";
import { applyScopedPinChange } from "@/lib/pin-service";
import { resolveEffectivePin } from "@/lib/pin-resolve";
import { isOrgArchived } from "@/lib/archived-guard";
import {
  claimPinIdempotency,
  pinIdempotencyResponse,
  storePinIdempotentResponse,
  withPinClaim,
} from "@/lib/api/pin-idempotency";

export const runtime = "nodejs";

type PinState = { url: string; pinnedAt: string } | null;
const deviceBody = (
  deviceId: string,
  pinMode: PinMode,
  pin: PinState,
  effectiveUrl: string | null,
  affectedDevices: number,
) => ({ deviceId, pinMode, pin, effectiveUrl, affectedDevices });

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

  const denied = await requireScope(auth, "devices:pin");
  if (denied) return denied;

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
    // NOT unconditionally ungated: a device switching from "none" to
    // "inherit" starts showing the store/tenant pin, so it's treated like a
    // real mutation for archive purposes. "none" only ever removes, so it
    // stays ungated.
    if (v.mode === "inherit" && (await isOrgArchived(auth.organizationId))) {
      return apiError("org_archived", "Organization is archived.", 403);
    }
    const claim = await claimPinIdempotency({
      req,
      namespace: "pin",
      organizationId: auth.organizationId,
      request: { scope: "device", deviceId, mode: v.mode, url: null },
    });
    if (!claim.owned) return pinIdempotencyResponse(claim);
    const nsKey = claim.nsKey;

    const modeBody = await withPinClaim({ nsKey, organizationId: auth.organizationId }, async () => {
      const res = await applyScopedPinChange({
        organizationId: auth.organizationId,
        change: { scope: "device", deviceId, mode: v.mode, url: null },
        actor: { type: "system" },
        via: "api",
      });
      const effectiveUrl = await resolveDeviceEffectiveUrl(auth.organizationId, dev.storeId, { pinMode: v.mode, pinnedUrl: null });
      const body = deviceBody(deviceId, v.mode, null, effectiveUrl, res.affectedDevices);
      if (nsKey) await storePinIdempotentResponse(nsKey, auth.organizationId, body);
      return body;
    });
    return apiJson(modeBody, 200);
  }

  // kind === "url".
  if (await isOrgArchived(auth.organizationId)) {
    return apiError("org_archived", "Organization is archived.", 403);
  }

  // Free no-op: identical URL, no idempotency claim needed.
  if (dev.pinnedUrl === v.url) {
    const pinnedAt = (dev.pinnedAt ?? new Date()).toISOString();
    return apiJson(deviceBody(deviceId, "custom", { url: v.url, pinnedAt }, v.url, 0), 200);
  }

  const claim = await claimPinIdempotency({
    req,
    namespace: "pin",
    organizationId: auth.organizationId,
    request: { scope: "device", deviceId, mode: "custom", url: v.url },
  });
  if (!claim.owned) return pinIdempotencyResponse(claim);
  const nsKey = claim.nsKey;

  const body = await withPinClaim({ nsKey, organizationId: auth.organizationId }, async () => {
    const res = await applyScopedPinChange({
      organizationId: auth.organizationId,
      change: { scope: "device", deviceId, mode: "custom", url: v.url },
      actor: { type: "system" },
      via: "api",
    });

    const body = deviceBody(
      deviceId,
      "custom",
      { url: v.url, pinnedAt: (res.pinnedAt ?? new Date()).toISOString() },
      v.url,
      res.affectedDevices,
    );
    if (nsKey) await storePinIdempotentResponse(nsKey, auth.organizationId, body);
    return body;
  });
  return apiJson(body, 200);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

  const denied = await requireScope(auth, "devices:pin");
  if (denied) return denied;

  const { deviceId } = await params;
  const dev = await loadOwnedDevice(deviceId, auth.organizationId);
  if (!dev) return apiError("device_not_found", "Device not found.", 404);

  // Resetting to inherit is not "only removes state" — a device that was
  // "none" starts showing the store/tenant pin — so the archive gate applies
  // here too, same as the mode:"inherit" path above.
  if (await isOrgArchived(auth.organizationId)) {
    return apiError("org_archived", "Organization is archived.", 403);
  }
  const res = await applyScopedPinChange({
    organizationId: auth.organizationId,
    change: { scope: "device", deviceId, mode: "inherit", url: null },
    actor: { type: "system" },
    via: "api",
  });
  const effectiveUrl = await resolveDeviceEffectiveUrl(auth.organizationId, dev.storeId, { pinMode: "inherit", pinnedUrl: null });
  return apiJson(deviceBody(deviceId, "inherit", null, effectiveUrl, res.affectedDevices), 200);
}
