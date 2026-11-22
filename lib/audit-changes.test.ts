import { describe, expect, it } from "vitest";
import { brandingChanges, deviceSettingsChanges, type BrandingSnapshot } from "./audit-changes";
import { normalizePrinterConfig, type PrinterConfig } from "./printer-layout";
import { DEVICE_SETTINGS_DEFAULTS } from "./device-settings";

const config = (): PrinterConfig => normalizePrinterConfig(null);
const snap = (over: Partial<BrandingSnapshot> = {}): BrandingSnapshot => ({
  brandColor: "#B4541F",
  brandBg: null,
  brandFg: null,
  brandMuted: null,
  printerConfig: config(),
  ...over,
});

describe("brandingChanges", () => {
  it("identical input → []", () => {
    expect(brandingChanges(snap(), snap())).toEqual([]);
  });

  it("first save → Initial branding", () => {
    expect(brandingChanges(null, snap())).toEqual(["Initial branding"]);
  });

  it.each(["brandColor", "brandBg", "brandFg", "brandMuted"] as const)("%s alone → Theme colors", (k) => {
    expect(brandingChanges(snap(), snap({ [k]: "#123456" }))).toEqual(["Theme colors"]);
  });

  it("a qr* field alone → QR style", () => {
    const after = config();
    after.qrFg = "#ff0000";
    expect(brandingChanges(snap(), snap({ printerConfig: after }))).toEqual(["QR style"]);
  });

  it.each([
    ["clockTimezone", "Europe/Istanbul"],
    ["clock24h", !config().clock24h],
    ["wifiLevel", 1],
    ["qrTimeoutSeconds", 99],
  ] as const)("%s alone → Clock & status", (k, v) => {
    const after = { ...config(), [k]: v } as PrinterConfig;
    expect(brandingChanges(snap(), snap({ printerConfig: after }))).toEqual(["Clock & status"]);
  });

  it("two screens changed → both, in PRINTER_SCREENS order", () => {
    const after = config();
    after.screens.pinned.objects = [];
    after.screens.idle.objects = [];
    expect(brandingChanges(snap(), snap({ printerConfig: after }))).toEqual([
      "Idle / ready screen",
      "Pinned screen",
    ]);
  });

  it("no printer config submitted → only colors compared", () => {
    expect(brandingChanges(snap(), snap({ printerConfig: null }))).toEqual([]);
  });

  it("never leaks hex colors or image urls", () => {
    const after = config();
    after.qrFg = "#abcdef";
    after.screens.idle.objects = [
      { id: "i", type: "image", x: 0, y: 0, w: 0.5, h: 0.5, visible: true, z: 1, image: { url: "https://x.test/a.png" } },
    ];
    const out = brandingChanges(snap(), snap({ brandColor: "#abcdef", printerConfig: after })).join(" ");
    expect(out).not.toMatch(/#|https?:|\.png/);
  });
});

describe("deviceSettingsChanges", () => {
  const before = { ...DEVICE_SETTINGS_DEFAULTS, hasPin: false };

  it("identical input → []", () => {
    expect(deviceSettingsChanges(before, DEVICE_SETTINGS_DEFAULTS, "unchanged")).toEqual([]);
  });

  it.each([
    [{ qrVisibleSeconds: 30 }, "QR duration"],
    [{ screenBrightness: 50 }, "Brightness"],
    [{ screenSleepEnabled: true }, "Screen sleep"],
    [{ screenSleepTimeoutSeconds: 600 }, "Screen sleep"],
  ] as const)("%o alone → %s", (over, name) => {
    expect(deviceSettingsChanges(before, { ...DEVICE_SETTINGS_DEFAULTS, ...over }, "unchanged")).toEqual([name]);
  });

  it.each(["set", "cleared"] as const)("pin %s → Settings PIN", (pin) => {
    expect(deviceSettingsChanges(before, DEVICE_SETTINGS_DEFAULTS, pin)).toEqual(["Settings PIN"]);
  });

  it("first save compares against defaults", () => {
    expect(deviceSettingsChanges(null, { ...DEVICE_SETTINGS_DEFAULTS, screenBrightness: 40 }, "unchanged")).toEqual([
      "Brightness",
    ]);
  });

  it("never contains PIN digits", () => {
    const out = deviceSettingsChanges(before, DEVICE_SETTINGS_DEFAULTS, "set").join(" ");
    expect(out).not.toMatch(/[0-9]/);
    expect(out).not.toContain("4821");
  });
});
