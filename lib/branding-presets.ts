// Curated printer theme presets + palette derivation for the Branding studio.
// A theme is a complete printer look: accent + bg + fg + muted. Presets are
// hand-tuned for contrast on the 720×720 panel; derived palettes are computed
// from a single accent so tenants never have to hand-enter four hex codes.

import { hexToRgb, DEFAULT_BRAND_BG, DEFAULT_BRAND_FG, DEFAULT_BRAND_MUTED } from "@/lib/color";

export interface BrandTheme {
  id: string;
  name: string;
  /** Short vibe line shown under the name. */
  description: string;
  accent: string;
  bg: string;
  fg: string;
  muted: string;
}

export const BRAND_THEMES: BrandTheme[] = [
  {
    id: "warm-cafe",
    name: "Warm café",
    description: "Terracotta on cream — cozy, artisanal",
    accent: "#B4541F",
    bg: "#FAF6F0",
    fg: "#2B211A",
    muted: "#9A8B7D",
  },
  {
    id: "minimal-mono",
    name: "Minimal mono",
    description: "Ink on paper — quiet, editorial",
    accent: "#111827",
    bg: "#FFFFFF",
    fg: "#111827",
    muted: "#9CA3AF",
  },
  {
    id: "bold-retail",
    name: "Bold retail",
    description: "High-energy red — impossible to miss",
    accent: "#E5484D",
    bg: "#FFF8F7",
    fg: "#27191A",
    muted: "#A18C8D",
  },
  {
    id: "fresh-market",
    name: "Fresh market",
    description: "Garden green — organic, grocery",
    accent: "#3F9D4E",
    bg: "#F5FAF4",
    fg: "#1B2A1D",
    muted: "#87977F",
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Luminous violet on near-black",
    accent: "#9B8CFF",
    bg: "#121217",
    fg: "#F2F1FA",
    muted: "#8E8CA3",
  },
  {
    id: "espresso",
    name: "Espresso",
    description: "Amber glow on dark roast",
    accent: "#E8A33D",
    bg: "#1A1410",
    fg: "#F5EFE6",
    muted: "#9C8E7C",
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Deep blue — calm, trustworthy",
    accent: "#1F5C8B",
    bg: "#F4F8FB",
    fg: "#16222C",
    muted: "#7F93A3",
  },
  {
    id: "teal-spa",
    name: "Teal spa",
    description: "Sea-glass teal — fresh, modern",
    accent: "#0F766E",
    bg: "#F3FAF9",
    fg: "#132523",
    muted: "#7C9793",
  },
];

/** True when the theme's four tokens match the current draft (case-insensitive). */
export function themeMatches(t: BrandTheme, v: { accent: string; bg: string; fg: string; muted: string }): boolean {
  const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return eq(t.accent, v.accent) && eq(t.bg, v.bg) && eq(t.fg, v.fg) && eq(t.muted, v.muted);
}

// ---------------------------------------------------------------------------
// Palette derivation — one accent in, three complete palettes out.
// ---------------------------------------------------------------------------

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hn = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  const to255 = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  if (s === 0) {
    const v = to255(l);
    return `#${v}${v}${v}`;
  }
  return `#${to255(channel(hn + 1 / 3))}${to255(channel(hn))}${to255(channel(hn - 1 / 3))}`;
}

export interface DerivedPalette {
  id: "tinted" | "dark" | "neutral";
  name: string;
  bg: string;
  fg: string;
  muted: string;
}

/**
 * Derive three harmonious bg/fg/muted palettes from a single accent color:
 * a hue-tinted light surface, a deep dark surface, and the neutral default.
 * All values are hand-tuned lightness bands that keep body text ≥ WCAG AA
 * against the derived background for any accent hue.
 */
export function derivePalettes(accent: string): DerivedPalette[] {
  const [r, g, b] = hexToRgb(accent);
  const [h, s] = rgbToHsl(r, g, b);
  const tintS = Math.min(0.45, Math.max(0.12, s * 0.5));
  return [
    {
      id: "tinted",
      name: "Tinted light",
      bg: hslToHex(h, tintS, 0.965),
      fg: hslToHex(h, Math.min(0.5, tintS + 0.1), 0.12),
      muted: hslToHex(h, Math.min(0.25, tintS), 0.52),
    },
    {
      id: "dark",
      name: "Dark",
      bg: hslToHex(h, Math.min(0.35, tintS + 0.05), 0.09),
      fg: hslToHex(h, 0.12, 0.95),
      muted: hslToHex(h, 0.1, 0.6),
    },
    {
      id: "neutral",
      name: "Neutral",
      bg: DEFAULT_BRAND_BG,
      fg: DEFAULT_BRAND_FG,
      muted: DEFAULT_BRAND_MUTED,
    },
  ];
}
