// lib/api/pin-idempotency.ts
// Shared Idempotency-Key claim/replay/release for the paid pin PUTs. The
// apiIdempotency table is shared with /trigger, so every endpoint namespaces
// its keys ("pin:" | "storepin:" | "orgpin:") — a key reused across endpoints
// must never replay another endpoint's stored body.
//
// The claim is a RESERVATION, not an answer. It is inserted with
// responseStatus 0 (IN_PROGRESS) and an empty body; the real status/body land
// only once the work has actually happened. A concurrent loser therefore gets
// 409 "still in progress" rather than an optimistic 200 — the winner may still
// fail on credits (402), and reporting a pin that was never applied (with
// affectedDevices/creditsCharged of 0, which is wrong for a fan-out anyway) is
// worse than making the caller retry.
import { createHash } from "node:crypto";
import type { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiIdempotency } from "@/lib/db/schema";
import { apiError, apiJson } from "@/lib/api/respond";

/** responseStatus sentinel: claimed, outcome not yet known. Never a real status. */
export const IDEM_IN_PROGRESS = 0;

export type IdemClaim =
  /** We own the claim; nsKey is null when the caller sent no Idempotency-Key. */
  | { owned: true; nsKey: string | null }
  /** A completed request with this key exists — return its stored outcome. */
  | { owned: false; kind: "replay"; status: number; body: unknown }
  /** The key is claimed but unfinished (or was swept mid-flight). */
  | { owned: false; kind: "in_progress" }
  /** The key was already used for a DIFFERENT request payload. */
  | { owned: false; kind: "mismatch" };

/**
 * Canonical fingerprint of the operation a request is asking for. Callers pass
 * an object literal with a fixed key order, so JSON.stringify is stable.
 */
export function pinRequestFingerprint(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function claimPinIdempotency(a: {
  req: Request;
  namespace: "pin" | "storepin" | "orgpin";
  organizationId: string;
  /** The operation being requested — fingerprinted to detect key reuse. */
  request: unknown;
}): Promise<IdemClaim> {
  const idemKey = a.req.headers.get("idempotency-key")?.trim() || null;
  if (!idemKey) return { owned: true, nsKey: null };
  const nsKey = `${a.namespace}:${idemKey}`;
  const fingerprint = pinRequestFingerprint(a.request);

  const claim = await db
    .insert(apiIdempotency)
    .values({
      key: nsKey,
      organizationId: a.organizationId,
      responseStatus: IDEM_IN_PROGRESS,
      responseBody: {},
      requestFingerprint: fingerprint,
      commandId: null,
    })
    .onConflictDoNothing()
    .returning({ key: apiIdempotency.key });
  if (claim.length > 0) return { owned: true, nsKey };

  const [existing] = await db
    .select()
    .from(apiIdempotency)
    .where(and(eq(apiIdempotency.key, nsKey), eq(apiIdempotency.organizationId, a.organizationId)))
    .limit(1);
  // Lost the insert race but the row is already gone (retention sweep, or the
  // winner released it on a failed charge): treat as in-flight and let the
  // caller retry rather than guessing an outcome.
  if (!existing) return { owned: false, kind: "in_progress" };
  // Legacy/foreign rows carry no fingerprint — skip the comparison rather than
  // reject a retry that predates this column.
  if (existing.requestFingerprint !== null && existing.requestFingerprint !== fingerprint) {
    return { owned: false, kind: "mismatch" };
  }
  if (existing.responseStatus === IDEM_IN_PROGRESS) return { owned: false, kind: "in_progress" };
  return { owned: false, kind: "replay", status: existing.responseStatus, body: existing.responseBody };
}

/** The response every endpoint owes a caller whose claim we don't own. */
export function pinIdempotencyResponse(claim: Extract<IdemClaim, { owned: false }>): NextResponse {
  if (claim.kind === "replay") return apiJson(claim.body, claim.status);
  if (claim.kind === "mismatch") {
    return apiError(
      "invalid_request",
      "This Idempotency-Key was already used with a different request body.",
      422,
    );
  }
  return apiError("conflict", "A request with this Idempotency-Key is still in progress.", 409);
}

export async function releasePinIdempotency(nsKey: string, organizationId: string): Promise<void> {
  await db.delete(apiIdempotency).where(and(eq(apiIdempotency.key, nsKey), eq(apiIdempotency.organizationId, organizationId)));
}

/** Publish the real outcome, flipping the row out of IDEM_IN_PROGRESS. */
export async function storePinIdempotentResponse(
  nsKey: string,
  organizationId: string,
  body: unknown,
  status = 200,
): Promise<void> {
  await db
    .update(apiIdempotency)
    .set({ responseStatus: status, responseBody: body })
    .where(and(eq(apiIdempotency.key, nsKey), eq(apiIdempotency.organizationId, organizationId)));
}
