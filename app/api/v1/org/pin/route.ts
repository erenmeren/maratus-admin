// app/api/v1/org/pin/route.ts
// PUT — set/replace the tenant-wide pinned QR URL (paid: 1 credit per device
// whose effective pin actually changes; a same-URL PUT is a free no-op via
// applyScopedPinChange's noop path). DELETE — clear the tenant pin (free;
// devices/stores in "inherit" mode fall back further, i.e. show nothing).
// Requires the devices:pin scope. Idempotency-Key is OPTIONAL on PUT — see
// lib/api/pin-idempotency.ts for the claim-before-charge pattern (namespace
// "orgpin", shared apiIdempotency table with /trigger and the other pin
// endpoints).

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKey as apiKeyTable } from "@/lib/db/schema";
import { guardApiRequest } from "@/lib/api/guard";
import { apiError, apiJson } from "@/lib/api/respond";
import { hasScope } from "@/lib/api-scopes";
import { validatePinPutBody } from "@/lib/pin";
import { applyScopedPinChange } from "@/lib/pin-service";
import { isOrgArchived } from "@/lib/archived-guard";
import { claimPinIdempotency, releasePinIdempotency, storePinIdempotentResponse } from "@/lib/api/pin-idempotency";

export const runtime = "nodejs";

// pinnedAt mirrors the stored value; on a same-URL no-op it is the ORIGINAL
// stored timestamp (never freshly minted). Null only under data drift (a
// stored pin without a timestamp).
type PinState = { url: string; pinnedAt: string | null } | null;
const orgPinBody = (pin: PinState, affectedDevices: number, creditsCharged: number) => ({
  pin,
  affectedDevices,
  creditsCharged,
});

async function requirePinScope(keyId: string) {
  const [key] = await db
    .select({ scopes: apiKeyTable.scopes })
    .from(apiKeyTable)
    .where(eq(apiKeyTable.id, keyId))
    .limit(1);
  return hasScope(key?.scopes, "devices:pin");
}

export async function PUT(req: Request) {
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
  const v = validatePinPutBody(raw, { allowMode: false });
  if (!v.ok) return apiError("invalid_request", v.error, 422);
  if (v.kind !== "url") {
    // Unreachable with allowMode:false, kept for exhaustive narrowing.
    return apiError("invalid_request", "`mode` is not supported at this scope; send `url`.", 422);
  }

  if (await isOrgArchived(auth.organizationId)) {
    return apiError("org_archived", "Organization is archived.", 403);
  }

  const placeholder = orgPinBody({ url: v.url, pinnedAt: new Date().toISOString() }, 0, 0);
  const claim = await claimPinIdempotency({
    req,
    namespace: "orgpin",
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
    change: { scope: "org", url: v.url },
    actor: { type: "system" },
    via: "api",
  });
  if (!res.ok) {
    if (nsKey) await releasePinIdempotency(nsKey, auth.organizationId);
    return apiError("insufficient_credits", `Not enough credits — this change needs ${res.required}.`, 402);
  }

  // res.pinnedAt: fresh timestamp on a real change, the stored original on a
  // same-URL no-op — never fabricate one the DB doesn't have.
  const body = orgPinBody(
    { url: v.url, pinnedAt: res.pinnedAt ? res.pinnedAt.toISOString() : null },
    res.affectedDevices,
    res.creditsCharged,
  );
  if (nsKey) await storePinIdempotentResponse(nsKey, auth.organizationId, body);
  return apiJson(body, 200);
}

export async function DELETE(req: Request) {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

  if (!(await requirePinScope(auth.keyId))) {
    return apiError("insufficient_scope", "API key lacks the devices:pin scope.", 403);
  }

  // Clearing is free and safe, so archived orgs may clear (spec: archive
  // guards apply to paid mutations; a clear only removes state).
  const res = await applyScopedPinChange({
    organizationId: auth.organizationId,
    change: { scope: "org", url: null },
    actor: { type: "system" },
    via: "api",
  });
  return apiJson(orgPinBody(null, res.ok ? res.affectedDevices : 0, 0), 200);
}
