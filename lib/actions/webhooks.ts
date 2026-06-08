"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookEndpoint as epTable, webhookDelivery as delTable } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { id, generateWebhookSecret } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";
import { isAllowedWebhookUrl } from "@/lib/webhooks/url-guard";
import { isWebhookEventType } from "@/lib/webhooks/events";
import { attemptDelivery } from "@/lib/webhooks/deliver";

function canManage(role: string | undefined): boolean {
  return !!role && ["owner", "admin"].includes(role);
}

export interface CreateWebhookResult {
  ok: boolean;
  error?: string;
  secret?: string; // shown ONCE
}

export async function createWebhookEndpoint(formData: FormData): Promise<CreateWebhookResult> {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!canManage(role)) return { ok: false, error: "You don't have permission to manage webhooks." };

  const url = String(formData.get("url") ?? "").trim();
  const guard = isAllowedWebhookUrl(url);
  if (!guard.ok) return { ok: false, error: `Invalid URL (${guard.reason}). Use a public https URL.` };

  const events = formData.getAll("events").map(String).filter(isWebhookEventType);
  if (events.length === 0) return { ok: false, error: "Select at least one event." };

  const secret = generateWebhookSecret();
  const endpointId = id("whe");
  await db.insert(epTable).values({
    id: endpointId,
    organizationId,
    url,
    secret,
    events,
    createdByUserId: ctx.user.id,
    createdAt: new Date(),
  });

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.webhookEndpointCreated,
    target: { type: "webhook_endpoint", id: endpointId },
    metadata: { url, events },
  });

  revalidatePath("/tenant/webhooks");
  return { ok: true, secret };
}

export interface WebhookActionResult {
  ok: boolean;
  error?: string;
}

export async function deleteWebhookEndpoint(endpointId: string): Promise<WebhookActionResult> {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!canManage(role)) return { ok: false, error: "You don't have permission to manage webhooks." };

  const [existing] = await db
    .select({ id: epTable.id })
    .from(epTable)
    .where(and(eq(epTable.id, endpointId), eq(epTable.organizationId, organizationId)))
    .limit(1);
  if (!existing) return { ok: false, error: "Endpoint not found." };

  await db.delete(epTable).where(and(eq(epTable.id, endpointId), eq(epTable.organizationId, organizationId)));

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.webhookEndpointDeleted,
    target: { type: "webhook_endpoint", id: endpointId },
  });

  revalidatePath("/tenant/webhooks");
  return { ok: true };
}

export async function setWebhookEndpointEnabled(endpointId: string, enabled: boolean): Promise<WebhookActionResult> {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!canManage(role)) return { ok: false, error: "You don't have permission to manage webhooks." };

  const [existing] = await db
    .select({ id: epTable.id })
    .from(epTable)
    .where(and(eq(epTable.id, endpointId), eq(epTable.organizationId, organizationId)))
    .limit(1);
  if (!existing) return { ok: false, error: "Endpoint not found." };

  await db
    .update(epTable)
    .set(enabled ? { enabled: true, consecutiveFailures: 0, disabledReason: null } : { enabled: false })
    .where(and(eq(epTable.id, endpointId), eq(epTable.organizationId, organizationId)));

  revalidatePath("/tenant/webhooks");
  return { ok: true };
}

export interface TestEventResult {
  ok: boolean;
  error?: string;
  responseStatus?: number | null;
}

export async function sendTestEvent(endpointId: string): Promise<TestEventResult> {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!canManage(role)) return { ok: false, error: "You don't have permission to manage webhooks." };

  const [endpoint] = await db
    .select()
    .from(epTable)
    .where(and(eq(epTable.id, endpointId), eq(epTable.organizationId, organizationId)))
    .limit(1);
  if (!endpoint) return { ok: false, error: "Endpoint not found." };

  const now = new Date();
  const testEvent = {
    id: `evt_test_${id("x").slice(2)}`,
    type: "receipt.created",
    created: now.toISOString(),
    data: {
      id: "rcp_test", token: "test_token", status: "ready",
      store_id: null, device_id: "dev_test", byte_size: 0,
      created_at: now.toISOString(),
    },
  };
  const [row] = await db
    .insert(delTable)
    .values({
      id: id("whd"),
      endpointId: endpoint.id,
      organizationId,
      eventId: testEvent.id,
      eventType: "receipt.created",
      payload: testEvent,
      status: "pending",
      attempts: 0,
      createdAt: now,
    })
    .returning();

  const res = await attemptDelivery(row, endpoint, { countTowardDisable: false });
  return { ok: res.ok, responseStatus: res.responseStatus };
}
