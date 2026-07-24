// Pure matrix → SVG geometry helpers for the styled ("rounded dot module") QR
// look, matching the firmware's on-device QR render. Client-safe, no DOM/React
// dependency — consumed by components/qr-svg.tsx (the shared React renderer
// used by both the branding studio's QrObject preview and the pinned-QR card).

/**
 * True if (row, col) lies inside one of the three 7×7 finder-pattern corner
 * squares of a QR matrix of the given size (top-left, top-right, bottom-left).
 * Individual dot-modules there are skipped — the finder pattern is drawn as
 * one rounded shape instead (see `finderOrigins`).
 */
export function isFinderCell(row: number, col: number, size: number): boolean {
  const topRow = row < 7;
  const bottomRow = row >= size - 7;
  const leftCol = col < 7;
  const rightCol = col >= size - 7;
  return (topRow && leftCol) || (topRow && rightCol) || (bottomRow && leftCol);
}

/** Top-left [row, col] origin of each of the three finder-pattern squares. */
export function finderOrigins(size: number): [row: number, col: number][] {
  return [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ];
}

/** One dark module to render as a rounded dot (finder-pattern cells excluded). */
export interface QrDot {
  row: number;
  col: number;
}

/** Given a QR matrix accessor (from `qrcode`'s `QRCode.create(...).modules`),
 *  the list of dark, non-finder module positions to render as dots. */
export function darkDots(size: number, isDark: (row: number, col: number) => boolean): QrDot[] {
  const dots: QrDot[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (isFinderCell(row, col, size)) continue;
      if (isDark(row, col)) dots.push({ row, col });
    }
  }
  return dots;
}

// ─── QR style (shape + colors), 2026-07-23 ───────────────────────────────────
// Org-wide QR appearance, stored in the printer config JSON (see
// lib/printer-layout.ts sanitizeQrStyle). Geometry here is pure data — no
// DOM/React — so it's shared by components/qr-svg.tsx (render) and tested
// directly.

export const QR_SHAPES = ["classic", "soft", "rounded", "dots"] as const;
export type QrShape = (typeof QR_SHAPES)[number];

/** Per-shape rendering geometry, expressed as fractions of one module unit
 *  (finderRadiusRatio is a fraction of each finder rect's OWN edge length,
 *  matching the existing "rounded" finder math). */
export interface QrShapeGeometry {
  moduleKind: "rect" | "circle";
  /** Rect corner radius, as a fraction of the module unit (rect shapes only). */
  moduleRx: number;
  /** Circle radius, as a fraction of the module unit (circle shapes only). */
  moduleR: number;
  /** Finder-pattern corner radius, as a fraction of the finder rect's own size. */
  finderRadiusRatio: number;
}

export const QR_SHAPE_GEOMETRY: Record<QrShape, QrShapeGeometry> = {
  // Plain squares — no rounding anywhere, closest to a "stock" QR code.
  classic: { moduleKind: "rect", moduleRx: 0, moduleR: 0, finderRadiusRatio: 0 },
  // Rounded-corner squares — a gentle, modern square look.
  soft: { moduleKind: "rect", moduleRx: 0.25, moduleR: 0, finderRadiusRatio: 1 / 8 },
  // Today's live look — dot modules, rounded finder squares. Unchanged from
  // the pre-QR-style-options render (r ≈ 0.425 × module, ratio 1/3).
  rounded: { moduleKind: "circle", moduleRx: 0, moduleR: 0.425, finderRadiusRatio: 1 / 3 },
  // Smaller, more separated dots (diameter = 0.7 × module → r = 0.35).
  dots: { moduleKind: "circle", moduleRx: 0, moduleR: 0.35, finderRadiusRatio: 1 / 3 },
};

// ─── QR background corner + shadow, 2026-07-23 addendum ─────────────────────
// Independent of module `shape` — governs the QR's own background surface
// (the plate the modules sit on), matching the on-device render. See
// lib/printer-layout.ts sanitizeQrStyle + the 2026-07-23 spec addendum.

