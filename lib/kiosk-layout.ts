// Kiosk idle-screen layout: which elements show, where (fractional 0..1 anchors
// so positions are resolution-independent on the scaling 720² canvas), how big,
// plus the live-clock timezone. Persisted per tenant as jsonb; always loaded
// through normalizeKioskLayout so malformed/old data can never break the render.
import { isValidTimezone } from "./timezones";

export const KIOSK_ELEMENT_IDS = ["logo", "clock", "wifi", "lane", "tagline"] as const;
export type KioskElementId = (typeof KIOSK_ELEMENT_IDS)[number];

export const KIOSK_ELEMENT_LABEL: Record<KioskElementId, string> = {
  logo: "Logo",
  clock: "Clock",
  wifi: "Wi-Fi signal",
  lane: "Lane label",
  tagline: "Tagline",
};

export interface KioskElement {
  id: KioskElementId;
  visible: boolean;
  /** Center anchor as a fraction of the square (0 = left/top, 1 = right/bottom). */
  x: number;
  y: number;
  /** Size multiplier. */
  scale: number;
}

export interface KioskLayout {
  version: 1;
  clockTimezone: string; // IANA
  clock24h: boolean;
  wifiLevel: number; // 0..4
  elements: KioskElement[];
}

export const SCALE_MIN = 0.5;
export const SCALE_MAX = 2;

const DEFAULT_ELEMENTS: Record<KioskElementId, Omit<KioskElement, "id">> = {
  lane: { visible: true, x: 0.27, y: 0.085, scale: 1 },
  wifi: { visible: true, x: 0.9, y: 0.085, scale: 1 },
  logo: { visible: true, x: 0.5, y: 0.4, scale: 1 },
  clock: { visible: true, x: 0.5, y: 0.62, scale: 1 },
  tagline: { visible: true, x: 0.5, y: 0.93, scale: 1 },
};

export const DEFAULT_KIOSK_LAYOUT: KioskLayout = {
  version: 1,
  clockTimezone: "UTC",
  clock24h: false,
  wifiLevel: 3,
  elements: KIOSK_ELEMENT_IDS.map((id) => ({ id, ...DEFAULT_ELEMENTS[id] })),
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Coerce arbitrary stored/loaded data into a valid KioskLayout: every element
 * present exactly once, coords clamped to [0,1], scale to [0.5,2], a known
 * timezone, wifi 0..4. Missing pieces fall back to the defaults.
 */
export function normalizeKioskLayout(raw: unknown): KioskLayout {
  const r = (raw ?? {}) as Partial<KioskLayout> & { elements?: unknown };
  const byId = new Map<KioskElementId, Partial<KioskElement>>();
  if (Array.isArray(r.elements)) {
    for (const e of r.elements as Partial<KioskElement>[]) {
      if (e && KIOSK_ELEMENT_IDS.includes(e.id as KioskElementId)) {
        byId.set(e.id as KioskElementId, e);
      }
    }
  }

  const elements: KioskElement[] = KIOSK_ELEMENT_IDS.map((id) => {
    const d = DEFAULT_ELEMENTS[id];
    const e = byId.get(id) ?? {};
    return {
      id,
      visible: typeof e.visible === "boolean" ? e.visible : d.visible,
      x: clamp(num(e.x, d.x), 0, 1),
      y: clamp(num(e.y, d.y), 0, 1),
      scale: clamp(num(e.scale, d.scale), SCALE_MIN, SCALE_MAX),
    };
  });

  const tz = typeof r.clockTimezone === "string" && isValidTimezone(r.clockTimezone)
    ? r.clockTimezone
    : DEFAULT_KIOSK_LAYOUT.clockTimezone;

  return {
    version: 1,
    clockTimezone: tz,
    clock24h: typeof r.clock24h === "boolean" ? r.clock24h : false,
    wifiLevel: clamp(Math.round(num(r.wifiLevel, 3)), 0, 4),
    elements,
  };
}
