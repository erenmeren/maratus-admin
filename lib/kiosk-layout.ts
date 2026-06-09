// Kiosk idle-screen layout: which elements show, where (fractional 0..1 center
// anchors so positions are resolution-independent on the scaling 720² canvas),
// and how big (sx/sy multipliers of each element's NATURAL size; 1 = natural,
// sx≠sy = free-stretch). Built-in elements are a fixed set; users may also add
// custom text elements (open id set). Persisted per tenant as jsonb; always
// loaded through normalizeKioskLayout so malformed/old data can never break the
// render (it also migrates the legacy single `scale` field to sx=sy=scale).
import { isValidTimezone } from "./timezones";

export const BUILTIN_IDS = ["logo", "clock", "wifi", "lane", "tagline"] as const;
export type BuiltinId = (typeof BUILTIN_IDS)[number];

export const KIOSK_ELEMENT_LABEL: Record<BuiltinId, string> = {
  logo: "Logo",
  clock: "Clock",
  wifi: "Wi-Fi signal",
  lane: "Lane label",
  tagline: "Tagline",
};

export interface KioskElement {
  id: string;             // builtin id, or "text-<rand>" for custom
  kind: "builtin" | "text";
  builtin?: BuiltinId;    // present when kind === "builtin"
  text?: string;          // present when kind === "text"
  visible: boolean;
  x: number;              // center anchor, fraction 0..1
  y: number;
  sx: number;             // width multiplier of natural size (1 = natural)
  sy: number;             // height multiplier of natural size
  z: number;              // stacking order
}

export interface KioskLayout {
  version: 1;
  clockTimezone: string; // IANA
  clock24h: boolean;
  wifiLevel: number; // 0..4
  elements: KioskElement[];
}

export const SCALE_MIN = 0.2;
export const SCALE_MAX = 6;
export const MAX_CUSTOM = 20;
export const MAX_TEXT_LEN = 80;

const DEFAULT_BUILTIN: Record<BuiltinId, { visible: boolean; x: number; y: number }> = {
  lane: { visible: true, x: 0.27, y: 0.085 },
  wifi: { visible: true, x: 0.9, y: 0.085 },
  logo: { visible: true, x: 0.5, y: 0.4 },
  clock: { visible: true, x: 0.5, y: 0.62 },
  tagline: { visible: true, x: 0.5, y: 0.93 },
};

export const DEFAULT_KIOSK_LAYOUT: KioskLayout = {
  version: 1,
  clockTimezone: "UTC",
  clock24h: false,
  wifiLevel: 3,
  elements: BUILTIN_IDS.map((id, i) => ({
    id,
    kind: "builtin" as const,
    builtin: id,
    visible: DEFAULT_BUILTIN[id].visible,
    x: DEFAULT_BUILTIN[id].x,
    y: DEFAULT_BUILTIN[id].y,
    sx: 1,
    sy: 1,
    z: i,
  })),
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Read sx/sy, falling back to a legacy single `scale`, then to 1. */
function readScale(e: Record<string, unknown>, axis: "sx" | "sy"): number {
  const legacy = e.scale;
  const v = num(e[axis], num(legacy, 1));
  return clamp(v, SCALE_MIN, SCALE_MAX);
}

/** A fresh custom text element, centered at natural size, on top (`z`). */
export function createTextElement(text: string, z: number): KioskElement {
  const rand = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.floor(Math.random() * 1e9).toString(36);
  return {
    id: `text-${rand}`,
    kind: "text",
    text: text.slice(0, MAX_TEXT_LEN),
    visible: true,
    x: 0.5,
    y: 0.5,
    sx: 1,
    sy: 1,
    z,
  };
}

/** Display name for the element list / inspector. */
export function elementLabel(e: KioskElement): string {
  if (e.kind === "builtin" && e.builtin) return KIOSK_ELEMENT_LABEL[e.builtin];
  const t = (e.text ?? "").trim();
  return t ? (t.length > 18 ? `${t.slice(0, 18)}…` : t) : "Text";
}

/**
 * Coerce arbitrary stored/loaded data into a valid KioskLayout: all 5 built-ins
 * present exactly once (re-added if missing), plus up to MAX_CUSTOM valid custom
 * text elements. Coords clamped to [0,1], sx/sy to [SCALE_MIN,SCALE_MAX], a known
 * timezone, wifi 0..4. Legacy `scale` migrates to sx=sy=scale. Unknown ids and
 * text-less custom elements are dropped.
 */
export function normalizeKioskLayout(raw: unknown): KioskLayout {
  const r = (raw ?? {}) as Partial<KioskLayout> & { elements?: unknown };
  const list = Array.isArray(r.elements) ? (r.elements as unknown as Record<string, unknown>[]) : [];
  const byBuiltin = new Map<BuiltinId, Record<string, unknown>>();
  for (const e of list) {
    const id = e?.id as string;
    if (BUILTIN_IDS.includes(id as BuiltinId)) byBuiltin.set(id as BuiltinId, e);
  }

  // 1) Built-ins, in their default z order.
  const elements: KioskElement[] = BUILTIN_IDS.map((id, i) => {
    const d = DEFAULT_BUILTIN[id];
    const e = byBuiltin.get(id) ?? {};
    return {
      id,
      kind: "builtin" as const,
      builtin: id,
      visible: typeof e.visible === "boolean" ? e.visible : d.visible,
      x: clamp(num(e.x, d.x), 0, 1),
      y: clamp(num(e.y, d.y), 0, 1),
      sx: readScale(e, "sx"),
      sy: readScale(e, "sy"),
      z: typeof e.z === "number" && Number.isFinite(e.z) ? e.z : i,
    };
  });

  // 2) Custom text elements (open id set), capped.
  let zNext = BUILTIN_IDS.length;
  let kept = 0;
  for (const e of list) {
    if (kept >= MAX_CUSTOM) break;
    const id = e?.id as string;
    if (!id || BUILTIN_IDS.includes(id as BuiltinId)) continue;
    if (e.kind !== "text" || typeof e.text !== "string" || e.text.trim() === "") continue;
    elements.push({
      id,
      kind: "text",
      text: e.text.slice(0, MAX_TEXT_LEN),
      visible: typeof e.visible === "boolean" ? e.visible : true,
      x: clamp(num(e.x, 0.5), 0, 1),
      y: clamp(num(e.y, 0.5), 0, 1),
      sx: readScale(e, "sx"),
      sy: readScale(e, "sy"),
      z: typeof e.z === "number" && Number.isFinite(e.z) ? e.z : zNext++,
    });
    kept++;
  }

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
