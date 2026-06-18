import { describe, it, expect } from "vitest";
import {
  normalizePrinterLayout,
  createTextObject,
  objectLabel,
  defaultLayout,
  DEFAULT_PRINTER_LAYOUT,
  FIXED_TYPES,
  FONT_MIN,
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

// ─── Task 1: v3 types, seededScreen, createIconObject ────────────────────────

import {
  PRINTER_SCREENS,
  ICON_PRESETS,
  DEFAULT_ICON_PRESET,
  seededScreen,
  createIconObject,
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

  it("seeds the sent screen with an accent circle check icon", () => {
    const sent = seededScreen("sent").objects.find((o) => o.type === "icon");
    expect(sent).toBeDefined();
    expect(sent!.icon).toMatchObject({ source: "preset", preset: "check", circle: true, tint: "accent" });
  });

  it("seeds the error screen with a warn wifi-off icon", () => {
    const err = seededScreen("error").objects.find((o) => o.type === "icon");
    expect(err!.icon).toMatchObject({ source: "preset", preset: "wifi-off", tint: "warn" });
  });

  it("seeds idle with logo/clock/wifi and no placeholder text labels", () => {
    const idle = seededScreen("idle").objects;
    expect(idle.some((o) => o.type === "logo")).toBe(true);
    expect(idle.some((o) => o.type === "clock")).toBe(true);
    expect(idle.some((o) => o.type === "wifi")).toBe(true);
    expect(idle.filter((o) => o.type === "text").length).toBe(0);
  });
});

describe("createIconObject", () => {
  it("creates a centered preset icon on top", () => {
    const o = createIconObject(5);
    expect(o.type).toBe("icon");
    expect(o.z).toBe(5);
    expect(o.icon).toMatchObject({ source: "preset", preset: DEFAULT_ICON_PRESET, tint: "accent" });
    expect(o.id.startsWith("icon-")).toBe(true);
    expect(createIconObject(5).id).not.toBe(o.id);
  });
});

describe("allowlist", () => {
  it("DEFAULT_ICON_PRESET is in ICON_PRESETS", () => {
    expect((ICON_PRESETS as readonly string[]).includes(DEFAULT_ICON_PRESET)).toBe(true);
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
  it("puts the v2 idle objects into screens.idle and seeds the other 6", () => {
    const v2 = defaultLayout();
    const cfg = migrateV2ToConfig(v2);
    expect(cfg.version).toBe(3);
    expect(cfg.clockTimezone).toBe(v2.clockTimezone);
    expect(cfg.wifiLevel).toBe(v2.wifiLevel);
    expect(cfg.screens.idle.objects.length).toBe(v2.objects.length);
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

  it("migrates a stored v2 layout (version: 2)", () => {
    const v2 = defaultLayout();
    const cfg = normalizePrinterConfig(v2);
    expect(cfg.version).toBe(3);
    expect(cfg.screens.idle.objects.some((o) => o.type === "logo")).toBe(true);
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

  it("drops an unknown icon preset to the default and keeps the object", () => {
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3,
      screens: { idle: { objects: [
        { id: "i1", type: "icon", x: 0.4, y: 0.4, w: 0.2, h: 0.2, visible: true, z: 0,
          icon: { source: "preset", preset: "definitely-not-a-real-icon" } },
      ] } },
    });
    const icon = cfg.screens.idle.objects.find((o) => o.type === "icon");
    expect(icon!.icon!.preset).toBe("check");
  });

  it("caps addable (text+icon) objects per screen at MAX_CUSTOM", () => {
    const many = Array.from({ length: MAX_CUSTOM + 10 }, (_, i) => ({
      id: `t${i}`, type: "text", x: 0.1, y: 0.1, w: 0.3, h: 0.1, visible: true, z: i, text: `t${i}`,
    }));
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3,
      screens: { idle: { objects: many } },
    });
    const addable = cfg.screens.idle.objects.filter((o) => o.type === "text" || o.type === "icon");
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

  it("drops signedUrl from upload icons — it is never persisted", () => {
    // Simulate what getTenantBranding sends to the client: an upload icon that has
    // both the canonical R2 key in `url` and an ephemeral presigned URL in `signedUrl`.
    // normalizePrinterConfig must strip `signedUrl` so it never round-trips back on save.
    const cfg = normalizePrinterConfig({
      version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3,
      screens: {
        idle: {
          objects: [
            {
              id: "icon-1", type: "icon", x: 0.4, y: 0.4, w: 0.2, h: 0.2, visible: true, z: 0,
              icon: {
                source: "upload",
                url: "branding/o/icons/x",
                signedUrl: "https://r2.example.com/branding/o/icons/x?X-Amz-Expires=300&sig=abc",
                tint: "accent",
                circle: false,
              },
            },
          ],
        },
      },
    });
    const icon = cfg.screens.idle.objects.find((o) => o.type === "icon");
    expect(icon).toBeDefined();
    // The R2 key must be preserved.
    expect(icon!.icon!.url).toBe("branding/o/icons/x");
    // The ephemeral display URL must be stripped by normalize.
    expect(icon!.icon!.signedUrl).toBeUndefined();
  });
});
