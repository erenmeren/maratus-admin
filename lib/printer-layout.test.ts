import { describe, it, expect } from "vitest";
import {
  normalizePrinterLayout,
  createTextObject,
  objectLabel,
  defaultLayout,
  DEFAULT_PRINTER_LAYOUT,
  FIXED_TYPES,
  FONT_MAX,
  MAX_CUSTOM,
} from "./printer-layout";

describe("normalizePrinterLayout", () => {
  it("returns the default layout for null/garbage/v1", () => {
    expect(normalizePrinterLayout(null)).toEqual(DEFAULT_PRINTER_LAYOUT);
    expect(normalizePrinterLayout("nope")).toEqual(DEFAULT_PRINTER_LAYOUT);
    expect(normalizePrinterLayout({})).toEqual(DEFAULT_PRINTER_LAYOUT);
    // a v1 layout (elements + sx/sy, no version:2) → reset to default
    expect(normalizePrinterLayout({ elements: [{ id: "logo", x: 0.5, y: 0.4, sx: 1, sy: 1 }] })).toEqual(DEFAULT_PRINTER_LAYOUT);
  });

  it("keeps a valid v2 layout and round-trips it", () => {
    const l = defaultLayout();
    expect(normalizePrinterLayout(l)).toEqual(l);
  });

  it("ensures exactly one of each fixed widget", () => {
    const l = normalizePrinterLayout({ version: 2, objects: [{ type: "logo", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] });
    for (const t of FIXED_TYPES) {
      expect(l.objects.filter((o) => o.type === t)).toHaveLength(1);
    }
  });

  it("clamps box coords, sizes, and font", () => {
    const l = normalizePrinterLayout({
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
    const l = normalizePrinterLayout({ version: 2, objects: objs });
    expect(l.objects.filter((o) => o.type === "text")).toHaveLength(MAX_CUSTOM);
  });

  it("trims long text to 80 chars", () => {
    const l = normalizePrinterLayout({ version: 2, objects: [{ type: "text", text: "x".repeat(200) }] });
    expect(l.objects.find((o) => o.type === "text")!.text!.length).toBe(80);
  });

  it("validates timezone and clamps wifi", () => {
    expect(normalizePrinterLayout({ version: 2, objects: [], clockTimezone: "Mars/Phobos" }).clockTimezone).toBe("UTC");
    expect(normalizePrinterLayout({ version: 2, objects: [], wifiLevel: 9 }).wifiLevel).toBe(4);
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

// ─── Task 1: v3 types, seededScreen ──────────────────────────────────────────

import {
  PRINTER_SCREENS,
  seededScreen,
  type PrinterObject,
} from "./printer-layout";

// A box is valid if it sits on the canvas and has positive size.
function boxesValid(objects: PrinterObject[]): boolean {
  return objects.every(
    (o) =>
      o.x >= 0 && o.y >= 0 && o.w > 0 && o.h > 0 &&
      o.x + o.w <= 1.0001 && o.y + o.h <= 1.0001 &&
      typeof o.z === "number" && typeof o.visible === "boolean",
  );
}

describe("seededScreen", () => {
  it("produces a non-empty, on-canvas layout for every screen", () => {
    for (const screen of PRINTER_SCREENS) {
      const { objects } = seededScreen(screen);
      expect(objects.length).toBeGreaterThan(0);
      expect(boxesValid(objects)).toBe(true);
      // ids are unique within a screen
      expect(new Set(objects.map((o) => o.id)).size).toBe(objects.length);
    }
  });

  it("seeds the sent screen with a check image", () => {
    const sent = seededScreen("sent").objects.find((o) => o.id === "decoration");
    expect(sent).toBeDefined();
    expect(sent!.type).toBe("image");
    expect(sent!.image?.url).toMatch(/\/defaults\/check\.png$/);
  });

  it("seeds the error screen with a wifi-off image", () => {
    const err = seededScreen("error").objects.find((o) => o.id === "decoration");
    expect(err).toBeDefined();
    expect(err!.type).toBe("image");
    expect(err!.image?.url).toMatch(/\/defaults\/wifi-off\.png$/);
  });

  it("seeds idle with clock/wifi and no placeholder text labels", () => {
    const idle = seededScreen("idle").objects;
    expect(idle.some((o) => o.type === "clock")).toBe(true);
    expect(idle.some((o) => o.type === "wifi")).toBe(true);
    expect(idle.filter((o) => o.type === "text").length).toBe(0);
  });

  it("never seeds the retired brand-name (logo) widget on any screen", () => {
    for (const screen of PRINTER_SCREENS) {
      expect(seededScreen(screen).objects.some((o) => o.type === "logo")).toBe(false);
    }
  });
});

// ─── "pinned" screen (2026-07-22) ────────────────────────────────────────────

describe("pinned screen", () => {
  it("is included in PRINTER_SCREENS", () => {
    expect(PRINTER_SCREENS).toContain("pinned");
  });

  it("seeds a qr object and a 'Scan to continue' heading, with no countdown", () => {
    const { objects } = seededScreen("pinned");
    expect(objects.some((o) => o.type === "qr")).toBe(true);
    expect(objects.some((o) => o.type === "countdown")).toBe(false);
    const heading = objects.find((o) => o.id === "text-heading");
    expect(heading?.text).toBe("Scan to continue");
  });

  it("otherwise matches the qr screen's seed (minus the countdown object)", () => {
    const qr = seededScreen("qr").objects.filter((o) => o.type !== "countdown");
    const pinned = seededScreen("pinned").objects;
    expect(pinned).toEqual(qr);
  });
});

// ─── Task 2: v2→v3 migration + normalizePrinterConfig ──────────────────────────

import {
  migrateV2ToConfig,
  normalizePrinterConfig,
} from "./printer-layout";

describe("qrTimeoutSeconds", () => {
  it("defaults to 60 when absent", () => {
    const c = normalizePrinterConfig({ version: 3, screens: {} });
    expect(c.qrTimeoutSeconds).toBe(60);
  });
  it("passes a valid value through", () => {
    const c = normalizePrinterConfig({ version: 3, screens: {}, qrTimeoutSeconds: 90 });
    expect(c.qrTimeoutSeconds).toBe(90);
  });
  it("clamps: below min → 15, above max → 180", () => {
    expect(normalizePrinterConfig({ version: 3, screens: {}, qrTimeoutSeconds: 5 }).qrTimeoutSeconds).toBe(15);
    expect(normalizePrinterConfig({ version: 3, screens: {}, qrTimeoutSeconds: 999 }).qrTimeoutSeconds).toBe(180);
  });
  it("rounds non-integers", () => {
    expect(normalizePrinterConfig({ version: 3, screens: {}, qrTimeoutSeconds: 42.7 }).qrTimeoutSeconds).toBe(43);
  });
  it("defaults to 60 when migrating a v2 layout", () => {
    const c = normalizePrinterConfig({ version: 2, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, objects: [] });
    expect(c.qrTimeoutSeconds).toBe(60);
  });
});

describe("clock options", () => {
  const cfg = (clockObj: Record<string, unknown>) => ({
    version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3,
    screens: { idle: { objects: [clockObj] } },
  });
  const idleClock = (raw: unknown) =>
    normalizePrinterConfig(raw).screens.idle.objects.find((o) => o.type === "clock")!;

  it("defaults clock options to shown + center align", () => {
    const c = idleClock(cfg({ id: "clock", type: "clock", x: 0.25, y: 0.5, w: 0.5, h: 0.18, visible: true, z: 0 }));
    expect(c.clock).toEqual({ showDate: true, showWeekday: true });
    expect(c.align).toBe("center");
  });

  it("preserves explicit clock options + align", () => {
    const c = idleClock(cfg({ id: "clock", type: "clock", x: 0.25, y: 0.5, w: 0.5, h: 0.18, visible: true, z: 0, align: "left", clock: { showDate: false, showWeekday: false } }));
    expect(c.clock).toEqual({ showDate: false, showWeekday: false });
    expect(c.align).toBe("left");
  });

  it("coerces a garbage clock field to defaults", () => {
    const c = idleClock(cfg({ id: "clock", type: "clock", x: 0.25, y: 0.5, w: 0.5, h: 0.18, visible: true, z: 0, clock: "nope", align: 99 }));
    expect(c.clock).toEqual({ showDate: true, showWeekday: true });
    expect(c.align).toBe("center");
  });
});

describe("migrateV2ToConfig", () => {
  it("puts the v2 idle objects (minus the retired logo) into screens.idle and seeds the other 6", () => {
    const v2 = defaultLayout();
    const cfg = migrateV2ToConfig(v2);
    expect(cfg.version).toBe(3);
    expect(cfg.clockTimezone).toBe(v2.clockTimezone);
    expect(cfg.wifiLevel).toBe(v2.wifiLevel);
    expect(cfg.screens.idle.objects.length).toBe(v2.objects.filter((o) => o.type !== "logo").length);
    expect(cfg.screens.idle.objects.some((o) => o.type === "logo")).toBe(false);
    for (const s of PRINTER_SCREENS) {
      expect(cfg.screens[s].objects.length).toBeGreaterThan(0);
    }
  });
});

describe("normalizePrinterConfig", () => {
  it("returns a fully-seeded default for garbage input", () => {
    const cfg = normalizePrinterConfig(null);
    expect(cfg.version).toBe(3);
    for (const s of PRINTER_SCREENS) expect(cfg.screens[s].objects.length).toBeGreaterThan(0);
  });

  it("migrates a stored v2 layout (version: 2), dropping the retired logo", () => {
    const v2 = defaultLayout();
    const cfg = normalizePrinterConfig(v2);
    expect(cfg.version).toBe(3);
    expect(cfg.screens.idle.objects.some((o) => o.type === "logo")).toBe(false);
    expect(cfg.screens.idle.objects.some((o) => o.type === "clock")).toBe(true);
    expect(cfg.screens.idle.objects.some((o) => o.type === "wifi")).toBe(true);
  });

  it("fills a missing screen from its seed", () => {
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3,
      screens: { idle: { objects: [] } }, // others absent
    });
    expect(cfg.screens.sent.objects.length).toBeGreaterThan(0);
  });

  it("seeds a pinned screen for a legacy v3 config that predates it", () => {
    // A stored config from before the "pinned" screen existed — screens.pinned
    // is simply absent from the persisted JSON.
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3,
      screens: { idle: { objects: [] }, qr: { objects: [] } }, // no "pinned" key at all
    });
    expect(cfg.screens.pinned.objects.length).toBeGreaterThan(0);
    expect(cfg.screens.pinned.objects.some((o) => o.type === "qr")).toBe(true);
    expect(cfg.screens.pinned.objects.some((o) => o.type === "countdown")).toBe(false);
  });

  it("caps addable (text+image) objects per screen at MAX_CUSTOM", () => {
    const many = Array.from({ length: MAX_CUSTOM + 10 }, (_, i) => ({
      id: `t${i}`, type: "text", x: 0.1, y: 0.1, w: 0.3, h: 0.1, visible: true, z: i, text: `t${i}`,
    }));
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3,
      screens: { idle: { objects: many } },
    });
    const addable = cfg.screens.idle.objects.filter((o) => o.type === "text" || o.type === "image");
    expect(addable.length).toBeLessThanOrEqual(MAX_CUSTOM);
  });

  it("clamps wifiLevel and out-of-range geometry", () => {
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "Nowhere/Nope", clock24h: "yes", wifiLevel: 99,
      screens: { idle: { objects: [
        { id: "t", type: "text", x: 5, y: -3, w: 9, h: 9, visible: true, z: 0, text: "x" },
      ] } },
    });
    expect(cfg.wifiLevel).toBe(4);
    expect(cfg.clockTimezone).toBe("UTC"); // invalid tz → UTC
    expect(cfg.clock24h).toBe(false);
    const t = cfg.screens.idle.objects.find((o) => o.id === "t")!;
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.w).toBeLessThanOrEqual(1.0001);
  });

  it("deduplicates widget singletons, keeping only the first", () => {
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3,
      screens: { idle: { objects: [
        { id: "q1", type: "qr", x: 0.3, y: 0.3, w: 0.3, h: 0.3, visible: true, z: 0 },
        { id: "q2", type: "qr", x: 0.1, y: 0.1, w: 0.3, h: 0.3, visible: true, z: 1 },
      ] } },
    });
    expect(cfg.screens.idle.objects.filter((o) => o.type === "qr")).toHaveLength(1);
  });

});

