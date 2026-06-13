// Pure resize + snap geometry for the printer editor. Operates on a top-left box in
// canvas fractions (0..1); no React/DOM so it is unit-testable.

export interface Box {
  x: number; // left, fraction 0..1
  y: number; // top, fraction 0..1
  w: number; // width, fraction 0..1
  h: number; // height, fraction 0..1
}

/** The 8 resize handles. n/s/e/w = edges; nw/ne/sw/se = corners. */
export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];

/** Active alignment guide lines to draw: vertical at x's, horizontal at y's. */
export interface Guides {
  vx: number[];
  hy: number[];
}

/** Minimum box size as a fraction of the canvas — keeps objects grabbable. */
export const MIN_BOX = 0.04;

/** Distance tie-break epsilon for snapping (ignore sub-nanometer float noise). */
const SNAP_EPS = 1e-9;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Resize `box` by dragging `handle` to `pointer` (canvas fractions). The edge or
 * corner opposite the handle stays fixed; width/height are floored at MIN_BOX and
 * never invert.
 */
export function resizeBox(box: Box, handle: Handle, pointer: { x: number; y: number }): Box {
  let left = box.x;
  let top = box.y;
  let right = box.x + box.w;
  let bottom = box.y + box.h;

  const movesE = handle.includes("e");
  const movesW = handle.includes("w");
  const movesS = handle.includes("s");
  const movesN = handle.includes("n");

  if (movesE) right = pointer.x;
  if (movesW) left = pointer.x;
  if (movesS) bottom = pointer.y;
  if (movesN) top = pointer.y;

  // Enforce the MIN_BOX floor by setting the dimension exactly and re-anchoring
  // the moving edge — avoids floating-point underflow from re-subtraction
  // (e.g. (0.4 + 0.04) - 0.4 = 0.03999…).
  let w = right - left;
  let h = bottom - top;
  if (w < MIN_BOX) { w = MIN_BOX; if (movesW) left = right - MIN_BOX; else right = left + MIN_BOX; }
  if (h < MIN_BOX) { h = MIN_BOX; if (movesN) top = bottom - MIN_BOX; else bottom = top + MIN_BOX; }

  return { x: left, y: top, w, h };
}

/** Canvas + other-object snap targets along each axis. */
function targetsX(others: Box[]): number[] {
  const t = [0, 0.5, 1];
  for (const o of others) t.push(o.x, o.x + o.w / 2, o.x + o.w);
  return t;
}
function targetsY(others: Box[]): number[] {
  const t = [0, 0.5, 1];
  for (const o of others) t.push(o.y, o.y + o.h / 2, o.y + o.h);
  return t;
}

/** Best snap of any probe to any target within threshold → {delta, line} or null. */
function bestSnap(probes: number[], targets: number[], threshold: number): { delta: number; line: number } | null {
  let best: { delta: number; line: number; dist: number } | null = null;
  for (const p of probes) {
    for (const t of targets) {
      const dist = Math.abs(t - p);
      // SNAP_EPS tie-break: keep the earlier probe (left/top before center before
      // right/bottom) on near-equal distances, so floating-point noise can't flip it.
      if (dist <= threshold && (!best || dist < best.dist - SNAP_EPS)) best = { delta: t - p, line: t, dist };
    }
  }
  return best ? { delta: best.delta, line: best.line } : null;
}

/** Snap nearest target to a single value (an edge) within threshold, or null. */
function snapValue(value: number, targets: number[], threshold: number): number | null {
  let best: { v: number; dist: number } | null = null;
  for (const t of targets) {
    const dist = Math.abs(t - value);
    if (dist <= threshold && (!best || dist < best.dist - SNAP_EPS)) best = { v: t, dist };
  }
  return best ? best.v : null;
}

/**
 * Snap a moving box (left/center/right & top/middle/bottom probes) to the canvas
 * lines (0/0.5/1) and other objects' edges/centers. Returns the snapped box and
 * the guide lines that became active.
 */
export function snapMove(box: Box, others: Box[], threshold: number): { box: Box; guides: Guides } {
  const sx = bestSnap([box.x, box.x + box.w / 2, box.x + box.w], targetsX(others), threshold);
  const sy = bestSnap([box.y, box.y + box.h / 2, box.y + box.h], targetsY(others), threshold);
  return {
    box: { ...box, x: box.x + (sx?.delta ?? 0), y: box.y + (sy?.delta ?? 0) },
    guides: { vx: sx ? [sx.line] : [], hy: sy ? [sy.line] : [] },
  };
}

/**
 * Snap the dragged edges of a (already-resized) box to the canvas lines and other
 * objects' edges, keeping the opposite edges fixed and the MIN_BOX floor.
 */
export function snapResize(box: Box, handle: Handle, others: Box[], threshold: number): { box: Box; guides: Guides } {
  let left = box.x;
  let top = box.y;
  let right = box.x + box.w;
  let bottom = box.y + box.h;
  const tx = targetsX(others);
  const ty = targetsY(others);

  // Snap the dragged edges...
  const sE = handle.includes("e") ? snapValue(right, tx, threshold) : null;
  const sW = handle.includes("w") ? snapValue(left, tx, threshold) : null;
  const sS = handle.includes("s") ? snapValue(bottom, ty, threshold) : null;
  const sN = handle.includes("n") ? snapValue(top, ty, threshold) : null;
  if (sE != null) right = sE;
  if (sW != null) left = sW;
  if (sS != null) bottom = sS;
  if (sN != null) top = sN;

  // ...then enforce the MIN_BOX floor (which may override a snap).
  if (right - left < MIN_BOX) { if (handle.includes("w")) left = right - MIN_BOX; else right = left + MIN_BOX; }
  if (bottom - top < MIN_BOX) { if (handle.includes("n")) top = bottom - MIN_BOX; else bottom = top + MIN_BOX; }

  // Emit a guide only for snaps that actually held after MIN_BOX recovery, so a
  // guide line never lies about where an edge sits.
  const vx: number[] = [];
  const hy: number[] = [];
  if (sE != null && Math.abs(right - sE) < SNAP_EPS) vx.push(sE);
  if (sW != null && Math.abs(left - sW) < SNAP_EPS) vx.push(sW);
  if (sS != null && Math.abs(bottom - sS) < SNAP_EPS) hy.push(sS);
  if (sN != null && Math.abs(top - sN) < SNAP_EPS) hy.push(sN);

  return { box: { x: left, y: top, w: right - left, h: bottom - top }, guides: { vx, hy } };
}

/** Clamp a box fully onto the canvas (size preserved where possible). */
export function clampToCanvas(box: Box): Box {
  const w = clamp(box.w, MIN_BOX, 1);
  const h = clamp(box.h, MIN_BOX, 1);
  return { x: clamp(box.x, 0, 1 - w), y: clamp(box.y, 0, 1 - h), w, h };
}
