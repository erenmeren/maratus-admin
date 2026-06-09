// Pure resize geometry for the kiosk editor. Operates on the element's VISUAL
// rectangle in canvas fractions (0..1); no React/DOM so it is unit-testable.
// The component converts the result back into sx/sy multipliers and x/y center.

export interface Box {
  cx: number; // center x, fraction 0..1
  cy: number; // center y, fraction 0..1
  w: number;  // width, fraction 0..1
  h: number;  // height, fraction 0..1
}

/** The 8 resize handles. n/s/e/w = edges; nw/ne/sw/se = corners. */
export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];

/** Minimum visual size as a fraction of the canvas — keeps elements grabbable. */
export const MIN_BOX = 0.04;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Resize `box` by dragging `handle` to `pointer` (canvas fractions). The edge or
 * corner opposite the handle stays fixed. Corners with `keepAspect` lock the
 * original w:h ratio (driven by the horizontal delta). Result width/height are
 * floored at MIN_BOX and never invert past the fixed anchor.
 */
export function resizeBox(box: Box, handle: Handle, pointer: { x: number; y: number }, keepAspect: boolean): Box {
  let left = box.cx - box.w / 2;
  let right = box.cx + box.w / 2;
  let top = box.cy - box.h / 2;
  let bottom = box.cy + box.h / 2;

  const movesE = handle === "e" || handle === "ne" || handle === "se";
  const movesW = handle === "w" || handle === "nw" || handle === "sw";
  const movesS = handle === "s" || handle === "se" || handle === "sw";
  const movesN = handle === "n" || handle === "ne" || handle === "nw";

  if (movesE) right = pointer.x;
  if (movesW) left = pointer.x;
  if (movesS) bottom = pointer.y;
  if (movesN) top = pointer.y;

  let w = right - left;
  let h = bottom - top;

  // Floor each dimension to MIN_BOX and re-anchor the moving edge so the
  // fixed edge never shifts. This avoids floating-point drift from computing
  // MIN_BOX via addition/subtraction (e.g. 0.4 + 0.04 - 0.4 ≠ 0.04 exactly).
  if (movesE && w < MIN_BOX) { w = MIN_BOX; right = left + MIN_BOX; }
  if (movesW && w < MIN_BOX) { w = MIN_BOX; left = right - MIN_BOX; }
  if (movesS && h < MIN_BOX) { h = MIN_BOX; bottom = top + MIN_BOX; }
  if (movesN && h < MIN_BOX) { h = MIN_BOX; top = bottom - MIN_BOX; }

  // Corner drag: lock aspect ratio, driven by the new width.
  const isCorner = handle.length === 2; // "nw"/"ne"/"sw"/"se" vs single-char edges
  if (isCorner && keepAspect && box.h > 0) {
    const aspect = box.w / box.h;
    h = Math.max(MIN_BOX, w / aspect);
    // Re-anchor height to the fixed vertical edge.
    if (movesS) bottom = top + h;
    if (movesN) top = bottom - h;
  }

  return { cx: (left + right) / 2, cy: (top + bottom) / 2, w, h };
}

/** Keep an element's center on-canvas (size may overhang the edges). */
export function clampCenter(box: Box): Box {
  return { ...box, cx: clamp(box.cx, 0, 1), cy: clamp(box.cy, 0, 1) };
}
