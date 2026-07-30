// lib/mqtt-push.ts
// The only place a config or OTA manifest is put on the wire. Both payloads
// embed short-lived presigned R2 URLs (config images 300s, firmware binary
// 600s), so they are built at publish time and NEVER persisted on the command
// row — a replay minutes later would ship dead URLs.

import { desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  device,
  deviceCommand,
  firmwareRelease,
  store as storeTable,
  tenantSettings,
} from "@/lib/db/schema";
import { getDeviceConfig, type DeviceConfigPayload } from "@/lib/data";
import { id } from "@/lib/ids";
import { resolveEffectivePin } from "@/lib/pin-resolve";
import { presignedGetUrl } from "@/lib/storage";
import { latestFirmwareManifest } from "@/lib/firmware";
import { buildMqttConfigBlock, publishCommand } from "@/lib/mqtt";
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
 * Parse a firmware version string into [major, minor, patch].
 *
 * A trailing `-`/`+` suffix is accepted and ignored, because this fleet's real
 * version strings carry build labels ("0.6.0-m6b" is a milestone build OF
 * 0.6.0, not a semver pre-release of it). Anything else — null, "", "0.18",
 * "abc", "0.18.0garbage" — is unparseable and returns null.
 */
function parseFirmwareVersion(v: string | null): [number, number, number] | null {
  if (!v) return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Should the OTA reconcile push firmware to this device? True only when the
 * device's running version is strictly BEHIND the latest release, compared
 * numerically component-by-component via `parseFirmwareVersion` —
 * deliberately NOT `firmwareUpdateAvailable` (lib/device-status.ts), which
 * answers "does the version string differ from latest" with plain `!==`.
 *
 * That distinction is the whole point: `firmwareUpdateAvailable` is correct
 * for its four UI-badge callers ("this device isn't running what's
 * published, go look") but wrong for a push decision, because "differs" is
 * true both when the device is behind AND when it is ahead. A device running
 * 0.18.0 while the latest published release is 0.17.1 (development build,
 * or a release rollback) reads as "differs" and got OTA'd backwards to
 * 0.17.1 in production — this helper exists to make that case impossible:
 * ahead returns false, equal returns false, only strictly-behind returns true.
 *
 * A string comparison would also get the ordering itself backwards ("0.9.0"
 * sorts after "0.18.0" lexicographically), which is why this reuses the
 * numeric parser rather than comparing the raw strings.
 *
 * Null, empty, or unparseable on either side returns false: an unknown
 * version must never trigger a push. Guessing "behind" would flash firmware
 * onto a device based on a string we couldn't even parse.
 */
export function isFirmwareBehindLatest(
  deviceVersion: string | null,
  latestVersion: string | null,
): boolean {
  const dv = parseFirmwareVersion(deviceVersion);
  const lv = parseFirmwareVersion(latestVersion);
  if (!dv || !lv) return false;
  for (let i = 0; i < 3; i++) {
    if (dv[i] !== lv[i]) return dv[i] < lv[i];
  }
  return false;
}

/** What a pushed config carries: exactly the GET /api/device/config body,
 *  including its `mqtt` block. */
export type PushedDeviceConfig = DeviceConfigPayload & {
  mqtt?: NonNullable<Awaited<ReturnType<typeof buildMqttConfigBlock>>>;
};

/**
 * Build the payload the device used to fetch over GET /api/device/config:
 * effective pin resolved server-side (device > store > tenant), images presigned
 * fresh, and the same `mqtt` block the HTTP route appends. Returns null when the
 * org has no resolvable config.
 */
export async function resolveDeviceConfigPayload(
  dev: PushTarget,
): Promise<PushedDeviceConfig | null> {
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
  if (!payload) return null;
  // The mqtt block must be present, byte-for-byte like the HTTP route's shape.
  // cfg_parse.c memsets the whole config struct and derives cfg->mqtt.enabled
  // from this block's PRESENCE, so a pushed config without it would make the
  // first Phase-B device zero its broker settings and stop the very transport
  // the config arrived on. It is also the only place a device learns its own
  // deviceId (= clientId = username) — GET /api/device/claim returns just the
  // device key — so a freshly claimed device could never learn it once the HTTP
  // config route is deleted.
  const mqtt = await buildMqttConfigBlock(dev.id);
  return { ...payload, ...(mqtt ? { mqtt } : {}) };
}

/**
 * Publish a config-changed command on the device's cmd topic, always carrying
 * the full config. False when disabled or on failure.
 *
 * Firmware below 0.18.0 cannot reassemble the fragmented ~5.3KB message and has
 * no HTTP route to fall back on — unsupported after Phase C, deliberately.
 */
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

export type FirmwareReleaseRow = typeof firmwareRelease.$inferSelect;

/** The newest published release, or null when nothing has been published. */
export async function latestFirmwareRelease(): Promise<FirmwareReleaseRow | null> {
  const [rel] = await db
    .select()
    .from(firmwareRelease)
    .orderBy(desc(firmwareRelease.createdAt))
    .limit(1);
  return rel ?? null;
}

/** Publish the latest firmware manifest (fresh presigned binary URL). False when
 *  nothing is published, MQTT is disabled, or the publish failed. Callers that
 *  already read the release row (the heartbeat OTA reconcile compares its
 *  version) pass it in rather than re-querying the same one-row table. */
export async function publishOtaCommand(
  deviceId: string,
  commandId: string,
  release?: FirmwareReleaseRow | null,
): Promise<boolean> {
  const rel = release === undefined ? await latestFirmwareRelease() : release;
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
 * Hand every claimed device the current firmware manifest. Both publishing
 * paths — the CLI script and the /admin/firmware upload action — call this right
 * after their firmwareRelease insert, so the claimed-device filter and the
 * NULL-payload rule live in exactly one place. A device that is offline keeps a
 * pending row and gets the manifest, freshly presigned, on its next heartbeat.
 */
export async function pushFirmwareToFleet(): Promise<{ published: number; queued: number }> {
  const targets = await db
    .select({ id: device.id, organizationId: device.organizationId })
    .from(device)
    .where(isNotNull(device.claimedAt));
  let published = 0;
  for (const t of targets) {
    const commandId = id("cmd");
    await db.insert(deviceCommand).values({
      id: commandId,
      deviceId: t.id,
      organizationId: t.organizationId,
      type: "firmware-update",
      status: "pending",
    });
    if (await publishOtaCommand(t.id, commandId)) published++;
  }
  return { published, queued: targets.length - published };
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
