// lib/mqtt-push.ts
// The only place a config or OTA manifest is put on the wire. Both payloads
// embed short-lived presigned R2 URLs (config images 300s, firmware binary
// 600s), so they are built at publish time and NEVER persisted on the command
// row — a replay minutes later would ship dead URLs.

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { firmwareRelease, store as storeTable, tenantSettings } from "@/lib/db/schema";
import { getDeviceConfig, type DeviceConfigPayload } from "@/lib/data";
import { resolveEffectivePin } from "@/lib/pin-resolve";
import { presignedGetUrl } from "@/lib/storage";
import { latestFirmwareManifest } from "@/lib/firmware";
import { publishCommand } from "@/lib/mqtt";
import type { PinMode } from "@/lib/pin";

/** The device columns the push seam needs. Matches the shape the device row and
 *  the config route already select, so callers can pass a full device row. */
export type PushTarget = {
  id: string;
  organizationId: string;
  storeId: string | null;
  pinMode: PinMode;
  pinnedUrl: string | null;
};

/**
 * Build the payload the device used to fetch over GET /api/device/config:
 * effective pin resolved server-side (device > store > tenant), images presigned
 * fresh. Returns null when the org has no resolvable config.
 */
export async function resolveDeviceConfigPayload(
  dev: PushTarget,
): Promise<DeviceConfigPayload | null> {
  const [storeRow, [ts]] = await Promise.all([
    dev.storeId
      ? db
          .select({ pinMode: storeTable.pinMode, pinnedUrl: storeTable.pinnedUrl })
          .from(storeTable)
          .where(eq(storeTable.id, dev.storeId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select({ pinnedUrl: tenantSettings.pinnedUrl })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, dev.organizationId)),
  ]);
  const effective = resolveEffectivePin({
    device: { pinMode: dev.pinMode, pinnedUrl: dev.pinnedUrl },
    store: storeRow,
    tenant: { pinnedUrl: ts?.pinnedUrl ?? null },
  });
  // No If-None-Match: a push always carries the full config. 304 semantics
  // belonged to the HTTP route and have no meaning on a one-way publish.
  const { payload } = await getDeviceConfig(dev.organizationId, null, { url: effective.url });
  return payload;
}

/** Publish the device's full config on its cmd topic. False when disabled or on failure. */
export async function publishConfigCommand(dev: PushTarget, commandId: string): Promise<boolean> {
  const payload = await resolveDeviceConfigPayload(dev);
  if (!payload) return false;
  return publishCommand(dev.id, {
    commandId,
    type: "config-changed",
    action: null,
    payload,
  });
}

/** Publish the latest firmware manifest (fresh presigned binary URL). False when
 *  nothing is published, MQTT is disabled, or the publish failed. */
export async function publishOtaCommand(deviceId: string, commandId: string): Promise<boolean> {
  const [rel] = await db
    .select()
    .from(firmwareRelease)
    .orderBy(desc(firmwareRelease.createdAt))
    .limit(1);
  if (!rel) return false;
  const url = await presignedGetUrl(rel.r2Key, 600);
  return publishCommand(deviceId, {
    commandId,
    type: "firmware-update",
    action: null,
    payload: latestFirmwareManifest(rel, url),
  });
}

/**
 * How the heartbeat republish should resend a stale pending command. Payload-
 * carrying types must be rebuilt (their presigned URLs expire); everything else
 * is replayed from the stored row. Unknown types replay rather than drop, so a
 * future command type is delivered late instead of never.
 */
export function republishKindFor(type: string): "config" | "ota" | "replay" {
  if (type === "config-changed") return "config";
  if (type === "firmware-update") return "ota";
  return "replay";
}
