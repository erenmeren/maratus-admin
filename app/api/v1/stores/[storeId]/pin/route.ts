// app/api/v1/stores/[storeId]/pin/route.ts
// PUT — set the store's pinned QR ({url}, paid: 1 credit per device whose
// effective pin actually changes) or switch its pin mode ({mode:"none"|
// "inherit"}, free). DELETE — reset the store to "inherit" (free; devices in
// "inherit" mode then fall back to the tenant pin, if any). Requires the
// devices:pin scope. Idempotency-Key is OPTIONAL and only meaningful on the
// paid {url} path — see lib/api/pin-idempotency.ts (namespace "storepin",
// shared apiIdempotency table with /trigger and the other pin endpoints).

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKey as apiKeyTable, store as storeTable } from "@/lib/db/schema";
import { guardApiRequest } from "@/lib/api/guard";
import { apiError, apiJson } from "@/lib/api/respond";
import { hasScope } from "@/lib/api-scopes";
import { validatePinPutBody, type PinMode } from "@/lib/pin";
import { applyScopedPinChange } from "@/lib/pin-service";
import { isOrgArchived } from "@/lib/archived-guard";
import { claimPinIdempotency, releasePinIdempotency, storePinIdempotentResponse } from "@/lib/api/pin-idempotency";

export const runtime = "nodejs";

type PinState = { url: string; pinnedAt: string } | null;
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
    // Free path: no idempotency claim, no archive gate.
    const res = await applyScopedPinChange({
      organizationId: auth.organizationId,
      change: { scope: "store", storeId, mode: v.mode, url: null },
      actor: { type: "system" },
      via: "api",
    });
    return apiJson(storePinBody(storeId, v.mode, null, res.ok ? res.affectedDevices : 0, res.ok ? res.creditsCharged : 0), 200);
  }

  // Paid path: {url}.
  if (await isOrgArchived(auth.organizationId)) {
    return apiError("org_archived", "Organization is archived.", 403);
  }

  const placeholder = storePinBody(storeId, "custom", { url: v.url, pinnedAt: new Date().toISOString() }, 0, 0);
  const claim = await claimPinIdempotency({
    req,
    namespace: "storepin",
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
    change: { scope: "store", storeId, mode: "custom", url: v.url },
    actor: { type: "system" },
    via: "api",
  });
  if (!res.ok) {
    if (nsKey) await releasePinIdempotency(nsKey, auth.organizationId);
    return apiError("insufficient_credits", `Not enough credits — this change needs ${res.required}.`, 402);
  }

  const body = storePinBody(
    storeId,
    "custom",
    { url: v.url, pinnedAt: (res.pinnedAt ?? new Date()).toISOString() },
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

  // Resetting to inherit is free and safe, so archived orgs may do it (spec:
  // archive guards apply to paid mutations; this only removes state).
  const res = await applyScopedPinChange({
    organizationId: auth.organizationId,
    change: { scope: "store", storeId, mode: "inherit", url: null },
    actor: { type: "system" },
    via: "api",
  });
  return apiJson(storePinBody(storeId, "inherit", null, res.ok ? res.affectedDevices : 0, 0), 200);
}