// ─── Legacy icon → image conversion (icon object type retired 2026-07-20) ────

describe("legacy icon → image conversion", () => {
  const cfgWithIcon = (icon: Record<string, unknown>) => normalizePrinterConfig({
    version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3,
    screens: { idle: { objects: [
      { id: "i1", type: "icon", x: 0.4, y: 0.4, w: 0.2, h: 0.2, visible: true, z: 0, icon },
    ] } },
  });
  const idleObj = (cfg: ReturnType<typeof normalizePrinterConfig>) =>
    cfg.screens.idle.objects.find((o) => o.id === "i1");

  it("converts a legacy uploaded icon to an image", () => {
    const cfg = cfgWithIcon({ source: "upload", url: "https://r2/x.png" });
    const o = idleObj(cfg);
    expect(o?.type).toBe("image");
    expect(o?.image?.url).toBe("https://r2/x.png");
  });

  it("converts a legacy check preset icon to the default image", () => {
    const cfg = cfgWithIcon({ source: "preset", preset: "check" });
    const o = idleObj(cfg);
    expect(o?.type).toBe("image");
    expect(o?.image?.url).toMatch(/\/defaults\/check\.png$/);
  });

  it("converts a legacy wifi-off preset icon to the default image", () => {
    const cfg = cfgWithIcon({ source: "preset", preset: "wifi-off" });
    const o = idleObj(cfg);
    expect(o?.type).toBe("image");
    expect(o?.image?.url).toMatch(/\/defaults\/wifi-off\.png$/);
  });

  it("drops a legacy icon with any other preset (no image equivalent)", () => {
    const cfg = cfgWithIcon({ source: "preset", preset: "heart" });
    expect(idleObj(cfg)).toBeUndefined();
  });

  it("drops a malformed legacy icon with no icon field, without throwing", () => {
    // A second, valid object keeps the screen non-empty so the drop is observed
    // directly rather than confounded with sanitizeScreen's empty-screen fallback.
    const raw = {
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3,
      screens: { idle: { objects: [
        { id: "i1", type: "icon", x: 0.4, y: 0.4, w: 0.2, h: 0.2, visible: true, z: 0 },
        { id: "wifi", type: "wifi", x: 0.82, y: 0.04, w: 0.1, h: 0.06, visible: true, z: 1 },
      ] } },
    };
    expect(() => normalizePrinterConfig(raw)).not.toThrow();
    const cfg = normalizePrinterConfig(raw);
    expect(idleObj(cfg)).toBeUndefined();
    expect(cfg.screens.idle.objects.find((o) => o.id === "wifi")).toBeDefined();
  });

  it("drops signedUrl from an uploaded icon — it is never persisted", () => {
    // Simulate what getTenantBranding sends to the client: an upload icon that has
    // both the canonical R2 key in `url` and an ephemeral presigned URL in `signedUrl`.
    const cfg = cfgWithIcon({
      source: "upload",
      url: "branding/o/icons/x",
      signedUrl: "https://r2.example.com/branding/o/icons/x?X-Amz-Expires=300&sig=abc",
      tint: "accent",
      circle: false,
    });
    const o = idleObj(cfg);
    expect(o?.type).toBe("image");
    expect(o?.image?.url).toBe("branding/o/icons/x");
    expect(o?.image?.signedUrl).toBeUndefined();
  });
});

