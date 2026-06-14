// lib/device-config.test.ts
import { describe, it, expect } from "vitest";
import { computeConfigVersion, etagMatches, type ConfigVersionInput } from "./device-config";

const base: ConfigVersionInput = {
  printerScreens: { version: 3, foo: "bar" },
  printerLayout: null,
  logoUrl: "receipts/org/logo.png",
  brandColor: "#10A765",
  brandBg: null,
  brandFg: null,
  brandMuted: null,
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
    expect(computeConfigVersion({ ...base, logoUrl: null })).not.toBe(v);
    expect(computeConfigVersion({ ...base, printerScreens: { version: 3, foo: "baz" } })).not.toBe(v);
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
