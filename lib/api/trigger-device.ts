import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand, apiIdempotency } from "@/lib/db/schema";
import { guardApiRequest, requireScope } from "@/lib/api/guard";
import { apiError, apiJson } from "@/lib/api/respond";
import { validateTriggerBody } from "@/lib/trigger-actions";
import { checkSubscriptionGate } from "@/lib/subscription-gate";
import { effectiveDeviceStatus } from "@/lib/device-status";
import { id } from "@/lib/ids";
import { publishCommand, mqttEnabled } from "@/lib/mqtt";

export type DeviceRow = typeof deviceTable.$inferSelect;

const TTL_MS = 60_000;

export async function handleTrigger(
  req: Request,
  resolve: (organizationId: string) => Promise<DeviceRow | null>,
  notFound: { code: string; message: string },
): Promise<Response> {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

  // scope
  const denied = await requireScope(auth, "devices:trigger");
  if (denied) return denied;

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
  const dev = await resolve(auth.organizationId);
  if (!dev) return apiError(notFound.code, notFound.message, 404);
  const deviceId = dev.id;
  if (effectiveDeviceStatus(dev.status, dev.lastSeenAt, new Date()) !== "online") {
    return apiError("device_offline", "Device is offline or paused.", 409);
  }

  // Post-paid overage means quota never blocks a request; the only billing
  // question left is whether this device is paid for (or still in trial).
  const gate = await checkSubscriptionGate({
    deviceId,
    subscriptionPaidAt: dev.subscriptionPaidAt,
  });
  if (!gate.ok) {
    return apiError(
      "device_not_subscribed",
      "This device has no active subscription. Contact Maratus to activate it.",
      403,
    );
  }

  // Two different 503s, told apart HERE rather than at the publish below, because
  // only one of them can ever succeed on retry. A deployment missing the EMQX env
  // group has no transport at all: retrying is futile. Checked before the
  // idempotency claim so this path leaves nothing behind.
  if (!mqttEnabled()) {
    console.error("[trigger] EMQX env group missing; no device transport is configured", {
      deviceId,
      organizationId: auth.organizationId,
    });
    return apiError(
      "transport_unconfigured",
      "The device transport is not configured on this deployment. Retrying will not help.",
      503,
    );
  }

  const commandId = id("cmd");
  const body = { id: commandId, status: "queued" as const };

  // Claim the idempotency key BEFORE enqueuing — the insert conflict is the concurrency gate.
  const claim = await db.insert(apiIdempotency)
    .values({ key: idemKey, organizationId: auth.organizationId, responseStatus: 202, responseBody: body, commandId })
    .onConflictDoNothing()
    .returning({ key: apiIdempotency.key });
  if (claim.length === 0) {
    // Another request (concurrent or prior) already claimed this key — replay its stored response.
    const [existing] = await db.select().from(apiIdempotency)
      .where(and(eq(apiIdempotency.key, idemKey), eq(apiIdempotency.organizationId, auth.organizationId))).limit(1);
    if (existing) return apiJson(existing.responseBody, existing.responseStatus);
    return apiError("conflict", "Concurrent request in progress.", 409);
  }

  try {
    await db.insert(deviceCommand).values({
      id: commandId, deviceId, organizationId: auth.organizationId, type: "trigger",
      status: "pending", action: v.action, payload: v.payload,
      expiresAt: new Date(Date.now() + TTL_MS),
    });
  } catch {
    await db.delete(apiIdempotency).where(and(eq(apiIdempotency.key, idemKey), eq(apiIdempotency.organizationId, auth.organizationId)));
    return apiError("internal_error", "Could not enqueue the command.", 500);
  }

  // MQTT is the only transport, so a failed publish means the command will never
  // reach the device. A trigger delivered minutes later is worthless — the
  // customer is at the counter now — and leaving the row pending would make the
  // heartbeat republish show an unwanted QR later. Fail closed instead: mark it
  // failed and tell the caller — but only if the row is still pending (see
  // below; a lost publish response is not a lost publish).
  const published = await publishCommand(deviceId, {
    commandId,
    type: "trigger",
    action: v.action,
    payload: v.payload,
  });
  if (!published) {
    // A lost publish RESPONSE is not a lost publish: publishCommand allows two
    // 2-second attempts and measured ack latency is ~1.9s, so the device can
    // genuinely ack while we are still deciding the publish "failed". Only a
    // row still `pending` is safe to mark failed — otherwise we would overwrite
    // a real ack and report 503 for a trigger that actually reached the screen.
    const failed = await db
      .update(deviceCommand)
      .set({ status: "failed", result: "publish_failed" })
      .where(and(eq(deviceCommand.id, commandId), eq(deviceCommand.status, "pending")))
      .returning({ id: deviceCommand.id });
    if (failed.length === 0) {
      // Something already moved this row past `pending`; in practice that is the
      // device acking while we timed out. The trigger DID reach the screen — so
      // unwind NOTHING: leave the row and the idempotency claim exactly as the
      // ack left them, and answer the caller with the normal success body.
      console.warn("[trigger] publish reported failure but command left pending state", {
        commandId,
        deviceId,
        organizationId: auth.organizationId,
      });
      return apiJson(body, 202);
    }
    await db
      .delete(apiIdempotency)
      .where(
        and(
          eq(apiIdempotency.key, idemKey),
          eq(apiIdempotency.organizationId, auth.organizationId),
        ),
      );
    // Reaching here means the transport IS configured (checked above) but the
    // broker did not accept the publish — a transient fault, so unlike
    // transport_unconfigured this one is worth retrying.
    console.error("[trigger] EMQX publish failed; broker unreachable or rejecting", {
      commandId,
      deviceId,
      organizationId: auth.organizationId,
    });
    return apiError(
      "transport_unavailable",
      "Could not reach the device transport. Retry.",
      503,
    );
  }

  return apiJson(body, 202);
}