// ─── image objects ────────────────────────────────────────────────────────────

import { createImageObject } from "./printer-layout";

describe("image objects", () => {
  it("createImageObject makes an empty-upload image object", () => {
    const o = createImageObject(5);
    expect(o.type).toBe("image");
    expect(o.z).toBe(5);
    expect(o.image).toEqual({});
  });

  it("normalize preserves an image url and drops its signedUrl", () => {
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60,
      screens: { idle: { objects: [
        { id: "img-1", type: "image", x: 0.3, y: 0.3, w: 0.3, h: 0.3, visible: true, z: 0,
          image: { url: "branding/o/images/x", signedUrl: "https://r2/x?sig=abc" } },
      ] } },
    });
    const img = cfg.screens.idle.objects.find((o) => o.type === "image");
    expect(img).toBeDefined();
    expect(img!.image!.url).toBe("branding/o/images/x");
    expect(img!.image!.signedUrl).toBeUndefined();
  });

  it("counts image objects against the MAX_CUSTOM cap", () => {
    const objects = Array.from({ length: 25 }, (_, i) => ({
      id: `img-${i}`, type: "image", x: 0.1, y: 0.1, w: 0.2, h: 0.2, visible: true, z: i,
      image: { url: `branding/o/images/${i}` },
    }));
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60,
      screens: { idle: { objects } },
    });
    expect(cfg.screens.idle.objects.filter((o) => o.type === "image").length).toBe(20);
  });
});

