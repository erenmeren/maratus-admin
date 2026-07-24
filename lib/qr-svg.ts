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

// ─── QR background corner radius, 2026-07-24 slider addendum ────────────────
// Replaces the earlier 2-value `qrCorner: "square" | "rounded"` enum with a
// continuous 0..100 slider (0 = square, 100 = pill-ish) — see
// lib/printer-layout.ts sanitizeQrStyle for the legacy-enum migration. Every
// render site (the SVG bg rect in components/qr-svg.tsx, the QrObject
// preview wrapper in printer-preview.tsx, the pinned-QR card in
// device-pin-control.tsx) computes its OWN pixel `dim` and calls this one
// function — no hard-coded `rx`/`rounded-lg` anywhere.

/**
 * FIRMWARE PARITY: mirrored in ditto-firmware qr_style.c — keep in sync.
 *
 * Background-plate corner radius, in px, for a box of pixel dimension `dim`:
 * 0 at slider value 0 (square), scaling linearly to 30% of `dim` at 100
 * (a soft, pill-ish rounding). Pure.
 */
export function qrCornerRadiusPx(dim: number, v: number): number {
  return Math.round(dim * 0.3 * (v / 100));
}

// ─── QR background-plate shadow (drop / neon), 2026-07-24 addendum ──────────
// Replaces the old `qrShadow: boolean` (see lib/printer-layout.ts sanitizeQrStyle)
// with a 3-way mode + intensity + color. Two independent renderers consume the
// same strength/color/size math so the studio/pin-card CSS previews track the
// SVG filter used by QrSvg exactly: `qrShadowBoxShadow`/`qrShadowCss` (CSS
// `box-shadow`, for the wrapper `<div>`s in printer-preview.tsx's QrObject and
// device-pin-control.tsx) and `qrShadowFilterSpec` (SVG `<filter>` primitives,
// for components/qr-svg.tsx).

export const QR_SHADOW_MODES = ["none", "drop", "neon"] as const;
export type QrShadowMode = (typeof QR_SHADOW_MODES)[number];

/** Canonical shadow/glow numbers, see `qrShadowParams`. All px fields share
 *  one unit — whatever unit `dim` was passed in. */
export interface QrShadowParams {
  /** Blur radius. This is the CSS `box-shadow` blur-radius value directly;
   *  the SVG filter halves it into a Gaussian `stdDeviation` (the standard
   *  CSS-filter/SVG blur-radius↔stdDeviation relationship, ≈2:1). */
  blurPx: number;
  /** Vertical offset (drop only; 0 for neon — an offset-0 halo has no
   *  "down" direction). */
  offsetYPx: number;
  /** Shadow-color opacity, 0..1 (drop only; neon paints at full color via
   *  two layered blur passes instead, so this is unused there). */
  alpha: number;
  /** Second, wider blur-pass radius — neon's outer halo (0 for drop, which
   *  is a single pass). */
  spreadPx: number;
}

/**
 * FIRMWARE PARITY: mirrored in ditto-firmware qr_style.c — keep in sync.
 *
 * Canonical shadow/glow numbers for the QR background plate, as a function
 * of the plate's OWN pixel dimension `dim` — every number below is
 * `dim`-relative (not a fixed px constant) so the effect reads the same
 * *proportional* size regardless of how large the QR is rendered (a studio
 * filmstrip thumbnail, the full-size canvas, the 128px pinned-QR card, or
 * the physical device's native QR) — this dim-relative math is the fix for
 * the "shadow looks different in the preview than on the printer" report:
 * before this addendum, blur/offset were fixed px constants independent of
 * how large the QR plate was actually rendered. At `dim = 100` these numbers
 * reduce to this formula's original (pre-scaling) constants: blur 4..24px,
 * offset 2px, alpha 0.25..0.75 — i.e. `dim = 100` is the reference unit.
 *
 * `qrShadowCss`/`qrShadowBoxShadow` (CSS `box-shadow`) and
 * `qrShadowFilterSpec` (SVG `<filter>`) both derive their numbers from this
 * one function — neither computes blur/offset/alpha independently, so there
 * is exactly one place to change the shadow "feel."
 */
