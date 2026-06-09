import { describe, it, expect } from "vitest";
import {
  normalizeKioskLayout,
  createTextElement,
  elementLabel,
  DEFAULT_KIOSK_LAYOUT,
  BUILTIN_IDS,
  SCALE_MIN,
  SCALE_MAX,
} from "./kiosk-layout";

describe("normalizeKioskLayout", () => {
  it("returns the default layout for null/garbage", () => {
    expect(normalizeKioskLayout(null)).toEqual(DEFAULT_KIOSK_LAYOUT);
    expect(normalizeKioskLayout("nope")).toEqual(DEFAULT_KIOSK_LAYOUT);
    expect(normalizeKioskLayout({})).toEqual(DEFAULT_KIOSK_LAYOUT);
  });

  it("always includes the 5 built-ins exactly once", () => {
    const l = normalizeKioskLayout({ elements: [{ id: "logo", x: 0.1 }, { id: "bogus" }] });
    const builtins = l.elements.filter((e) => e.kind === "builtin").map((e) => e.builtin).sort();
    expect(builtins).toEqual([...BUILTIN_IDS].sort());
    expect(l.elements.filter((e) => e.kind === "builtin")).toHaveLength(5);
  });

  it("migrates legacy `scale` to sx = sy = scale", () => {
    const l = normalizeKioskLayout({ elements: [{ id: "logo", scale: 1.5 }] });
    const logo = l.elements.find((e) => e.builtin === "logo")!;
    expect(logo.sx).toBe(1.5);
    expect(logo.sy).toBe(1.5);
  });

  it("clamps x,y to [0,1] and sx,sy to [SCALE_MIN, SCALE_MAX]", () => {
    const l = normalizeKioskLayout({ elements: [{ id: "logo", x: -5, y: 9, sx: 99, sy: 0.001 }] });
    const logo = l.elements.find((e) => e.builtin === "logo")!;
    expect(logo.x).toBe(0);
    expect(logo.y).toBe(1);
    expect(logo.sx).toBe(SCALE_MAX);
    expect(logo.sy).toBe(SCALE_MIN);
  });

  it("keeps a valid custom text element and round-trips it", () => {
    const raw = { elements: [{ id: "text-abc", kind: "text", text: "Hello", x: 0.3, y: 0.7, sx: 2, sy: 1 }] };
    const l = normalizeKioskLayout(raw);
    const custom = l.elements.find((e) => e.id === "text-abc")!;
    expect(custom).toMatchObject({ id: "text-abc", kind: "text", text: "Hello", x: 0.3, y: 0.7, sx: 2, sy: 1 });
    // round-trip is stable
    expect(normalizeKioskLayout(l)).toEqual(l);
  });

  it("drops a custom element with no/invalid text and trims long text", () => {
    const l = normalizeKioskLayout({
      elements: [
        { id: "text-bad", kind: "text" },                         // no text → dropped
        { id: "text-long", kind: "text", text: "x".repeat(200) }, // trimmed
      ],
    });
    expect(l.elements.find((e) => e.id === "text-bad")).toBeUndefined();
    expect(l.elements.find((e) => e.id === "text-long")!.text!.length).toBe(80);
  });

  it("caps custom text elements at 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `text-${i}`, kind: "text", text: `t${i}` }));
    const l = normalizeKioskLayout({ elements: many });
    expect(l.elements.filter((e) => e.kind === "text")).toHaveLength(20);
  });

  it("falls back to UTC for an unknown timezone and clamps wifi 0..4", () => {
    expect(normalizeKioskLayout({ clockTimezone: "Mars/Phobos" }).clockTimezone).toBe("UTC");
    expect(normalizeKioskLayout({ clockTimezone: "America/New_York" }).clockTimezone).toBe("America/New_York");
    expect(normalizeKioskLayout({ wifiLevel: 9 }).wifiLevel).toBe(4);
    expect(normalizeKioskLayout({ wifiLevel: -3 }).wifiLevel).toBe(0);
  });
});

describe("createTextElement", () => {
  it("makes a centered text element with a unique text-* id", () => {
    const a = createTextElement("Hi", 5);
    expect(a.kind).toBe("text");
    expect(a.id).toMatch(/^text-/);
    expect(a).toMatchObject({ text: "Hi", x: 0.5, y: 0.5, sx: 1, sy: 1, visible: true, z: 5 });
    expect(createTextElement("Hi", 5).id).not.toBe(a.id);
  });
});

describe("elementLabel", () => {
  it("uses the built-in label or the (truncated) custom text", () => {
    const layout = normalizeKioskLayout({});
    expect(elementLabel(layout.elements.find((e) => e.builtin === "clock")!)).toBe("Clock");
    expect(elementLabel(createTextElement("A very long custom label here", 0))).toContain("A very long");
  });
});