// ─── Retired brand-name (logo) widget ────────────────────────────────────────

describe("retired brand-name (logo) widget", () => {
  it("normalize drops every stored logo object (v3)", () => {
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60,
      screens: { idle: { objects: [
        { id: "logo", type: "logo", x: 0.25, y: 0.32, w: 0.5, h: 0.16, visible: true, z: 0 },
        { id: "clock", type: "clock", x: 0.25, y: 0.52, w: 0.5, h: 0.18, visible: true, z: 1 },
      ] } },
    });
    expect(cfg.screens.idle.objects.some((o) => o.type === "logo")).toBe(false);
    expect(cfg.screens.idle.objects.some((o) => o.type === "clock")).toBe(true);
  });
});

// ─── Addable clock/wifi widgets + custom names ───────────────────────────────

import { createClockObject, createWifiObject, MAX_NAME_LEN } from "./printer-layout";

describe("clock/wifi factories", () => {
  it("createClockObject makes a visible clock with defaults and a unique id", () => {
    const a = createClockObject(4);
    expect(a.type).toBe("clock");
    expect(a.id).toMatch(/^clock-/);
    expect(a).toMatchObject({ visible: true, z: 4, align: "center", clock: { showDate: true, showWeekday: true } });
    expect(createClockObject(4).id).not.toBe(a.id);
  });

  it("createWifiObject makes a visible wifi widget with a unique id", () => {
    const a = createWifiObject(2);
    expect(a.type).toBe("wifi");
    expect(a.id).toMatch(/^wifi-/);
    expect(a).toMatchObject({ visible: true, z: 2 });
    expect(createWifiObject(2).id).not.toBe(a.id);
  });
});

