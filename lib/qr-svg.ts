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
