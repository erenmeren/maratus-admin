// lib/device-config.ts
// Pure: derive a stable ETag for a device's display config from its RENDERABLE inputs.
// Presigned URLs rotate every request, so they are deliberately excluded — only the
// stored config + brand tokens + organization name participate, keeping the ETag stable
// until the merchant actually changes branding.

import { createHash } from "node:crypto";

export interface ConfigVersionInput {
  printerScreens: unknown;
  printerLayout: unknown;
  organizationName: string | null;
  brandColor: string | null;
  brandBg: string | null;
  brandFg: string | null;
  brandMuted: string | null;
  qrVisibleSeconds: number;
  screenBrightness: number;
  screenSleepEnabled: boolean;
  screenSleepTimeoutSeconds: number;
  settingsPasswordHash: string | null;
  /** Org/env-stable mqtt transport identity (enabled + broker host:port), or null
   *  when MQTT is off. Included so toggling MQTT or changing brokers invalidates a
   *  device's cached config and pushes/drops the mqtt block. */
  mqttFingerprint: string | null;
}

export function computeConfigVersion(input: ConfigVersionInput): string {
  const canonical = JSON.stringify([
    input.printerScreens ?? null,
    input.printerLayout ?? null,
    input.organizationName ?? null,
    input.brandColor ?? null,
    input.brandBg ?? null,
    input.brandFg ?? null,
    input.brandMuted ?? null,
    input.qrVisibleSeconds,
    input.screenBrightness,
    input.screenSleepEnabled,
    input.screenSleepTimeoutSeconds,
    input.settingsPasswordHash ?? null,
    input.mqttFingerprint ?? null,
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/** True if an incoming If-None-Match header matches `version` (handles quotes + W/ prefix). */
export function etagMatches(ifNoneMatch: string | null | undefined, version: string): boolean {
  if (!ifNoneMatch) return false;
  const cleaned = ifNoneMatch.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  return cleaned === version;
}
