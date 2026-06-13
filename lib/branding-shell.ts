/** Pure helpers for the Branding studio shell (zoom + screen carousel). */

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 5;
export const ZOOM_DEFAULT = 100;

/**
 * Preview canvas width (px) at 100% zoom = the printer's PHYSICAL screen size,
 * NOT its pixel resolution. The device (Waveshare ESP32-P4-WIFI6-Touch-LCD-4B)
 * is a 4-inch diagonal, 1:1 square panel → side ≈ 4"/√2 ≈ 2.83" ≈ 71.8 mm.
 * At CSS's 96 px/inch reference that's ≈ 272 px, so 100% shows the preview at
 * roughly the real 4" device size. (Approximate: browsers anchor physical units
 * to 96 dpi, so exact on-screen size varies with the monitor's true DPI.)
 * Zoom in (up to 200%) to edit detail; the full 720×720 design is always shown,
 * just scaled to this physical size.
 */
export const PREVIEW_BASE_PX = 272;

/** Clamp a zoom percentage to [MIN, MAX], snapped to the nearest step. */
export function clampZoom(pct: number): number {
  if (!Number.isFinite(pct)) return ZOOM_DEFAULT;
  const stepped = Math.round(pct / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped));
}

/** The preview canvas width in px for a given zoom percentage. */
export function zoomToPx(pct: number): number {
  return Math.round((PREVIEW_BASE_PX * clampZoom(pct)) / 100);
}

/** Step an index by dir (-1 | +1) with wrap-around. Safe for len <= 0. */
export function stepIndex(current: number, dir: number, len: number): number {
  if (len <= 0) return 0;
  return (current + dir + len) % len;
}

/**
 * How many screens a horizontal swipe should advance.
 * deltaX < 0 (dragged left) → +1 (next); deltaX > 0 → -1 (prev).
 * Returns 0 unless the drag exceeds `threshold` of the frame width.
 */
export function swipeStep(deltaX: number, width: number, threshold = 0.25): number {
  if (width <= 0) return 0;
  const frac = deltaX / width;
  if (frac <= -threshold) return 1;
  if (frac >= threshold) return -1;
  return 0;
}
