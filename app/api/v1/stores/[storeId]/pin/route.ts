// app/api/v1/stores/[storeId]/pin/route.ts
// PUT — set the store's pinned QR ({url}) or switch its pin mode
// ({mode:"none"|"inherit"}). DELETE — reset the store to "inherit" (devices in
// "inherit" mode then fall back to the tenant pin, if any). Pin changes are
// free under the subscription model. Requires the devices:pin scope.
// Idempotency-Key is OPTIONAL — see lib/api/pin-idempotency.ts (namespace
// "storepin", shared apiIdempotency table with /trigger and the other pin
// endpoints); it guards against a retried/concurrent request enqueuing
// duplicate device commands, not against any charge.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKey as apiKeyTable, store as storeTable } from "@/lib/db/schema";
import { guardApiRequest } from "@/lib/api/guard";
import { apiError, apiJson } from "@/lib/api/respond";
import { hasScope } from "@/lib/api-scopes";
import { validatePinPutBody, type PinMode } from "@/lib/pin";
import { applyScopedPinChange } from "@/lib/pin-service";
import { isOrgArchived } from "@/lib/archived-guard";
import {
  claimPinIdempotency,
  pinIdempotencyResponse,
  storePinIdempotentResponse,
} from "@/lib/api/pin-idempotency";

export const runtime = "nodejs";

// pinnedAt mirrors the stored value; on a same-URL no-op it is the ORIGINAL
// stored timestamp (never freshly minted). Null only under data drift (a
// stored pin without a timestamp).
type PinState = { url: string; pinnedAt: string | null } | null;
const storePinBody = (
  storeId: string,
  pinMode: PinMode,
  pin: PinState,
  affectedDevices: number,
) => ({ storeId, pinMode, pin, affectedDevices });

async function requirePinScope(keyId: string) {
  const [key] = await db
    .select({ scopes: apiKeyTable.scopes })
    .from(apiKeyTable)
    .where(eq(apiKeyTable.id, keyId))
    .limit(1);
  return hasScope(key?.scopes, "devices:pin");
}

async function loadOwnedStore(storeId: string, organizationId: string) {
  const [s] = await db.select().from(storeTable).where(eq(storeTable.id, storeId)).limit(1);
  return s && s.organizationId === organizationId ? s : null;
}

export async function PUT(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
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

  const { storeId } = await params;
  const s = await loadOwnedStore(storeId, auth.organizationId);
  if (!s) return apiError("store_not_found", "Store not found.", 404);

  if (v.kind === "mode") {
    // NOT unconditionally ungated: switching a "none" store back to "inherit"
    // lights up its inheriting devices with the tenant pin, so it's treated
    // like a real mutation for archive purposes. "none" only ever removes, so
    // it stays ungated.
    if (v.mode === "inherit" && (await isOrgArchived(auth.organizationId))) {
      return apiError("org_archived", "Organization is archived.", 403);
    }
    const claim = await claimPinIdempotency({
      req,
      namespace: "storepin",
      organizationId: auth.organizationId,
      request: { scope: "store", storeId, mode: v.mode, url: null },
    });
    if (!claim.owned) return pinIdempotencyResponse(claim);
    const nsKey = claim.nsKey;

    const res = await applyScopedPinChange({
      organizationId: auth.organizationId,
      change: { scope: "store", storeId, mode: v.mode, url: null },
      actor: { type: "system" },
      via: "api",
    });
    const modeBody = storePinBody(storeId, v.mode, null, res.affectedDevices);
    if (nsKey) await storePinIdempotentResponse(nsKey, auth.organizationId, modeBody);
    return apiJson(modeBody, 200);
  }

  // {url} path.
  if (await isOrgArchived(auth.organizationId)) {
    return apiError("org_archived", "Organization is archived.", 403);
  }

  const claim = await claimPinIdempotency({
    req,
    namespace: "storepin",
    organizationId: auth.organizationId,
    request: { scope: "store", storeId, mode: "custom", url: v.url },
  });
  if (!claim.owned) return pinIdempotencyResponse(claim);
  const nsKey = claim.nsKey;

  const res = await applyScopedPinChange({
    organizationId: auth.organizationId,
    change: { scope: "store", storeId, mode: "custom", url: v.url },
    actor: { type: "system" },
    via: "api",
  });

  // res.pinnedAt: fresh timestamp on a real change, the stored original on a
  // same-URL no-op — never fabricate one the DB doesn't have.
  const body = storePinBody(
    storeId,
    "custom",
    { url: v.url, pinnedAt: res.pinnedAt ? res.pinnedAt.toISOString() : null },
    res.affectedDevices,
  );
  if (nsKey) await storePinIdempotentResponse(nsKey, auth.organizationId, body);
  return apiJson(body, 200);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

  if (!(await requirePinScope(auth.keyId))) {
    return apiError("insufficient_scope", "API key lacks the devices:pin scope.", 403);
  }

  const { storeId } = await params;
  const s = await loadOwnedStore(storeId, auth.organizationId);
  if (!s) return apiError("store_not_found", "Store not found.", 404);

  // Resetting to inherit is not "only removes state" — if the store was
  // "none" and a tenant pin exists, its devices light up — so the archive
  // gate applies here too, same as the mode:"inherit" path above.
  if (await isOrgArchived(auth.organizationId)) {
    return apiError("org_archived", "Organization is archived.", 403);
  }
  const res = await applyScopedPinChange({
    organizationId: auth.organizationId,
    change: { scope: "store", storeId, mode: "inherit", url: null },
    actor: { type: "system" },
    via: "api",
  });
  return apiJson(storePinBody(storeId, "inherit", null, res.affectedDevices), 200);
}
