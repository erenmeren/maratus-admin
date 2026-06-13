/** Pure helpers for the Branding studio shell (zoom + screen carousel). */

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 125;
export const ZOOM_STEP = 5;
export const ZOOM_DEFAULT = 100;

/**
 * Preview canvas width (px) at 100% zoom = the printer's NATIVE resolution.
 * The device (Waveshare ESP32-P4-WIFI6-Touch-LCD-4B) is a 720×720 square panel,
 * so 100% renders 1 preview px per device px (true device pixels). The editor's
 * viewport cap may scale this down to fit a short window, but the zoom % stays
 * anchored to the real device resolution.
 */
export const PREVIEW_BASE_PX = 720;

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
