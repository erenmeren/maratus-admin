// lib/api/pin-idempotency.ts
// Shared Idempotency-Key claim/replay/release for the paid pin PUTs. The
// apiIdempotency table is shared with /trigger, so every endpoint namespaces
// its keys ("pin:" | "storepin:" | "orgpin:") — a key reused across endpoints
// must never replay another endpoint's stored body.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiIdempotency } from "@/lib/db/schema";

export type IdemClaim =
  | { owned: true; nsKey: string }
  | { owned: false; replay: { status: number; body: unknown } | null }
  | { owned: true; nsKey: null }; // no key requested

export async function claimPinIdempotency(a: {
  req: Request;
  namespace: "pin" | "storepin" | "orgpin";
  organizationId: string;
  placeholderBody: unknown;
}): Promise<IdemClaim> {
  const idemKey = a.req.headers.get("idempotency-key")?.trim() || null;
  if (!idemKey) return { owned: true, nsKey: null };
  const nsKey = `${a.namespace}:${idemKey}`;
  const claim = await db
    .insert(apiIdempotency)
    .values({ key: nsKey, organizationId: a.organizationId, responseStatus: 200, responseBody: a.placeholderBody, commandId: null })
    .onConflictDoNothing()
    .returning({ key: apiIdempotency.key });
  if (claim.length > 0) return { owned: true, nsKey };
  const [existing] = await db
    .select()
    .from(apiIdempotency)
    .where(and(eq(apiIdempotency.key, nsKey), eq(apiIdempotency.organizationId, a.organizationId)))
    .limit(1);
  return { owned: false, replay: existing ? { status: existing.responseStatus, body: existing.responseBody } : null };
}

export async function releasePinIdempotency(nsKey: string, organizationId: string): Promise<void> {
  await db.delete(apiIdempotency).where(and(eq(apiIdempotency.key, nsKey), eq(apiIdempotency.organizationId, organizationId)));
}

export async function storePinIdempotentResponse(nsKey: string, organizationId: string, body: unknown): Promise<void> {
  await db.update(apiIdempotency).set({ responseBody: body }).where(and(eq(apiIdempotency.key, nsKey), eq(apiIdempotency.organizationId, organizationId)));
}
