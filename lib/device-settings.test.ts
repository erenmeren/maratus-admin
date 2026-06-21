import { describe, it, expect } from "vitest";
import {
  normalizeDeviceSettings,
  hashSettingsPassword,
  verifySettingsPassword,
  DEVICE_SETTINGS_DEFAULTS,
} from "./device-settings";

describe("normalizeDeviceSettings", () => {
  it("returns defaults for empty / garbage input", () => {
    expect(normalizeDeviceSettings(undefined)).toEqual(DEVICE_SETTINGS_DEFAULTS);
    expect(normalizeDeviceSettings({})).toEqual(DEVICE_SETTINGS_DEFAULTS);
    expect(normalizeDeviceSettings("nope")).toEqual(DEVICE_SETTINGS_DEFAULTS);
  });

  it("clamps each field to its authoritative range", () => {
    expect(normalizeDeviceSettings({ qrVisibleSeconds: 5 }).qrVisibleSeconds).toBe(15);
    expect(normalizeDeviceSettings({ qrVisibleSeconds: 999 }).qrVisibleSeconds).toBe(180);
    expect(normalizeDeviceSettings({ screenBrightness: 0 }).screenBrightness).toBe(10);
    expect(normalizeDeviceSettings({ screenBrightness: 250 }).screenBrightness).toBe(100);
    expect(normalizeDeviceSettings({ screenSleepTimeoutSeconds: 1 }).screenSleepTimeoutSeconds).toBe(30);
    expect(normalizeDeviceSettings({ screenSleepTimeoutSeconds: 99999 }).screenSleepTimeoutSeconds).toBe(3600);
  });

  it("rounds floats and coerces the boolean", () => {
    const r = normalizeDeviceSettings({ screenBrightness: 55.7, screenSleepEnabled: true });
    expect(r.screenBrightness).toBe(56);
    expect(r.screenSleepEnabled).toBe(true);
  });
});

describe("settings password hashing", () => {
  it("produces a different salt each call but verifies correctly", () => {
    const a = hashSettingsPassword("1234");
    const b = hashSettingsPassword("1234");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(verifySettingsPassword("1234", a.hash, a.salt)).toBe(true);
    expect(verifySettingsPassword("0000", a.hash, a.salt)).toBe(false);
  });
});
