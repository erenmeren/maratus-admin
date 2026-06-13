import { describe, it, expect } from "vitest";
import {
  normalizeKioskLayout,
  createTextObject,
  objectLabel,
  defaultLayout,
  DEFAULT_KIOSK_LAYOUT,
  FIXED_TYPES,
  FONT_MIN,
  FONT_MAX,
  MAX_CUSTOM,
} from "./kiosk-layout";

describe("normalizeKioskLayout", () => {
  it("returns the default layout for null/garbage/v1", () => {
    expect(normalizeKioskLayout(null)).toEqual(DEFAULT_KIOSK_LAYOUT);
    expect(normalizeKioskLayout("nope")).toEqual(DEFAULT_KIOSK_LAYOUT);
    expect(normalizeKioskLayout({})).toEqual(DEFAULT_KIOSK_LAYOUT);
    // a v1 layout (elements + sx/sy, no version:2) → reset to default
    expect(normalizeKioskLayout({ elements: [{ id: "logo", x: 0.5, y: 0.4, sx: 1, sy: 1 }] })).toEqual(DEFAULT_KIOSK_LAYOUT);
  });

  it("keeps a valid v2 layout and round-trips it", () => {
    const l = defaultLayout();
    expect(normalizeKioskLayout(l)).toEqual(l);
  });

  it("ensures exactly one of each fixed widget", () => {
    const l = normalizeKioskLayout({ version: 2, objects: [{ type: "logo", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] });
    for (const t of FIXED_TYPES) {
      expect(l.objects.filter((o) => o.type === t)).toHaveLength(1);
    }
  });

  it("clamps box coords, sizes, and font", () => {
    const l = normalizeKioskLayout({
      version: 2,
      objects: [{ type: "text", text: "Hi", x: -1, y: 9, w: 0, h: 5, fontSize: 9999 }],
    });
    const t = l.objects.find((o) => o.type === "text")!;
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.y).toBeLessThanOrEqual(1);
    expect(t.w).toBeGreaterThan(0);
    expect(t.w).toBeLessThanOrEqual(1);
    expect(t.fontSize).toBe(FONT_MAX);
  });

  it("drops text-less / unknown-type objects and caps text objects", () => {
    const objs = [
      { type: "text" }, // no text → dropped
      { type: "bogus", x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, // unknown → dropped
      ...Array.from({ length: 30 }, (_, i) => ({ type: "text", text: `t${i}` })),
    ];
    const l = normalizeKioskLayout({ version: 2, objects: objs });
    expect(l.objects.filter((o) => o.type === "text")).toHaveLength(MAX_CUSTOM);
  });

  it("trims long text to 80 chars", () => {
    const l = normalizeKioskLayout({ version: 2, objects: [{ type: "text", text: "x".repeat(200) }] });
    expect(l.objects.find((o) => o.type === "text")!.text!.length).toBe(80);
  });

  it("validates timezone and clamps wifi", () => {
    expect(normalizeKioskLayout({ version: 2, objects: [], clockTimezone: "Mars/Phobos" }).clockTimezone).toBe("UTC");
    expect(normalizeKioskLayout({ version: 2, objects: [], wifiLevel: 9 }).wifiLevel).toBe(4);
  });
});

describe("createTextObject", () => {
  it("makes a centered text object with a unique text-* id", () => {
    const a = createTextObject("Hi", 5);
    expect(a.type).toBe("text");
    expect(a.id).toMatch(/^text-/);
    expect(a).toMatchObject({ text: "Hi", visible: true, z: 5, align: "center" });
    expect(createTextObject("Hi", 5).id).not.toBe(a.id);
  });
});

describe("objectLabel", () => {
  it("uses the type label for fixed widgets and truncated text for text", () => {
    const l = defaultLayout();
    expect(objectLabel(l.objects.find((o) => o.type === "clock")!)).toBe("Clock");
    expect(objectLabel(createTextObject("A very long custom label here", 0))).toContain("A very long");
  });
});

// ─── Task 1: v3 types, seededScreen, createIconObject ────────────────────────

import {
  KIOSK_SCREENS,
  ICON_PRESETS,
  DEFAULT_ICON_PRESET,
  seededScreen,
  createIconObject,
  type KioskObject,
} from "./kiosk-layout";

// A box is valid if it sits on the canvas and meets the min size.
function boxesValid(objects: KioskObject[]): boolean {
  return objects.every(
    (o) =>
      o.x >= 0 && o.y >= 0 && o.w > 0 && o.h > 0 &&
      o.x + o.w <= 1.0001 && o.y + o.h <= 1.0001 &&
      typeof o.z === "number" && typeof o.visible === "boolean",
  );
}

describe("seededScreen", () => {
  it("produces a non-empty, on-canvas layout for every screen", () => {
    for (const screen of KIOSK_SCREENS) {
      const { objects } = seededScreen(screen);
      expect(objects.length).toBeGreaterThan(0);
      expect(boxesValid(objects)).toBe(true);
      // ids are unique within a screen
      expect(new Set(objects.map((o) => o.id)).size).toBe(objects.length);
    }
  });

  it("seeds the sent screen with an accent circle check icon", () => {
    const sent = seededScreen("sent").objects.find((o) => o.type === "icon");
    expect(sent).toBeDefined();
    expect(sent!.icon).toMatchObject({ source: "preset", preset: "check", circle: true, tint: "accent" });
  });

  it("seeds the error screen with a warn wifi-off icon", () => {
    const err = seededScreen("error").objects.find((o) => o.type === "icon");
    expect(err!.icon).toMatchObject({ source: "preset", preset: "wifi-off", tint: "warn" });
  });

  it("seeds idle with the existing logo/clock/wifi widgets and two text objects", () => {
    const idle = seededScreen("idle").objects;
    expect(idle.some((o) => o.type === "logo")).toBe(true);
    expect(idle.some((o) => o.type === "clock")).toBe(true);
    expect(idle.some((o) => o.type === "wifi")).toBe(true);
    expect(idle.filter((o) => o.type === "text").length).toBe(2);
  });
});

describe("createIconObject", () => {
  it("creates a centered preset icon on top", () => {
    const o = createIconObject(5);
    expect(o.type).toBe("icon");
    expect(o.z).toBe(5);
    expect(o.icon).toMatchObject({ source: "preset", preset: DEFAULT_ICON_PRESET, tint: "accent" });
    expect(o.id.startsWith("icon-")).toBe(true);
  });
});

describe("allowlist", () => {
  it("DEFAULT_ICON_PRESET is in ICON_PRESETS", () => {
    expect((ICON_PRESETS as readonly string[]).includes(DEFAULT_ICON_PRESET)).toBe(true);
  });
});