describe("custom object names", () => {
  const cfgWith = (objects: unknown[]) => normalizePrinterConfig({
    version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60,
    screens: { idle: { objects } },
  });

  it("normalize preserves a trimmed name and caps its length", () => {
    const cfg = cfgWith([
      { id: "t", type: "text", x: 0.1, y: 0.1, w: 0.3, h: 0.1, visible: true, z: 0, text: "hi", name: `  ${"n".repeat(60)}  ` },
    ]);
    const t = cfg.screens.idle.objects.find((o) => o.id === "t")!;
    expect(t.name).toBe("n".repeat(MAX_NAME_LEN));
  });

  it("normalize drops empty/garbage names", () => {
    const cfg = cfgWith([
      { id: "t", type: "text", x: 0.1, y: 0.1, w: 0.3, h: 0.1, visible: true, z: 0, text: "hi", name: "   " },
      { id: "c", type: "clock", x: 0.25, y: 0.52, w: 0.5, h: 0.18, visible: true, z: 1, name: 42 },
    ]);
    expect(cfg.screens.idle.objects.find((o) => o.id === "t")!.name).toBeUndefined();
    expect(cfg.screens.idle.objects.find((o) => o.id === "c")!.name).toBeUndefined();
  });

  it("objectLabel prefers the user-given name over text/type labels", () => {
    expect(objectLabel({ ...createTextObject("Hello world", 0), name: "Header" })).toBe("Header");
    expect(objectLabel({ ...createClockObject(0), name: "Lobby clock" })).toBe("Lobby clock");
    expect(objectLabel({ ...createClockObject(0) })).toBe("Clock");
    expect(objectLabel({ ...createTextObject("Hello", 0) })).toBe("Hello");
    const long = { ...createTextObject("x", 0), name: "A very long custom object name" };
    expect(objectLabel(long).endsWith("…")).toBe(true);
  });
});

// ─── Per-screen color overrides ──────────────────────────────────────────────

import { screenColors, type ScreenColors } from "./printer-layout";

describe("per-screen colors", () => {
  const base = { version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60 };
  const idleWith = (colors: unknown) => normalizePrinterConfig({
    ...base,
    screens: { idle: { objects: [
      { id: "t", type: "text", x: 0.1, y: 0.1, w: 0.3, h: 0.1, visible: true, z: 0, text: "hi" },
    ], colors } },
  });

  it("keeps a valid 4-color override and normalizes hex to #-prefixed lowercase", () => {
    const cfg = idleWith({ accent: "10A765", bg: "#FFFFFF", fg: "#111111", muted: "#8a8a8a" });
    expect(cfg.screens.idle.colors).toEqual({
      accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "#8a8a8a",
    });
  });

  it("drops partial, invalid-hex, and non-object overrides", () => {
    expect(idleWith({ accent: "#10a765", bg: "#ffffff", fg: "#111111" }).screens.idle.colors).toBeUndefined();
    expect(idleWith({ accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "nope" }).screens.idle.colors).toBeUndefined();
    expect(idleWith("dark").screens.idle.colors).toBeUndefined();
    expect(idleWith(null).screens.idle.colors).toBeUndefined();
  });

  it("expands 3-digit hex shorthand instead of dropping the override", () => {
    const cfg = idleWith({ accent: "#AbC", bg: "fff", fg: "#111111", muted: "#8a8a8a" });
    expect(cfg.screens.idle.colors).toEqual({
      accent: "#aabbcc", bg: "#ffffff", fg: "#111111", muted: "#8a8a8a",
    });
  });

  it("v2 migration and seeded screens never produce colors", () => {
    const migrated = normalizePrinterConfig(defaultLayout());
    for (const s of PRINTER_SCREENS) {
      expect(migrated.screens[s].colors).toBeUndefined();
      expect(seededScreen(s).colors).toBeUndefined();
    }
  });

  it("screenColors returns the override when present, null otherwise", () => {
    const cfg = idleWith({ accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "#8a8a8a" });
    expect(screenColors(cfg, "idle")).toEqual({ accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "#8a8a8a" });
    expect(screenColors(cfg, "error")).toBeNull();
  });

  it("round-trips: a normalized override survives re-normalization", () => {
    const once = idleWith({ accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "#8a8a8a" });
    const twice = normalizePrinterConfig(once);
    expect(twice.screens.idle.colors).toEqual(once.screens.idle.colors);
  });
});

