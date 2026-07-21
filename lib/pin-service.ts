// lib/pin-service.ts
// Shared pinned-QR mutation core. The public API route and the tenant server
// action both call these, so the money rule (1 credit per actual change, clear
// is free, same-URL is a no-op) and the delivery rule (deviceCommand row +
// best-effort MQTT publish) exist in exactly one place.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand } from "@/lib/db/schema";
import { spendCredit } from "@/lib/credits";
import { id } from "@/lib/ids";
import { publishCommand } from "@/lib/mqtt";
import { recordAudit, AUDIT, type AuditActor } from "@/lib/audit";

export const PIN_COST = 1;

export type SetPinResult =
  | { ok: true; noop: boolean; pinnedAt: Date }
  | { ok: false; reason: "insufficient_credits" };

async function enqueuePinCommand(a: {
  organizationId: string;
  deviceId: string;
  url: string | null;
}): Promise<string> {
  const commandId = id("cmd");
  await db.insert(deviceCommand).values({
    id: commandId,
    deviceId: a.deviceId,
    organizationId: a.organizationId,
    type: "pin",
    status: "pending",
    payload: { url: a.url },
    // No expiresAt: unlike triggers there is no hold to reclaim, and an
    // offline device must still receive the pin when it reconnects (the
    // config path also covers reboot recovery).
  });
  await publishCommand(a.deviceId, { commandId, type: "pin", action: null, payload: { url: a.url } });
  return commandId;
}

export async function setDevicePin(a: {
  organizationId: string;
  device: { id: string; pinnedUrl: string | null; pinnedAt: Date | null };
  url: string;
  actor: AuditActor;
  via: "api" | "ui";
  createdByUserId?: string | null;
}): Promise<SetPinResult> {
  // Same URL already pinned → no credit, no command, no audit.
  if (a.device.pinnedUrl === a.url) {
    return { ok: true, noop: true, pinnedAt: a.device.pinnedAt ?? new Date() };
  }
  // The spend and the device update below are separate statements (neon-http
  // has no interactive transactions). Charge-first so a crash between them
  // fails safe for the business: charged, pin unapplied, next PUT of the same
  // URL would no-op — an accepted, unlikely loss, matching the codebase's
  // existing non-transactional style.
  const spent = await spendCredit({
    organizationId: a.organizationId,
    deviceId: a.device.id,
    action: "pin_change",
    cost: PIN_COST,
    createdByUserId: a.createdByUserId ?? null,
  });
  if (!spent.ok) return { ok: false, reason: "insufficient_credits" };

  const pinnedAt = new Date();
  await db
    .update(deviceTable)
    .set({ pinnedUrl: a.url, pinnedAt })
    .where(eq(deviceTable.id, a.device.id));
  await enqueuePinCommand({ organizationId: a.organizationId, deviceId: a.device.id, url: a.url });
  await recordAudit({
    organizationId: a.organizationId,
    actor: a.actor,
    action: AUDIT.devicePinSet,
    target: { type: "device", id: a.device.id },
    metadata: { url: a.url, via: a.via },
  });
  return { ok: true, noop: false, pinnedAt };
}

export async function clearDevicePin(a: {
  organizationId: string;
  device: { id: string; pinnedUrl: string | null };
  actor: AuditActor;
  via: "api" | "ui";
}): Promise<void> {
  if (a.device.pinnedUrl === null) return; // idempotent
  await db
    .update(deviceTable)
    .set({ pinnedUrl: null, pinnedAt: null })
    .where(eq(deviceTable.id, a.device.id));
  await enqueuePinCommand({ organizationId: a.organizationId, deviceId: a.device.id, url: null });
  await recordAudit({
    organizationId: a.organizationId,
    actor: a.actor,
    action: AUDIT.devicePinCleared,
    target: { type: "device", id: a.device.id },
    metadata: { via: a.via },
  });
}