export function qrShadowParams(mode: QrShadowMode, strength: number, dim: number): QrShadowParams {
  if (mode === "none") return { blurPx: 0, offsetYPx: 0, alpha: 0, spreadPx: 0 };
  const s = strength / 100;
  const blurPx = dim * (0.04 + 0.2 * s); // 4%..24% of dim (= 4..24px at dim=100)
  if (mode === "drop") {
    return { blurPx, offsetYPx: dim * 0.02, alpha: 0.25 + 0.5 * s, spreadPx: 0 };
  }
  return { blurPx, offsetYPx: 0, alpha: 1, spreadPx: blurPx * 2 }; // neon: full-color halo, wide pass = 2× the tight pass
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
 * for "none". Built from `qrShadowParams(mode, strength, dim)` — drop = one
 * soft shadow offset down; neon = two stacked zero-offset glows (tight +
 * wide), full color — a classic neon halo. `unit` formats each px number
 * (default plain `${px}px`); pass a container-relative formatter (e.g. the
 * studio canvas's `cq()`) when every other dimension on the same element
 * (padding, border-radius) is already expressed in that unit, so the shadow
 * scales in lockstep with the rest of the card instead of drifting at a
 * different zoom level.
 */
export function qrShadowCss(
  mode: QrShadowMode,
  strength: number,
  color: string,
  dim: number,
  unit: (px: number) => string = (px) => `${px}px`,
): string | undefined {
  if (mode === "none") return undefined;
  const p = qrShadowParams(mode, strength, dim);
  if (mode === "drop") {
    return `0 ${unit(p.offsetYPx)} ${unit(p.blurPx)} ${hexToRgba(color, p.alpha)}`;
  }
  return `0 0 ${unit(p.blurPx)} ${color}, 0 0 ${unit(p.spreadPx)} ${color}`;
}

/** Convenience wrapper over `qrShadowCss` with the default plain-px unit —
 *  used by the two preview wrappers whose box is a fixed real pixel size
 *  (device-pin-control.tsx's pin card, the branding studio's small swatch
 *  previews). printer-preview.tsx's QrObject calls `qrShadowCss` directly
 *  with its container-relative `cq()` unit instead. */
export function qrShadowBoxShadow(mode: QrShadowMode, strength: number, color: string, dim: number): string | undefined {
  return qrShadowCss(mode, strength, color, dim);
}

/** Parameters for the SVG `<filter>` QrSvg builds for the background-plate
 *  shadow — `null` for "none". Drop = one `feDropShadow` (color pre-mixed
 *  into `floodColor`). Neon = two stacked Gaussian-blur passes (tight +
 *  wide) recolored full-color, merged under the source — an offset-0
 *  glow/halo, not a shadow. Both derive their numbers from
 *  `qrShadowParams(mode, strength, dim)` — `dim` here is the SVG's own
 *  viewBox dimension, so the filter scales in lockstep with the rest of the
 *  QR when the SVG itself is displayed larger or smaller (browsers scale
 *  every viewBox-space number, filters included, uniformly). */
export type QrShadowFilterSpec =
  | { kind: "drop"; dy: number; stdDeviation: number; floodColor: string }
  | { kind: "neon"; stdDeviations: [tight: number, wide: number]; color: string };

export function qrShadowFilterSpec(mode: QrShadowMode, strength: number, color: string, dim: number): QrShadowFilterSpec | null {
  if (mode === "none") return null;
  const p = qrShadowParams(mode, strength, dim);
  if (mode === "drop") {
    return { kind: "drop", dy: p.offsetYPx, stdDeviation: p.blurPx / 2, floodColor: hexToRgba(color, p.alpha) };
  }
  return { kind: "neon", stdDeviations: [p.blurPx / 2, p.spreadPx / 2], color };
}
