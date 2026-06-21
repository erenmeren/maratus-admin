// Pure helpers for org-wide device policy settings: clamp/normalize numeric
// fields and hash the on-device Settings PIN. No IO — host-testable.

import { createHash, randomBytes } from "node:crypto";

export interface DeviceSettings {
  qrVisibleSeconds: number;
  screenBrightness: number;
  screenSleepEnabled: boolean;
  screenSleepTimeoutSeconds: number;
}

export const DEVICE_SETTINGS_DEFAULTS: DeviceSettings = {
  qrVisibleSeconds: 60,
  screenBrightness: 100,
  screenSleepEnabled: false,
  screenSleepTimeoutSeconds: 300,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export function normalizeDeviceSettings(input: unknown): DeviceSettings {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    qrVisibleSeconds: clamp(Math.round(num(r.qrVisibleSeconds, 60)), 15, 180),
    screenBrightness: clamp(Math.round(num(r.screenBrightness, 100)), 10, 100),
    screenSleepEnabled: typeof r.screenSleepEnabled === "boolean" ? r.screenSleepEnabled : false,
    screenSleepTimeoutSeconds: clamp(Math.round(num(r.screenSleepTimeoutSeconds, 300)), 30, 3600),
  };
}

export function hashSettingsPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return { hash, salt };
}

export function verifySettingsPassword(password: string, hash: string, salt: string): boolean {
  return createHash("sha256").update(salt + password).digest("hex") === hash;
}
