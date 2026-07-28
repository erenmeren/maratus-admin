// app/api/v1/stores/[storeId]/pin/route.ts
// PUT — set the store's pinned QR ({url}) or switch its pin mode
// ({mode:"none"|"inherit"}). DELETE — reset the store to "inherit" (devices in
// "inherit" mode then fall back to the tenant pin, if any). Billing is 1 credit
// per device that ends up showing a pin it wasn't showing before, so {mode:
// "none"} is always free while {mode:"inherit"} and DELETE can bill (and 402)
// when they light devices up from the tenant pin. Requires the devices:pin
// scope. Idempotency-Key is OPTIONAL on the billable paths — see
// lib/api/pin-idempotency.ts (namespace "storepin", shared apiIdempotency table
// with /trigger and the other pin endpoints).

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
  releasePinIdempotency,
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
  creditsCharged: number,
) => ({ storeId, pinMode, pin, affectedDevices, creditsCharged });

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
    // NOT unconditionally free: switching a "none" store back to "inherit"
    // lights up its inheriting devices with the tenant pin, and those devices
    // are billed (lib/pin-resolve.ts planScopedPinChange). "none" only ever
    // removes, so it stays free and ungated.
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
    if (!res.ok) {
      if (nsKey) await releasePinIdempotency(nsKey, auth.organizationId);
      return apiError("insufficient_credits", `Not enough credits — this change needs ${res.required}.`, 402);
    }
    const modeBody = storePinBody(storeId, v.mode, null, res.affectedDevices, res.creditsCharged);
    if (nsKey) await storePinIdempotentResponse(nsKey, auth.organizationId, modeBody);
    return apiJson(modeBody, 200);
  }

  // Paid path: {url}.
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
  if (!res.ok) {
    if (nsKey) await releasePinIdempotency(nsKey, auth.organizationId);
    return apiError("insufficient_credits", `Not enough credits — this change needs ${res.required}.`, 402);
  }

  // res.pinnedAt: fresh timestamp on a real change, the stored original on a
  // same-URL no-op — never fabricate one the DB doesn't have.
  const body = storePinBody(
    storeId,
    "custom",
    { url: v.url, pinnedAt: res.pinnedAt ? res.pinnedAt.toISOString() : null },
    res.affectedDevices,
    res.creditsCharged,
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

  // Resetting to inherit no longer "only removes state" — if the store was
  // "none" and a tenant pin exists, its devices light up and are billed — so
  // the paid-mutation archive gate applies here too.
  if (await isOrgArchived(auth.organizationId)) {
    return apiError("org_archived", "Organization is archived.", 403);
  }
  const res = await applyScopedPinChange({
    organizationId: auth.organizationId,
    change: { scope: "store", storeId, mode: "inherit", url: null },
    actor: { type: "system" },
    via: "api",
  });
  if (!res.ok) {
    return apiError("insufficient_credits", `Not enough credits — this change needs ${res.required}.`, 402);
  }
  return apiJson(storePinBody(storeId, "inherit", null, res.affectedDevices, res.creditsCharged), 200);
}