import { withScreenObjects, withScreenColors, createTextObject as mkText } from "./printer-layout";

// ─── QR style (shape + colors, 2026-07-23) ───────────────────────────────────

import { sanitizeQrStyle, DEFAULT_QR_STYLE } from "./printer-layout";

describe("sanitizeQrStyle", () => {
  it("passes a valid shape + high-contrast pair through unchanged", () => {
    const s = sanitizeQrStyle({ qrShape: "dots", qrFg: "#003366", qrBg: "#f0f0f0" });
    expect(s).toEqual({
      qrShape: "dots",
      qrFg: "#003366",
      qrBg: "#f0f0f0",
      qrCorner: DEFAULT_QR_STYLE.qrCorner,
      qrShadowMode: DEFAULT_QR_STYLE.qrShadowMode,
      qrShadowStrength: DEFAULT_QR_STYLE.qrShadowStrength,
      qrShadowColor: DEFAULT_QR_STYLE.qrShadowColor,
    });
  });

  it("falls back to the default shape/colors for null/garbage input", () => {
    expect(sanitizeQrStyle(null)).toEqual(DEFAULT_QR_STYLE);
    expect(sanitizeQrStyle(undefined)).toEqual(DEFAULT_QR_STYLE);
    expect(sanitizeQrStyle("nope")).toEqual(DEFAULT_QR_STYLE);
    expect(sanitizeQrStyle({})).toEqual(DEFAULT_QR_STYLE);
  });

  it("resets an unknown shape to 'rounded' but keeps valid colors", () => {
    const s = sanitizeQrStyle({ qrShape: "spiky", qrFg: "#111111", qrBg: "#ffffff" });
    expect(s.qrShape).toBe("rounded");
    expect(s.qrFg).toBe("#111111");
    expect(s.qrBg).toBe("#ffffff");
  });

  it("defaults a malformed hex field individually (not the whole pair)", () => {
    const s = sanitizeQrStyle({ qrShape: "classic", qrFg: "not-a-color", qrBg: "#ffffff" });
    expect(s.qrShape).toBe("classic");
    expect(s.qrFg).toBe(DEFAULT_QR_STYLE.qrFg);
    expect(s.qrBg).toBe("#ffffff");
  });

  it("expands 3-digit hex shorthand", () => {
    const s = sanitizeQrStyle({ qrShape: "rounded", qrFg: "#000", qrBg: "#fff" });
    expect(s.qrFg).toBe("#000000");
    expect(s.qrBg).toBe("#ffffff");
  });

  it("keeps a low-contrast pair as chosen (scannability is the merchant's call)", () => {
    const s = sanitizeQrStyle({ qrShape: "soft", qrFg: "#888888", qrBg: "#999999" });
    expect(s.qrShape).toBe("soft");
    expect(s.qrFg).toBe("#888888");
    expect(s.qrBg).toBe("#999999");
  });

  it("keeps an inverted (light-on-dark) pair as chosen", () => {
    const s = sanitizeQrStyle({ qrShape: "rounded", qrFg: "#ffffff", qrBg: "#111111" });
    expect(s.qrFg).toBe("#ffffff");
    expect(s.qrBg).toBe("#111111");
  });

  it("the default pair passes through unchanged", () => {
    const s = sanitizeQrStyle({ qrShape: "rounded", qrFg: DEFAULT_QR_STYLE.qrFg, qrBg: DEFAULT_QR_STYLE.qrBg });
    expect(s.qrFg).toBe(DEFAULT_QR_STYLE.qrFg);
    expect(s.qrBg).toBe(DEFAULT_QR_STYLE.qrBg);
  });
});

// ─── QR background corner + shadow (2026-07-23 addendum) ────────────────────
// See docs/superpowers/specs/2026-07-23-qr-style-options.md, addendum below —
// the studio preview hard-coded rounded corners + a shadow while the device
// rendered square + shadowless; both are now an org-wide, config-driven choice.

describe("sanitizeQrStyle — corner", () => {
  it("defaults qrCorner to 'rounded' for garbage/missing input", () => {
    expect(sanitizeQrStyle(null)).toMatchObject({ qrCorner: "rounded" });
    expect(sanitizeQrStyle(undefined)).toMatchObject({ qrCorner: "rounded" });
    expect(sanitizeQrStyle({})).toMatchObject({ qrCorner: "rounded" });
  });

  it("passes a valid corner through unchanged", () => {
    expect(sanitizeQrStyle({ qrCorner: "square" }).qrCorner).toBe("square");
  });

  it("resets an unknown corner value to 'rounded'", () => {
    const s = sanitizeQrStyle({ qrCorner: "beveled" });
    expect(s.qrCorner).toBe("rounded");
  });
});