export const QR_CORNERS = ["square", "rounded"] as const;
export type QrCorner = (typeof QR_CORNERS)[number];

/** Background-rect corner radius, in px, for an SVG of the given pixel
 *  dimension: ~6% of `dim` when "rounded", 0 when "square". Pure — used by
 *  both the SVG bg rect (components/qr-svg.tsx) and any caller that needs to
 *  mirror the same radius on a wrapping element. */
export function qrBackgroundRadius(dim: number, corner: QrCorner): number {
  return corner === "rounded" ? dim * 0.06 : 0;
}

// ─── QR background-plate shadow (drop / neon), 2026-07-24 addendum ──────────
// Replaces the old `qrShadow: boolean` (see lib/printer-layout.ts sanitizeQrStyle)
// with a 3-way mode + intensity + color. Two independent renderers consume the
// same strength/color math so the studio/pin-card CSS previews track the SVG
// filter used by QrSvg: `qrShadowBoxShadow` (CSS `box-shadow`, for the wrapper
// `<div>`s in printer-preview.tsx's QrObject and device-pin-control.tsx) and
// `qrShadowFilterSpec` (SVG `<filter>` primitives, for components/qr-svg.tsx).

export const QR_SHADOW_MODES = ["none", "drop", "neon"] as const;
export type QrShadowMode = (typeof QR_SHADOW_MODES)[number];

/** Blur radius in px for strength 0..100 — shared shape by both renderers below
 *  (the two consumers scale it differently for their own units, see each fn). */
function shadowBlurPx(strength: number): number {
  return 4 + 20 * (strength / 100); // 4..24px
}

/** `#rrggbb` (already-normalized — callers always pass a sanitizeQrStyle output)
 *  + alpha 0..1 → `rgba(r, g, b, a)`. */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * CSS `box-shadow` value for the QR background-plate shadow, or `undefined`
 * for "none". Used by the two preview wrappers that paint the shadow with CSS
 * instead of an SVG filter (printer-preview.tsx QrObject, device-pin-control.tsx):
 * drop = one soft shadow offset down; neon = two stacked zero-offset glows
 * (tight + wide), full color — a classic neon halo.
 */
export function qrShadowBoxShadow(mode: QrShadowMode, strength: number, color: string): string | undefined {
  if (mode === "none") return undefined;
  const blur = shadowBlurPx(strength);
  if (mode === "drop") {
    const opacity = 0.25 + 0.5 * (strength / 100);
    return `0 2px ${blur}px ${hexToRgba(color, opacity)}`;
  }
  return `0 0 ${blur}px ${color}, 0 0 ${blur * 2}px ${color}`;
}

/** Parameters for the SVG `<filter>` QrSvg builds for the background-plate
 *  shadow — `null` for "none". Drop = one `feDropShadow` (dy≈2, stdDeviation
 *  ranging ≈1..12 with strength, color pre-mixed into `floodColor`). Neon =
 *  two stacked Gaussian-blur passes (tight + wide, both ∝ strength) recolored
 *  full-color, merged under the source — an offset-0 glow/halo, not a shadow. */
export type QrShadowFilterSpec =
  | { kind: "drop"; dy: number; stdDeviation: number; floodColor: string }
  | { kind: "neon"; stdDeviations: [tight: number, wide: number]; color: string };

export function qrShadowFilterSpec(mode: QrShadowMode, strength: number, color: string): QrShadowFilterSpec | null {
  if (mode === "none") return null;
  if (mode === "drop") {
    const opacity = 0.25 + 0.5 * (strength / 100);
    return { kind: "drop", dy: 2, stdDeviation: 1 + 11 * (strength / 100), floodColor: hexToRgba(color, opacity) };
  }
  return {
    kind: "neon",
    stdDeviations: [2 + 6 * (strength / 100), 6 + 18 * (strength / 100)],
    color,
  };
}
