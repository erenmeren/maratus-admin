import { describe, it, expect } from "vitest";
import {
  normalizeKioskLayout,
  DEFAULT_KIOSK_LAYOUT,
  KIOSK_ELEMENT_IDS,
} from "./kiosk-layout";

describe("normalizeKioskLayout", () => {
  it("returns the default layout for null/garbage", () => {
    expect(normalizeKioskLayout(null)).toEqual(DEFAULT_KIOSK_LAYOUT);
    expect(normalizeKioskLayout("nope")).toEqual(DEFAULT_KIOSK_LAYOUT);
    expect(normalizeKioskLayout({})).toEqual(DEFAULT_KIOSK_LAYOUT);
  });

  it("always returns exactly the 5 known elements, once each", () => {
    const l = normalizeKioskLayout({ elements: [{ id: "logo", x: 0.1 }, { id: "bogus" }] });
    expect(l.elements.map((e) => e.id).sort()).toEqual([...KIOSK_ELEMENT_IDS].sort());
  });

  it("clamps coordinates to [0,1] and scale to [0.5,2]", () => {
    const l = normalizeKioskLayout({
      elements: [{ id: "logo", x: -5, y: 9, scale: 99 }],
    });
    const logo = l.elements.find((e) => e.id === "logo")!;
    expect(logo.x).toBe(0);
    expect(logo.y).toBe(1);
    expect(logo.scale).toBe(2);
  });

  it("preserves valid positions + visibility", () => {
    const l = normalizeKioskLayout({
      elements: [{ id: "clock", x: 0.3, y: 0.7, scale: 1.4, visible: false }],
    });
    const clock = l.elements.find((e) => e.id === "clock")!;
    expect(clock).toMatchObject({ x: 0.3, y: 0.7, scale: 1.4, visible: false });
  });

  it("falls back to UTC for an unknown timezone and clamps wifi 0..4", () => {
    expect(normalizeKioskLayout({ clockTimezone: "Mars/Phobos" }).clockTimezone).toBe("UTC");
    expect(normalizeKioskLayout({ clockTimezone: "America/New_York" }).clockTimezone).toBe("America/New_York");
    expect(normalizeKioskLayout({ wifiLevel: 9 }).wifiLevel).toBe(4);
    expect(normalizeKioskLayout({ wifiLevel: -3 }).wifiLevel).toBe(0);
  });
});
