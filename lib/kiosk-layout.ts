// Kiosk idle-screen layout (v2): a list of objects, each a real box (top-left
// x/y + w/h as fractions of the 720² canvas, resolution-independent). Object
// types: text (editable content + font size + align), and the fixed widgets
// logo/clock/wifi (one each, hideable, not deletable). Persisted per tenant as
// jsonb; always loaded through normalizeKioskLayout so malformed/old (v1) data
// can never break the render — v1 layouts are reset to the default.
import { isValidTimezone } from "./timezones";
import { MIN_BOX } from "./kiosk-geometry";

export const OBJECT_TYPES = ["text", "logo", "clock", "wifi"] as const;
export type KioskObjectType = (typeof OBJECT_TYPES)[number];

export const FIXED_TYPES = ["logo", "clock", "wifi"] as const;
export type FixedType = (typeof FIXED_TYPES)[number];

export const TYPE_LABEL: Record<KioskObjectType, string> = {
  text: "Text",
  logo: "Logo",
  clock: "Clock",
  wifi: "Wi-Fi signal",
};

export type TextAlign = "left" | "center" | "right";

export interface KioskObject {
  id: string;
  type: KioskObjectType;
  x: number; // top-left, fraction 0..1
  y: number;
  w: number; // size, fraction 0..1
  h: number;
  visible: boolean;
  z: number;
  text?: string;
  fontSize?: number; // px on the 720 reference
  align?: TextAlign;
}

export interface KioskLayout {
  version: 2;
  clockTimezone: string;
  clock24h: boolean;
  wifiLevel: number; // 0..4
  objects: KioskObject[];
}

export const FONT_MIN = 8;
export const FONT_MAX = 160;
export const MAX_CUSTOM = 20;
export const MAX_TEXT_LEN = 80;

const ALIGNS: TextAlign[] = ["left", "center", "right"];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Default box + props for each fixed widget, reproducing today's arrangement. */
const FIXED_DEFAULTS: Record<FixedType, Pick<KioskObject, "x" | "y" | "w" | "h">> = {
  wifi: { x: 0.82, y: 0.04, w: 0.1, h: 0.06 },
  logo: { x: 0.3, y: 0.28, w: 0.4, h: 0.22 },
  clock: { x: 0.25, y: 0.52, w: 0.5, h: 0.18 },
};

/** Two seeded text objects (the old lane + tagline lines), now editable. */
function seededText(): KioskObject[] {
  return [
    { id: "text-lane", type: "text", x: 0.06, y: 0.05, w: 0.4, h: 0.06, visible: true, z: 3, text: "Lane 1", fontSize: 19, align: "left" },
    { id: "text-tagline", type: "text", x: 0.15, y: 0.88, w: 0.7, h: 0.08, visible: true, z: 4, text: "Tap your card or pay at the reader to begin", fontSize: 18, align: "center" },
  ];
}

/** A fresh default layout (new object each call so callers can't mutate it). */
export function defaultLayout(): KioskLayout {
  const fixed: KioskObject[] = FIXED_TYPES.map((type, i) => ({
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
    objects: [...fixed, ...seededText()],
  };
}

export const DEFAULT_KIOSK_LAYOUT: KioskLayout = defaultLayout();

const DEFAULT_FONT: Record<KioskObjectType, number> = { text: 24, logo: 24, clock: 24, wifi: 24 };

/** A fresh custom text object, centered, on top (`z`). */
export function createTextObject(text: string, z: number): KioskObject {
  const rand = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.floor(Math.random() * 1e9).toString(36);
  return {
    id: `text-${rand}`,
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

/** Display name for the object list / inspector. */
export function objectLabel(o: KioskObject): string {
  if (o.type !== "text") return TYPE_LABEL[o.type];
  const t = (o.text ?? "").trim();
  return t ? (t.length > 18 ? `${t.slice(0, 18)}…` : t) : "Text";
}

/** Clamp a box onto the canvas with a minimum size. */
function sanitizeBox(o: Record<string, unknown>, d: Pick<KioskObject, "x" | "y" | "w" | "h">) {
  const w = clamp(num(o.w, d.w), MIN_BOX, 1);
  const h = clamp(num(o.h, d.h), MIN_BOX, 1);
  const x = clamp(num(o.x, d.x), 0, 1 - w);
  const y = clamp(num(o.y, d.y), 0, 1 - h);
  return { x, y, w, h };
}

/**
 * Coerce arbitrary stored data into a valid v2 KioskLayout. Non-v2 input (incl.
 * legacy v1 sx/sy layouts) is reset to the default. Guarantees one of each fixed
 * widget, ≤ MAX_CUSTOM valid text objects, clamped boxes/fonts, a known timezone,
 * and wifi 0..4. Never throws.
 */
export function normalizeKioskLayout(raw: unknown): KioskLayout {
  const r = raw as { version?: unknown; objects?: unknown; clockTimezone?: unknown; clock24h?: unknown; wifiLevel?: unknown } | null;
  if (!r || typeof r !== "object" || r.version !== 2 || !Array.isArray(r.objects)) {
    return defaultLayout();
  }
  const list = r.objects as Record<string, unknown>[];

  // 1) Fixed widgets — one of each, in default z order.
  const objects: KioskObject[] = FIXED_TYPES.map((type, i) => {
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
