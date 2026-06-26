import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand, apiKey as apiKeyTable, apiIdempotency } from "@/lib/db/schema";
import { guardApiRequest } from "@/lib/api/guard";
import { apiError, apiJson } from "@/lib/api/respond";
import { hasScope } from "@/lib/api-scopes";
import { validateTriggerBody, creditCostForAction } from "@/lib/trigger-actions";
import { reserveCredit, releaseHold } from "@/lib/credits";
import { effectiveDeviceStatus } from "@/lib/device-status";
import { id } from "@/lib/ids";

export const runtime = "nodejs";
const TTL_MS = 60_000;

export async function POST(req: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

  // scope
  const [key] = await db.select({ scopes: apiKeyTable.scopes }).from(apiKeyTable).where(eq(apiKeyTable.id, auth.keyId)).limit(1);
  if (!hasScope(key?.scopes, "devices:trigger")) {
    return apiError("insufficient_scope", "API key lacks the devices:trigger scope.", 403);
  }

  // idempotency key required
  const idemKey = req.headers.get("idempotency-key")?.trim();
  if (!idemKey) return apiError("missing_idempotency_key", "Idempotency-Key header is required.", 400);
  const [prior] = await db.select().from(apiIdempotency)
    .where(and(eq(apiIdempotency.key, idemKey), eq(apiIdempotency.organizationId, auth.organizationId))).limit(1);
  if (prior) return apiJson(prior.responseBody, prior.responseStatus);

  // body
  let raw: unknown;
  try { raw = await req.json(); } catch { return apiError("invalid_request", "Malformed JSON body.", 422); }
  const v = validateTriggerBody(raw);
  if (!v.ok) return apiError("invalid_request", v.error, 422);

  // device ownership + eligibility
  const { deviceId } = await params;
  const [dev] = await db.select().from(deviceTable).where(eq(deviceTable.id, deviceId)).limit(1);
  if (!dev || dev.organizationId !== auth.organizationId) return apiError("device_not_found", "Device not found.", 404);
  if (effectiveDeviceStatus(dev.status, dev.lastSeenAt, new Date()) !== "online") {
    return apiError("device_offline", "Device is offline or paused.", 409);
  }

  // reserve
  const cost = creditCostForAction(v.action);
  const commandId = id("cmd");
  const reserved = await reserveCredit({ organizationId: auth.organizationId, deviceId, action: v.action, commandId, cost });
  if (!reserved.ok) return apiError("insufficient_credits", "Not enough credits.", 402);

  // enqueue
  try {
    await db.insert(deviceCommand).values({
      id: commandId, deviceId, organizationId: auth.organizationId, type: "trigger",
      status: "pending", action: v.action, payload: v.payload, expiresAt: new Date(Date.now() + TTL_MS),
    });
  } catch {
    await releaseHold({ organizationId: auth.organizationId, commandId, cost });
    return apiError("internal_error", "Could not enqueue the command.", 500);
  }

  const body = { id: commandId, status: "queued" as const };
  await db.insert(apiIdempotency).values({
    key: idemKey, organizationId: auth.organizationId, responseStatus: 202, responseBody: body, commandId,
  }).onConflictDoNothing();
  return apiJson(body, 202);
}