// ─── QR background-plate shadow: mode + strength + color (2026-07-24) ───────
// Replaces the old boolean `qrShadow` with a 3-way mode ("none" | "drop" |
// "neon"), a 0..100 intensity, and a color — see sanitizeQrStyle.

describe("sanitizeQrStyle — shadow mode/strength/color", () => {
  it("defaults to mode 'none', strength 50, color #000000 for garbage/missing input", () => {
    for (const input of [null, undefined, "nope", {}]) {
      expect(sanitizeQrStyle(input)).toMatchObject({
        qrShadowMode: "none",
        qrShadowStrength: 50,
        qrShadowColor: "#000000",
      });
    }
  });

  it("passes a valid mode/strength/color through unchanged", () => {
    const s = sanitizeQrStyle({ qrShadowMode: "neon", qrShadowStrength: 80, qrShadowColor: "#ff00aa" });
    expect(s.qrShadowMode).toBe("neon");
    expect(s.qrShadowStrength).toBe(80);
    expect(s.qrShadowColor).toBe("#ff00aa");
  });

  it("resets an unknown mode value to 'none'", () => {
    expect(sanitizeQrStyle({ qrShadowMode: "glow" }).qrShadowMode).toBe("none");
    expect(sanitizeQrStyle({ qrShadowMode: 1 }).qrShadowMode).toBe("none");
  });

  it("migrates a legacy boolean qrShadow: true to mode 'drop'", () => {
    expect(sanitizeQrStyle({ qrShadow: true }).qrShadowMode).toBe("drop");
  });

  it("migrates a legacy boolean qrShadow: false (or absent) to mode 'none'", () => {
    expect(sanitizeQrStyle({ qrShadow: false }).qrShadowMode).toBe("none");
    expect(sanitizeQrStyle({}).qrShadowMode).toBe("none");
  });

  it("a valid stored qrShadowMode wins over a legacy qrShadow boolean", () => {
    expect(sanitizeQrStyle({ qrShadowMode: "neon", qrShadow: false }).qrShadowMode).toBe("neon");
    expect(sanitizeQrStyle({ qrShadowMode: "none", qrShadow: true }).qrShadowMode).toBe("none");
  });

  it("clamps strength above 100 down to 100, and below 0 up to 0", () => {
    expect(sanitizeQrStyle({ qrShadowStrength: 150 }).qrShadowStrength).toBe(100);
    expect(sanitizeQrStyle({ qrShadowStrength: -5 }).qrShadowStrength).toBe(0);
  });

  it("rounds a non-integer strength", () => {
    expect(sanitizeQrStyle({ qrShadowStrength: 42.7 }).qrShadowStrength).toBe(43);
  });

  it("coerces a non-numeric strength to the default (50)", () => {
    expect(sanitizeQrStyle({ qrShadowStrength: "high" }).qrShadowStrength).toBe(50);
    expect(sanitizeQrStyle({ qrShadowStrength: null }).qrShadowStrength).toBe(50);
  });

  it("defaults a malformed shadow-color hex to #000000", () => {
    expect(sanitizeQrStyle({ qrShadowColor: "not-a-color" }).qrShadowColor).toBe("#000000");
  });

  it("expands 3-digit shadow-color hex shorthand", () => {
    expect(sanitizeQrStyle({ qrShadowColor: "#f0a" }).qrShadowColor).toBe("#ff00aa");
  });
});

