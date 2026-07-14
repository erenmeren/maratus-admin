// Printer idle-screen layout (v2): a list of objects, each a real box (top-left
// x/y + w/h as fractions of the 720² canvas, resolution-independent). Object
// types: text (editable content + font size + align), and the fixed widgets
// logo/clock/wifi (one each, hideable, not deletable). Persisted per tenant as
// jsonb; always loaded through normalizePrinterLayout so malformed/old (v1) data
// can never break the render — v1 layouts are reset to the default.
import { isValidTimezone } from "./timezones";
import { MIN_BOX } from "./printer-geometry";

export const PRINTER_SCREENS = ["idle", "processing", "qr", "sent", "error", "paused", "setup"] as const;
export type PrinterScreen = (typeof PRINTER_SCREENS)[number];

export const OBJECT_TYPES = [
  "text", "logo", "clock", "wifi",
  "icon", "image",
  "qr", "spinner", "countdown", "pairingCode", "steps",
] as const;
export type PrinterObjectType = (typeof OBJECT_TYPES)[number];

// Legacy v2 fixed widgets (idle screen). Kept for v2 normalize + migration.
export const FIXED_TYPES = ["logo", "clock", "wifi"] as const;
export type FixedType = (typeof FIXED_TYPES)[number];

// v3 singleton widgets: ≤1 per screen; hideable. `clock` and `wifi` are also
// user-addable/deletable (still one per screen); the rest are hide-only.
// `logo` (the brand-name wordmark) was retired 2026-07-13 — stored logo objects
// are dropped on normalize; the type stays in OBJECT_TYPES only for legacy data.
export const WIDGET_TYPES = ["clock", "wifi", "qr", "spinner", "countdown", "pairingCode", "steps"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

// v3 user-addable/duplicable types (unbounded up to MAX_CUSTOM).
export const ADDABLE_TYPES = ["text", "image"] as const;
export type AddableType = (typeof ADDABLE_TYPES)[number];

export const TYPE_LABEL: Record<PrinterObjectType, string> = {
  text: "Text",
  logo: "Brand name",
  clock: "Clock",
  wifi: "Wi-Fi signal",
  icon: "Icon",
  image: "Image",
  qr: "QR code",
  spinner: "Spinner",
  countdown: "Countdown",
  pairingCode: "Pairing code",
  steps: "Steps",
};

export const ICON_PRESETS = [
  "check", "check-circle", "heart", "star", "gift", "mail", "thumbs-up", "smile",
  "clock", "bell", "alert-triangle", "wifi-off", "sparkles", "party-popper",
  "badge-check", "coffee",
] as const;
export type IconPreset = (typeof ICON_PRESETS)[number];
export const DEFAULT_ICON_PRESET: IconPreset = "check";
export type IconTint = "accent" | "muted" | "none";

export interface PrinterIcon {
  source: "preset" | "upload";
  preset?: IconPreset;
  url?: string;
  /** Display-only presigned URL for an uploaded icon; NEVER persisted (normalize drops it). */
  signedUrl?: string;
  tint?: IconTint;
  circle?: boolean;
}

export interface PrinterImage {
  url?: string;
  /** Display-only presigned URL; NEVER persisted (normalize drops it). */
  signedUrl?: string;
}

export interface PrinterClockOptions {
  showDate?: boolean;    // default true — the whole date line
  showWeekday?: boolean; // default true — the day name within the date
}

export type TextAlign = "left" | "center" | "right";

export interface PrinterObject {
  id: string;
  type: PrinterObjectType;
  x: number; // top-left, fraction 0..1
  y: number;
  w: number; // size, fraction 0..1
  h: number;
  visible: boolean;
  z: number;
  /** Optional user-given display name shown in the object list. */
  name?: string;
  text?: string;
  fontSize?: number; // px on the 720 reference
  align?: TextAlign;
  icon?: PrinterIcon; // icon objects
  image?: PrinterImage; // image objects
  clock?: PrinterClockOptions; // clock objects
}

export interface PrinterLayout {
  version: 2;
  clockTimezone: string;
  clock24h: boolean;
  wifiLevel: number; // 0..4
  objects: PrinterObject[];
}

/** All-or-nothing per-screen palette override; absent = inherit the global palette. */
export interface ScreenColors {
  accent: string; // #rrggbb
  bg: string;
  fg: string;
  muted: string;
}

export interface ScreenLayout {
  objects: PrinterObject[];
  colors?: ScreenColors;
}

export interface PrinterConfig {
  version: 3;
  clockTimezone: string;
  clock24h: boolean;
  wifiLevel: number; // 0..4
  qrTimeoutSeconds: number; // document/QR screen display timeout, 15..180
  screens: Record<PrinterScreen, ScreenLayout>;
}

export const FONT_MIN = 8;
export const FONT_MAX = 160;
export const MAX_CUSTOM = 20;
export const MAX_TEXT_LEN = 80;
export const MAX_NAME_LEN = 40;

const ALIGNS: TextAlign[] = ["left", "center", "right"];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Default box + props for each fixed widget, reproducing today's arrangement. */
const FIXED_DEFAULTS: Record<FixedType, Pick<PrinterObject, "x" | "y" | "w" | "h">> = {
  wifi: { x: 0.82, y: 0.04, w: 0.1, h: 0.06 },
  logo: { x: 0.3, y: 0.28, w: 0.4, h: 0.22 },
  clock: { x: 0.25, y: 0.52, w: 0.5, h: 0.18 },
};

/** A fresh default layout (new object each call so callers can't mutate it). */
export function defaultLayout(): PrinterLayout {
  const fixed: PrinterObject[] = FIXED_TYPES.map((type, i) => ({
    id: type,
    type,
    ...FIXED_DEFAULTS[type],
    visible: true,
    z: i,
  }));
  return {
    version: 2,
    clockTimezone: "UTC",
    clock24h: false,
    wifiLevel: 3,
    objects: [...fixed],
  };
}

export const DEFAULT_PRINTER_LAYOUT: PrinterLayout = defaultLayout();

const DEFAULT_FONT: Record<PrinterObjectType, number> = {
  text: 24, logo: 24, clock: 24, wifi: 24,
  icon: 24, image: 24, qr: 24, spinner: 24, countdown: 24, pairingCode: 24, steps: 24,
};

/** Short random suffix for generated object ids. */
function genIdSuffix(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.floor(Math.random() * 1e9).toString(36);
}

/** A fresh custom text object, centered, on top (`z`). */
export function createTextObject(text: string, z: number): PrinterObject {
  return {
    id: `text-${genIdSuffix()}`,
    type: "text",
    x: 0.35,
    y: 0.45,
    w: 0.3,
    h: 0.1,
    visible: true,
    z,
    text: text.slice(0, MAX_TEXT_LEN),
    fontSize: 24,
    align: "center",
  };
}

/** A fresh custom image object, centered, on top (`z`). Empty until a file is uploaded. */
export function createImageObject(z: number): PrinterObject {
  return {
    id: `image-${genIdSuffix()}`,
    type: "image",
    x: 0.35, y: 0.35, w: 0.3, h: 0.3,
    visible: true,
    z,
    image: {},
  };
}

/** A fresh clock widget (one per screen), on top (`z`). */
export function createClockObject(z: number): PrinterObject {
  return {
    id: `clock-${genIdSuffix()}`,
    type: "clock",
    ...WIDGET_BOX.clock,
    visible: true,
    z,
    align: "center",
    clock: { showDate: true, showWeekday: true },
  };
}

/** A fresh Wi-Fi signal widget (one per screen), on top (`z`). */
export function createWifiObject(z: number): PrinterObject {
  return {
    id: `wifi-${genIdSuffix()}`,
    type: "wifi",
    ...WIDGET_BOX.wifi,
    visible: true,
    z,
  };
}

// Internal helper: build an object with sane defaults.
function obj(o: Partial<PrinterObject> & Pick<PrinterObject, "id" | "type" | "x" | "y" | "w" | "h" | "z">): PrinterObject {
  return { visible: true, ...o };
}

/**
 * Default object layout for a screen, reproducing today's hard-coded templates so
 * a tenant who never edits a screen sees no visual change. Positions/sizes are
 * lifted from the per-screen JSX in printer-preview.tsx; tune to match pixel-for-pixel
 * against the live render during the Task 5 smoke check.
 */
export function seededScreen(screen: PrinterScreen): ScreenLayout {
  switch (screen) {
    case "idle":
      // Reuse the v2 default objects (clock/wifi — the brand-name logo is retired).
      return { objects: defaultLayout().objects.filter((o) => o.type !== "logo") };
    case "processing":
      // From ProcessingScreen (printer-preview.tsx): spinner + caption text.
      return {
        objects: [
          obj({ id: "spinner", type: "spinner", x: 0.42, y: 0.34, w: 0.16, h: 0.16, z: 0 }),
          obj({ id: "text-caption", type: "text", x: 0.15, y: 0.56, w: 0.7, h: 0.08, z: 1, text: "Preparing your document…", fontSize: 26, align: "center" }),
          obj({ id: "text-sub", type: "text", x: 0.2, y: 0.66, w: 0.6, h: 0.06, z: 2, text: "This only takes a moment", fontSize: 16, align: "center" }),
        ],
      };
    case "qr":
      // From DocumentScreen (printer-preview.tsx): heading + qr + caption + countdown.
      return {
        objects: [
          obj({ id: "text-heading", type: "text", x: 0.1, y: 0.2, w: 0.8, h: 0.07, z: 1, text: "Scan to get your document", fontSize: 24, align: "center" }),
          obj({ id: "qr", type: "qr", x: 0.32, y: 0.3, w: 0.36, h: 0.36, z: 2 }),
          obj({ id: "text-hint", type: "text", x: 0.15, y: 0.7, w: 0.7, h: 0.06, z: 3, text: "Point your phone camera at the code", fontSize: 16, align: "center" }),
          obj({ id: "countdown", type: "countdown", x: 0.3, y: 0.8, w: 0.4, h: 0.1, z: 4 }),
        ],
      };
    case "sent":
      // From SentScreen (printer-preview.tsx): check icon (circle) + title/subtext/footer.
      return {
        objects: [
          obj({ id: "icon", type: "icon", x: 0.4, y: 0.22, w: 0.2, h: 0.2, z: 0, icon: { source: "preset", preset: "check", circle: true, tint: "accent" } }),
          obj({ id: "text-title", type: "text", x: 0.1, y: 0.48, w: 0.8, h: 0.08, z: 1, text: "Your document is on its way", fontSize: 26, align: "center" }),
          obj({ id: "text-sub", type: "text", x: 0.15, y: 0.58, w: 0.7, h: 0.06, z: 2, text: "Check your phone — all set. Thank you!", fontSize: 16, align: "center" }),
          obj({ id: "text-footer", type: "text", x: 0.2, y: 0.82, w: 0.6, h: 0.05, z: 3, text: "Returning to start…", fontSize: 14, align: "center" }),
        ],
      };
    case "error":
      // From ErrorScreen (printer-preview.tsx): wifi-off icon + headline + subtext + pill.
      return {
        objects: [
          obj({ id: "icon", type: "icon", x: 0.42, y: 0.22, w: 0.16, h: 0.16, z: 0, icon: { source: "preset", preset: "wifi-off", tint: "accent", circle: false } }),
          obj({ id: "text-title", type: "text", x: 0.1, y: 0.44, w: 0.8, h: 0.08, z: 1, text: "We couldn't send your document", fontSize: 24, align: "center" }),
          obj({ id: "text-sub", type: "text", x: 0.15, y: 0.54, w: 0.7, h: 0.06, z: 2, text: "The device is offline right now.", fontSize: 16, align: "center" }),
          obj({ id: "text-pill", type: "text", x: 0.15, y: 0.72, w: 0.7, h: 0.08, z: 3, text: "Please ask a team member for a paper document", fontSize: 15, align: "center" }),
        ],
      };
    case "paused":
      // From PausedScreen (printer-preview.tsx): title + subtext.
      return {
        objects: [
          obj({ id: "text-title", type: "text", x: 0.1, y: 0.46, w: 0.8, h: 0.08, z: 1, text: "Currently unavailable", fontSize: 24, align: "center" }),
          obj({ id: "text-sub", type: "text", x: 0.15, y: 0.56, w: 0.7, h: 0.06, z: 2, text: "Digital documents are paused at this register.", fontSize: 16, align: "center" }),
        ],
      };
    case "setup":
      // From SetupScreen (printer-preview.tsx): heading + steps + pairingCode + qr.
      return {
        objects: [
          obj({ id: "text-title", type: "text", x: 0.1, y: 0.18, w: 0.8, h: 0.07, z: 1, text: "Let's pair this device", fontSize: 24, align: "center" }),
          obj({ id: "text-sub", type: "text", x: 0.15, y: 0.26, w: 0.7, h: 0.05, z: 2, text: "Claim it from your admin dashboard to start.", fontSize: 15, align: "center" }),
          obj({ id: "steps", type: "steps", x: 0.18, y: 0.34, w: 0.64, h: 0.28, z: 3 }),
          obj({ id: "pairingCode", type: "pairingCode", x: 0.25, y: 0.66, w: 0.3, h: 0.12, z: 4 }),
          obj({ id: "qr", type: "qr", x: 0.6, y: 0.66, w: 0.2, h: 0.2, z: 5 }),
        ],
      };
  }
}

/** Display name for the object list / inspector: user-given name > text content > type label. */
export function objectLabel(o: PrinterObject): string {
  const truncate = (s: string) => (s.length > 18 ? `${s.slice(0, 18)}…` : s);
  const name = (o.name ?? "").trim();
  if (name) return truncate(name);
  if (o.type !== "text") return TYPE_LABEL[o.type];
  const t = (o.text ?? "").trim();
  return t ? truncate(t) : "Text";
}

/** The screen's palette override, or null to use the global palette. */
export function screenColors(config: PrinterConfig, screen: PrinterScreen): ScreenColors | null {
  return config.screens[screen].colors ?? null;
}

/** Replace one screen's objects, preserving its other fields (e.g. colors). */
export function withScreenObjects(
  config: PrinterConfig,
  screen: PrinterScreen,
  objects: PrinterObject[],
): PrinterConfig {
  return {
    ...config,
    screens: { ...config.screens, [screen]: { ...config.screens[screen], objects } },
  };
}

/** Set (or remove, with null) one screen's palette override, preserving its objects. */
export function withScreenColors(
  config: PrinterConfig,
  screen: PrinterScreen,
  colors: ScreenColors | null,
): PrinterConfig {
  const entry = config.screens[screen];
  const next: ScreenLayout = colors
    ? { ...entry, colors }
    : { objects: entry.objects }; // rebuild without the key so JSON stays clean
  return { ...config, screens: { ...config.screens, [screen]: next } };
}

/** Clamp a box onto the canvas with a minimum size. */
function sanitizeBox(o: Record<string, unknown>, d: Pick<PrinterObject, "x" | "y" | "w" | "h">) {
  const w = clamp(num(o.w, d.w), MIN_BOX, 1);
  const h = clamp(num(o.h, d.h), MIN_BOX, 1);
  const x = clamp(num(o.x, d.x), 0, 1 - w);
  const y = clamp(num(o.y, d.y), 0, 1 - h);
  return { x, y, w, h };
}

/**
 * Coerce arbitrary stored data into a valid v2 PrinterLayout. Non-v2 input (incl.
 * legacy v1 sx/sy layouts) is reset to the default. Guarantees one of each fixed
 * widget, ≤ MAX_CUSTOM valid text objects, clamped boxes/fonts, a known timezone,
 * and wifi 0..4. Never throws.
 */
export function normalizePrinterLayout(raw: unknown): PrinterLayout {
  const r = raw as { version?: unknown; objects?: unknown; clockTimezone?: unknown; clock24h?: unknown; wifiLevel?: unknown } | null;
  if (!r || typeof r !== "object" || r.version !== 2 || !Array.isArray(r.objects)) {
    return defaultLayout();
  }
  const list = r.objects as Record<string, unknown>[];

  // 1) Fixed widgets — one of each, in default z order.
  const objects: PrinterObject[] = FIXED_TYPES.map((type, i) => {
    const found = list.find((o) => o && o.type === type) ?? {};
    return {
      id: type,
      type,
      ...sanitizeBox(found, FIXED_DEFAULTS[type]),
      visible: typeof found.visible === "boolean" ? found.visible : true,
      z: typeof found.z === "number" && Number.isFinite(found.z) ? found.z : i,
    };
  });

  // 2) Text objects, capped.
  let zNext = FIXED_TYPES.length;
  let kept = 0;
  for (const o of list) {
    if (kept >= MAX_CUSTOM) break;
    if (!o || o.type !== "text" || typeof o.text !== "string" || o.text.trim() === "") continue;
    const align = ALIGNS.includes(o.align as TextAlign) ? (o.align as TextAlign) : "center";
    objects.push({
      id: typeof o.id === "string" && o.id ? o.id : `text-${kept}`,
      type: "text",
      ...sanitizeBox(o, { x: 0.35, y: 0.45, w: 0.3, h: 0.1 }),
      visible: typeof o.visible === "boolean" ? o.visible : true,
      z: typeof o.z === "number" && Number.isFinite(o.z) ? o.z : zNext++,
      text: o.text.slice(0, MAX_TEXT_LEN),
      fontSize: clamp(num(o.fontSize, DEFAULT_FONT.text), FONT_MIN, FONT_MAX),
      align,
    });
    kept++;
  }

  const tz = typeof r.clockTimezone === "string" && isValidTimezone(r.clockTimezone)
    ? r.clockTimezone
    : "UTC";

  return {
    version: 2,
    clockTimezone: tz,
    clock24h: typeof r.clock24h === "boolean" ? r.clock24h : false,
    wifiLevel: clamp(Math.round(num(r.wifiLevel, 3)), 0, 4),
    objects,
  };
}

// ─── Task 2: v2→v3 migration + normalizePrinterConfig ──────────────────────────

// "warn" was retired 2026-07-12 (error screen now uses brand colors like every
// other screen); stored configs carrying it normalize to "accent" below.
const ICON_TINTS = ["accent", "muted", "none"] as const satisfies readonly IconTint[];

function sanitizeIcon(raw: unknown): PrinterIcon {
  const r = (raw ?? {}) as Record<string, unknown>;
  const source = r.source === "upload" ? "upload" : "preset";
  const tint = ICON_TINTS.includes(r.tint as IconTint) ? (r.tint as IconTint) : "accent";
  const circle = typeof r.circle === "boolean" ? r.circle : false;
  if (source === "upload" && typeof r.url === "string" && r.url) {
    return { source: "upload", url: r.url, tint, circle };
  }
  const preset = (ICON_PRESETS as readonly string[]).includes(r.preset as string)
    ? (r.preset as IconPreset)
    : DEFAULT_ICON_PRESET;
  return { source: "preset", preset, tint, circle };
}

function sanitizeImage(raw: unknown): PrinterImage {
  const r = (raw ?? {}) as Record<string, unknown>;
  // Keep only the canonical R2 key; drop signedUrl (display-only) and anything else.
  return typeof r.url === "string" && r.url ? { url: r.url } : {};
}

function sanitizeClock(raw: unknown): PrinterClockOptions {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    showDate: typeof r.showDate === "boolean" ? r.showDate : true,
    showWeekday: typeof r.showWeekday === "boolean" ? r.showWeekday : true,
  };
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Valid = all four tokens are 3- or 6-digit hex; normalized to 6-digit #-prefixed
 *  lowercase (#abc → #aabbcc — the hex inputs accept shorthand, so normalize must
 *  not drop it). Else null. */
function sanitizeScreenColors(raw: unknown): ScreenColors | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<ScreenColors> = {};
  for (const key of ["accent", "bg", "fg", "muted"] as const) {
    const m = typeof r[key] === "string" ? (r[key] as string).match(HEX) : null;
    if (!m) return null;
    const hex = m[1].toLowerCase();
    out[key] = `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
  }
  return out as ScreenColors;
}

/** Default box for a widget singleton (used when a stored object is malformed). */
const WIDGET_BOX: Record<WidgetType, Pick<PrinterObject, "x" | "y" | "w" | "h">> = {
  clock: { x: 0.25, y: 0.52, w: 0.5, h: 0.18 },
  wifi: { x: 0.82, y: 0.04, w: 0.1, h: 0.06 },
  qr: { x: 0.32, y: 0.3, w: 0.36, h: 0.36 },
  spinner: { x: 0.42, y: 0.34, w: 0.16, h: 0.16 },
  countdown: { x: 0.3, y: 0.8, w: 0.4, h: 0.1 },
  pairingCode: { x: 0.25, y: 0.66, w: 0.3, h: 0.12 },
  steps: { x: 0.18, y: 0.34, w: 0.64, h: 0.28 },
};

/** Coerce one stored object into a valid PrinterObject of a known type, or null to drop it. */
function sanitizeObject(raw: unknown, fallbackZ: number): PrinterObject | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const type = o.type;
  if (!(OBJECT_TYPES as readonly string[]).includes(type as string)) return null;
  // Brand-name wordmark retired 2026-07-13 — drop stored logo objects everywhere.
  if (type === "logo") return null;
  const z = typeof o.z === "number" && Number.isFinite(o.z) ? o.z : fallbackZ;
  const visible = typeof o.visible === "boolean" ? o.visible : true;
  const id = typeof o.id === "string" && o.id ? o.id : `${String(type)}-${fallbackZ}`;
  const name = typeof o.name === "string" && o.name.trim()
    ? o.name.trim().slice(0, MAX_NAME_LEN)
    : undefined;

  if (type === "text") {
    if (typeof o.text !== "string" || o.text.trim() === "") return null;
    return {
      id, type: "text", z, visible, name,
      ...sanitizeBox(o, { x: 0.35, y: 0.45, w: 0.3, h: 0.1 }),
      text: o.text.slice(0, MAX_TEXT_LEN),
      fontSize: clamp(num(o.fontSize, DEFAULT_FONT.text), FONT_MIN, FONT_MAX),
      align: ALIGNS.includes(o.align as TextAlign) ? (o.align as TextAlign) : "center",
    };
  }
  if (type === "icon") {
    return {
      id, type: "icon", z, visible, name,
      ...sanitizeBox(o, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }),
      icon: sanitizeIcon(o.icon),
    };
  }
  if (type === "image") {
    return {
      id, type: "image", z, visible, name,
      ...sanitizeBox(o, { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }),
      image: sanitizeImage(o.image),
    };
  }
  if (type === "clock") {
    return {
      id, type: "clock", z, visible, name,
      ...sanitizeBox(o, WIDGET_BOX.clock),
      align: ALIGNS.includes(o.align as TextAlign) ? (o.align as TextAlign) : "center",
      clock: sanitizeClock(o.clock),
    };
  }
  // widget singleton
  const wt = type as WidgetType;
  return {
    id, type: wt, z, visible, name,
    ...sanitizeBox(o, WIDGET_BOX[wt]),
  };
}

/** Normalize one screen's objects: ≥0 widget singletons (deduped) + capped addables. */
function sanitizeScreen(raw: unknown, screen: PrinterScreen): ScreenLayout {
  const r = (raw ?? {}) as { objects?: unknown; colors?: unknown };
  if (!Array.isArray(r.objects)) return seededScreen(screen);
  const list = r.objects as unknown[];

  const out: PrinterObject[] = [];
  const seenWidget = new Set<string>();
  let addable = 0;
  let zNext = 0;
  for (const item of list) {
    const o = sanitizeObject(item, zNext++);
    if (!o) continue;
    if (o.type === "text" || o.type === "icon" || o.type === "image") {
      if (addable >= MAX_CUSTOM) continue;
      addable++;
    } else {
      if (seenWidget.has(o.type)) continue; // one of each widget per screen
      seenWidget.add(o.type);
    }
    out.push(o);
  }
  const colors = sanitizeScreenColors(r.colors);
  // If a screen was emptied to nothing, fall back to its seed so it isn't blank.
  return {
    objects: out.length ? out : seededScreen(screen).objects,
    ...(colors ? { colors } : {}),
  };
}

/** Migrate a v2 PrinterLayout into a v3 config: idle = its objects (minus the
 *  retired logo wordmark), others seeded. */
export function migrateV2ToConfig(layout: PrinterLayout): PrinterConfig {
  const screens = {} as Record<PrinterScreen, ScreenLayout>;
  for (const s of PRINTER_SCREENS) {
    screens[s] = s === "idle"
      ? { objects: layout.objects.filter((o) => o.type !== "logo") }
      : seededScreen(s);
  }
  return {
    version: 3,
    clockTimezone: layout.clockTimezone,
    clock24h: layout.clock24h,
    wifiLevel: layout.wifiLevel,
    qrTimeoutSeconds: 60,
    screens,
  };
}

/**
 * Coerce arbitrary stored data into a valid v3 PrinterConfig. Accepts v3 directly,
 * migrates v2, and resets anything else to the fully-seeded default. Never throws.
 */
export function normalizePrinterConfig(raw: unknown): PrinterConfig {
  const r = raw as { version?: unknown } | null;

  // v2 stored layout → migrate (run it through the v2 normalizer first for safety).
  if (r && typeof r === "object" && r.version === 2) {
    return migrateV2ToConfig(normalizePrinterLayout(r));
  }

  // Default fully-seeded config (also the v1/garbage fallback).
  const seededAll = (): PrinterConfig => {
    const screens = {} as Record<PrinterScreen, ScreenLayout>;
    for (const s of PRINTER_SCREENS) screens[s] = seededScreen(s);
    return { version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60, screens };
  };

  if (!r || typeof r !== "object" || r.version !== 3) return seededAll();

  const cfg = r as Record<string, unknown>;
  const rawScreens = (cfg.screens ?? {}) as Record<string, unknown>;
  const screens = {} as Record<PrinterScreen, ScreenLayout>;
  for (const s of PRINTER_SCREENS) screens[s] = sanitizeScreen(rawScreens[s], s);

  const tz = typeof cfg.clockTimezone === "string" && isValidTimezone(cfg.clockTimezone)
    ? cfg.clockTimezone
    : "UTC";
  return {
    version: 3,
    clockTimezone: tz,
    clock24h: typeof cfg.clock24h === "boolean" ? cfg.clock24h : false,
    wifiLevel: clamp(Math.round(num(cfg.wifiLevel, 3)), 0, 4),
    qrTimeoutSeconds: clamp(Math.round(num(cfg.qrTimeoutSeconds, 60)), 15, 180),
    screens,
  };
}
