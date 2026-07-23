// lib/device-config.test.ts
import { describe, it, expect } from "vitest";
import { computeConfigVersion, etagMatches, type ConfigVersionInput } from "./device-config";

const base: ConfigVersionInput = {
  printerScreens: { version: 3, foo: "bar" },
  printerLayout: null,
  organizationName: "Acme",
  brandColor: "#10A765",
  brandBg: null,
  brandFg: null,
  brandMuted: null,
  qrVisibleSeconds: 60,
  screenBrightness: 100,
  screenSleepEnabled: false,
  screenSleepTimeoutSeconds: 300,
  settingsPasswordHash: null,
  mqttFingerprint: null,
  pinnedUrl: null,
};

describe("computeConfigVersion", () => {
  it("is a stable hex string for identical input", () => {
    const a = computeConfigVersion(base);
    const b = computeConfigVersion({ ...base });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]+$/);
  });

  it("changes when any renderable input changes", () => {
    const v = computeConfigVersion(base);
    expect(computeConfigVersion({ ...base, brandColor: "#000000" })).not.toBe(v);
    expect(computeConfigVersion({ ...base, organizationName: "Other" })).not.toBe(v);
    expect(computeConfigVersion({ ...base, printerScreens: { version: 3, foo: "baz" } })).not.toBe(v);
  });

  it("organization name participates in the version (logoUrl no longer does)", () => {
    const base2 = {
      printerScreens: null, printerLayout: null, brandColor: null, brandBg: null,
      brandFg: null, brandMuted: null, qrVisibleSeconds: 60, screenBrightness: 100,
      screenSleepEnabled: false, screenSleepTimeoutSeconds: 300, settingsPasswordHash: null,
      mqttFingerprint: null, pinnedUrl: null,
    };
    const a = computeConfigVersion({ ...base2, organizationName: "Acme" });
    const b = computeConfigVersion({ ...base2, organizationName: "Beta" });
    expect(a).not.toBe(b);
  });
});

describe("computeConfigVersion — device settings", () => {
  it("changes when any device setting changes", () => {
    const v = computeConfigVersion(base);
    expect(computeConfigVersion({ ...base, qrVisibleSeconds: 90 })).not.toBe(v);
    expect(computeConfigVersion({ ...base, screenBrightness: 50 })).not.toBe(v);
    expect(computeConfigVersion({ ...base, screenSleepEnabled: true })).not.toBe(v);
    expect(computeConfigVersion({ ...base, screenSleepTimeoutSeconds: 600 })).not.toBe(v);
    expect(computeConfigVersion({ ...base, settingsPasswordHash: "abc" })).not.toBe(v);
  });
});

describe("computeConfigVersion — mqtt transport", () => {
  it("changes when MQTT is toggled or the broker changes", () => {
    const off = computeConfigVersion(base); // mqttFingerprint: null
    const on = computeConfigVersion({ ...base, mqttFingerprint: "broker.example.com:8883" });
    const moved = computeConfigVersion({ ...base, mqttFingerprint: "other.example.com:8883" });
    expect(on).not.toBe(off); // enabling MQTT invalidates a cached config
    expect(moved).not.toBe(on); // changing brokers invalidates it too
  });
});

describe("computeConfigVersion — pinned QR", () => {
  it("changes the version when the pinned QR url changes", () => {
    const unpinned = computeConfigVersion({ ...base, pinnedUrl: null });
    const pinned = computeConfigVersion({ ...base, pinnedUrl: "https://example.com/menu" });
    expect(pinned).not.toEqual(unpinned);
  });
});

describe("computeConfigVersion — QR style", () => {
  // qrShape/qrFg/qrBg live top-level inside printerScreens (no dedicated ETag
  // input) — this pins down that they're covered anyway, since the whole blob
  // participates via the "any renderable input changes" test above.
  it("changes when qrShape, qrFg, or qrBg change within printerScreens", () => {
    const withStyle = (qrShape: string, qrFg: string, qrBg: string) =>
      computeConfigVersion({ ...base, printerScreens: { version: 3, qrShape, qrFg, qrBg } });
    const v = withStyle("rounded", "#111111", "#ffffff");
    expect(withStyle("classic", "#111111", "#ffffff")).not.toBe(v);
    expect(withStyle("rounded", "#222222", "#ffffff")).not.toBe(v);
    expect(withStyle("rounded", "#111111", "#eeeeee")).not.toBe(v);
    expect(withStyle("rounded", "#111111", "#ffffff")).toBe(v); // stable for identical style
  });
});

describe("etagMatches", () => {
  it("matches quoted, weak, and bare forms", () => {
    expect(etagMatches('"abc"', "abc")).toBe(true);
    expect(etagMatches('W/"abc"', "abc")).toBe(true);
    expect(etagMatches("abc", "abc")).toBe(true);
  });
  it("does not match different or missing tags", () => {
    expect(etagMatches('"xyz"', "abc")).toBe(false);
    expect(etagMatches(null, "abc")).toBe(false);
    expect(etagMatches(undefined, "abc")).toBe(false);
  });
});
