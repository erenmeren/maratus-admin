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
import { publishCommand } from "@/lib/mqtt";
import type { PinMode } from "@/lib/pin";

/** The device columns the push seam needs. Matches the shape the device row and
 *  the config route already select, so callers can pass a full device row.
 *  `firmwareVersion` is load-bearing: it decides whether this device can receive
 *  a carried config at all (see supportsConfigPush). */
export type PushTarget = {
  id: string;
  organizationId: string;
  storeId: string | null;
  pinMode: PinMode;
  pinnedUrl: string | null;
  firmwareVersion: string | null;
};

/**
 * First firmware version that reassembles fragmented inbound MQTT payloads
 * (plan Task B2). Older firmware sets esp-mqtt's `.buffer.size = 2048` and its
 * MQTT_EVENT_DATA handler parses every fragment in isolation, so a config
 * (5,303 bytes in production) arrives as ~3 truncated slices, each failing
 * cJSON_ParseWithLength — the command is silently dropped, and nothing retries
 * because there is no periodic config poll.
 */
const CONFIG_PUSH_MIN_VERSION: readonly [number, number, number] = [0, 18, 0];

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
 * Can this device receive the config carried in the MQTT message, or does it
 * still need the old `payload: null` nudge plus a GET /api/device/config?
 *
 * A real numeric major.minor.patch comparison against 0.18.0 — deliberately NOT
 * `firmwareUpdateAvailable` (lib/device-status.ts), which answers the unrelated
 * "differs from latest" question.
 *
 * Unknown or unparseable versions return false: assuming a device is OLD merely
 * keeps it on the HTTP config route that Phase A leaves in place, whereas
 * assuming it is NEW silently drops every config change until it reboots.
 *
 * `0.18.0-rc1` returns TRUE. Judgment call: strict semver precedence would rank
 * a pre-release below 0.18.0, but this repo's suffixes are build labels on a
 * numeric version, and an RC cut from the 0.18.0 line exists precisely to
 * HIL-test reassembly — gating it to the nudge path would make the release
 * candidate unable to exercise the feature it is a candidate for. The downside
 * if an RC predates reassembly is one dropped config on a bench device under
 * observation, not a silent production failure.
 */
export function supportsConfigPush(firmwareVersion: string | null): boolean {
  const v = parseFirmwareVersion(firmwareVersion);
  if (!v) return false;
  const [major, minor, patch] = v;
  const [minMajor, minMinor, minPatch] = CONFIG_PUSH_MIN_VERSION;
  if (major !== minMajor) return major > minMajor;
  if (minor !== minMinor) return minor > minMinor;
  return patch >= minPatch;
}

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

/**
 * Publish a config-changed command on the device's cmd topic. False when
 * disabled or on failure.
 *
 * Firmware that can reassemble fragments gets the config carried in the message;
 * everything else gets the pre-Phase-A `payload: null` nudge and fetches over
 * GET /api/device/config, which Phase A deliberately leaves live. Skipping the
 * build also spares the org's presign round for a device that could not use it.
 */
export async function publishConfigCommand(dev: PushTarget, commandId: string): Promise<boolean> {
  if (!supportsConfigPush(dev.firmwareVersion)) {
    return publishCommand(dev.id, {
      commandId,
      type: "config-changed",
      action: null,
      payload: null,
    });
  }
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