describe("normalizePrinterConfig — QR style", () => {
  it("defaults qrShape/qrFg/qrBg at the top level for garbage input", () => {
    const cfg = normalizePrinterConfig(null);
    expect(cfg.qrShape).toBe(DEFAULT_QR_STYLE.qrShape);
    expect(cfg.qrFg).toBe(DEFAULT_QR_STYLE.qrFg);
    expect(cfg.qrBg).toBe(DEFAULT_QR_STYLE.qrBg);
  });

  it("passes through a valid stored qrShape/qrFg/qrBg at the top level (v3)", () => {
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60,
      qrShape: "classic", qrFg: "#002200", qrBg: "#eeeeee",
      screens: {},
    });
    expect(cfg.qrShape).toBe("classic");
    expect(cfg.qrFg).toBe("#002200");
    expect(cfg.qrBg).toBe("#eeeeee");
  });

  it("defaults qrShape/qrFg/qrBg when migrating a v2 layout (predates the fields)", () => {
    const cfg = normalizePrinterConfig(defaultLayout());
    expect(cfg.qrShape).toBe(DEFAULT_QR_STYLE.qrShape);
    expect(cfg.qrFg).toBe(DEFAULT_QR_STYLE.qrFg);
    expect(cfg.qrBg).toBe(DEFAULT_QR_STYLE.qrBg);
  });

  it("round-trips a normalized style through re-normalization", () => {
    const once = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60,
      qrShape: "dots", qrFg: "#123456", qrBg: "#fafafa",
      screens: {},
    });
    const twice = normalizePrinterConfig(once);
    expect(twice.qrShape).toBe(once.qrShape);
    expect(twice.qrFg).toBe(once.qrFg);
    expect(twice.qrBg).toBe(once.qrBg);
  });

  it("defaults qrCorner/qrShadowMode/qrShadowStrength/qrShadowColor at the top level for garbage input", () => {
    const cfg = normalizePrinterConfig(null);
    expect(cfg.qrCorner).toBe(DEFAULT_QR_STYLE.qrCorner);
    expect(cfg.qrShadowMode).toBe(DEFAULT_QR_STYLE.qrShadowMode);
    expect(cfg.qrShadowStrength).toBe(DEFAULT_QR_STYLE.qrShadowStrength);
    expect(cfg.qrShadowColor).toBe(DEFAULT_QR_STYLE.qrShadowColor);
  });

  it("passes through a valid stored qrCorner/qrShadowMode/qrShadowStrength/qrShadowColor at the top level (v3)", () => {
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60,
      qrShape: "classic", qrFg: "#002200", qrBg: "#eeeeee", qrCorner: "square",
      qrShadowMode: "neon", qrShadowStrength: 75, qrShadowColor: "#00ffff",
      screens: {},
    });
    expect(cfg.qrCorner).toBe("square");
    expect(cfg.qrShadowMode).toBe("neon");
    expect(cfg.qrShadowStrength).toBe(75);
    expect(cfg.qrShadowColor).toBe("#00ffff");
  });

  it("migrates a legacy top-level boolean qrShadow (v3, predates the mode field)", () => {
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60,
      qrShadow: true,
      screens: {},
    });
    expect(cfg.qrShadowMode).toBe("drop");
  });

  it("defaults qrCorner/qrShadowMode when migrating a v2 layout (predates the fields)", () => {
    const cfg = normalizePrinterConfig(defaultLayout());
    expect(cfg.qrCorner).toBe(DEFAULT_QR_STYLE.qrCorner);
    expect(cfg.qrShadowMode).toBe(DEFAULT_QR_STYLE.qrShadowMode);
  });

  it("round-trips qrCorner/qrShadowMode/qrShadowStrength/qrShadowColor through re-normalization", () => {
    const once = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60,
      qrShape: "dots", qrFg: "#123456", qrBg: "#fafafa", qrCorner: "square",
      qrShadowMode: "drop", qrShadowStrength: 33, qrShadowColor: "#123123",
      screens: {},
    });
    const twice = normalizePrinterConfig(once);
    expect(twice.qrCorner).toBe(once.qrCorner);
    expect(twice.qrShadowMode).toBe(once.qrShadowMode);
    expect(twice.qrShadowStrength).toBe(once.qrShadowStrength);
    expect(twice.qrShadowColor).toBe(once.qrShadowColor);
  });
});

describe("screen updaters", () => {
  const colors: ScreenColors = { accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "#8a8a8a" };
  const cfg = () => {
    const c = normalizePrinterConfig(null);
    return withScreenColors(c, "idle", colors);
  };

  it("withScreenColors sets and removes the override without touching objects", () => {
    const withC = cfg();
    expect(withC.screens.idle.colors).toEqual(colors);
    expect(withC.screens.idle.objects.length).toBeGreaterThan(0);
    const removed = withScreenColors(withC, "idle", null);
    expect(removed.screens.idle.colors).toBeUndefined();
    expect("colors" in removed.screens.idle).toBe(false); // key absent, not undefined (clean JSON)
    expect(removed.screens.idle.objects).toEqual(withC.screens.idle.objects);
  });

  it("withScreenObjects replaces objects and PRESERVES the color override", () => {
    const next = withScreenObjects(cfg(), "idle", [mkText("hello", 0)]);
    expect(next.screens.idle.objects.map((o) => o.text)).toEqual(["hello"]);
    expect(next.screens.idle.colors).toEqual(colors);
  });

  it("updaters do not mutate their input and leave other screens alone", () => {
    const before = cfg();
    const snapshot = JSON.stringify(before);
    const after = withScreenObjects(before, "idle", []);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after.screens.error).toBe(before.screens.error);
  });
});
