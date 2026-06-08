// Webhook delivery: persist a delivery per subscribed endpoint and POST signed
// events. Failures schedule a retry (see retry.ts) and count toward auto-disable
// at 15 consecutive failures. All errors are swallowed/logged — webhook delivery
// must never affect the caller (ingest / public receipt page).
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookEndpoint as epTable, webhookDelivery as delTable } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";
import { signPayload } from "./sign";
import { isAllowedWebhookUrl } from "./url-guard";
import { nextBackoff } from "./retry";
import { buildEvent, type WebhookEventType } from "./events";
import type { ApiReceiptRow } from "@/lib/api/serialize";

const TIMEOUT_MS = 5_000;
const AUTO_DISABLE_AT = 15;

type EndpointRow = typeof epTable.$inferSelect;
type DeliveryRow = typeof delTable.$inferSelect;

/** Attempt one delivery (initial or retry). Returns the response status (or null).
 *  Updates the delivery row + the endpoint's failure bookkeeping. */
export async function attemptDelivery(delivery: DeliveryRow, endpoint: EndpointRow): Promise<{ ok: boolean; responseStatus: number | null }> {
  const now = new Date();
  const attempts = delivery.attempts + 1;
  const body = JSON.stringify(delivery.payload);

  // Re-check the URL each attempt (DNS may have changed since creation).
  const guard = isAllowedWebhookUrl(endpoint.url);
  if (!guard.ok) {
    await db.update(delTable).set({ status: "failed", attempts, responseStatus: null, lastAttemptAt: now, nextRetryAt: null }).where(eq(delTable.id, delivery.id));
    return { ok: false, responseStatus: null };
  }

  let responseStatus: number | null = null;
  let ok = false;
  try {
    const ts = Math.floor(now.getTime() / 1000);
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ditto-event-id": delivery.eventId,
        "x-ditto-event-type": delivery.eventType,
        "x-ditto-signature": signPayload(body, endpoint.secret, ts),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    responseStatus = res.status;
    ok = res.ok; // 2xx
  } catch {
    ok = false;
  }

  if (ok) {
    await db.update(delTable).set({ status: "success", attempts, responseStatus, lastAttemptAt: now, nextRetryAt: null }).where(eq(delTable.id, delivery.id));
    await db.update(epTable).set({ consecutiveFailures: 0, lastDeliveryAt: now }).where(eq(epTable.id, endpoint.id));
    return { ok: true, responseStatus };
  }

  const backoff = nextBackoff(attempts);
  await db.update(delTable).set({
    status: "failed", attempts, responseStatus, lastAttemptAt: now,
    nextRetryAt: backoff !== null ? new Date(now.getTime() + backoff) : null,
  }).where(eq(delTable.id, delivery.id));

  const failures = endpoint.consecutiveFailures + 1;
  if (failures >= AUTO_DISABLE_AT) {
    await db.update(epTable).set({ enabled: false, disabledReason: "too_many_failures", consecutiveFailures: failures }).where(eq(epTable.id, endpoint.id));
    await recordAudit({
      organizationId: endpoint.organizationId,
      actor: { type: "system" },
      action: AUDIT.webhookEndpointDisabled,
      target: { type: "webhook_endpoint", id: endpoint.id },
      metadata: { reason: "too_many_failures" },
    });
  } else {
    await db.update(epTable).set({ consecutiveFailures: failures }).where(eq(epTable.id, endpoint.id));
  }
  return { ok: false, responseStatus };
}

/** Emit an event to all enabled, subscribed endpoints. Safe to call from after(). */
export async function deliverEvent(organizationId: string, type: WebhookEventType, receipt: ApiReceiptRow): Promise<void> {
  try {
    const endpoints = await db
      .select()
      .from(epTable)
      .where(and(eq(epTable.organizationId, organizationId), eq(epTable.enabled, true)));
    const subscribed = endpoints.filter((e) => e.events.includes(type));
    if (subscribed.length === 0) return;

    const event = buildEvent(type, receipt, new Date().toISOString());
    for (const ep of subscribed) {
      const [row] = await db
        .insert(delTable)
        .values({
          id: id("whd"),
          endpointId: ep.id,
          organizationId,
          eventId: event.id,
          eventType: type,
          payload: event,
          status: "pending",
          attempts: 0,
          createdAt: new Date(),
        })
        .returning();
      await attemptDelivery(row, ep);
    }
  } catch (err) {
    console.error("[webhooks] deliverEvent failed", err);
  }
}
