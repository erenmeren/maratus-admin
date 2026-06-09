import { describe, it, expect } from "vitest";
import { resizeBox, clampCenter, MIN_BOX, type Box } from "./kiosk-geometry";

const box: Box = { cx: 0.5, cy: 0.5, w: 0.2, h: 0.1 }; // edges: L0.4 R0.6 T0.45 B0.55

describe("resizeBox", () => {
  it("right edge moves only width, left edge stays fixed", () => {
    const r = resizeBox(box, "e", { x: 0.7, y: 0.99 }, false);
    expect(r.w).toBeCloseTo(0.3, 6);   // L0.4 → R0.7
    expect(r.h).toBeCloseTo(0.1, 6);   // unchanged
    expect(r.cx).toBeCloseTo(0.55, 6); // midpoint of 0.4..0.7
    expect(r.cy).toBeCloseTo(0.5, 6);
  });

  it("bottom edge moves only height, top stays fixed", () => {
    const r = resizeBox(box, "s", { x: 0.99, y: 0.75 }, false);
    expect(r.h).toBeCloseTo(0.3, 6);   // T0.45 → B0.75
    expect(r.w).toBeCloseTo(0.2, 6);
    expect(r.cy).toBeCloseTo(0.6, 6);
  });

  it("corner keeps aspect ratio (driven by width), opposite corner fixed", () => {
    // se corner: anchor = top-left (0.4, 0.45). aspect w/h = 2.
    const r = resizeBox(box, "se", { x: 0.8, y: 0.99 }, true);
    expect(r.w).toBeCloseTo(0.4, 6);   // 0.4 → 0.8
    expect(r.h).toBeCloseTo(0.2, 6);   // aspect-locked: 0.4 / 2
    expect(r.cx).toBeCloseTo(0.6, 6);  // midpoint 0.4..0.8
    expect(r.cy).toBeCloseTo(0.55, 6); // midpoint 0.45..0.65
  });

  it("clamps to a minimum size and never inverts", () => {
    const r = resizeBox(box, "e", { x: 0.3, y: 0.5 }, false); // dragged past left edge
    expect(r.w).toBeGreaterThanOrEqual(MIN_BOX);
    expect(r.w).toBeLessThanOrEqual(0.2);
  });
});

describe("clampCenter", () => {
  it("keeps the center within [0,1]", () => {
    expect(clampCenter({ cx: -0.2, cy: 1.5, w: 0.1, h: 0.1 })).toMatchObject({ cx: 0, cy: 1 });
  });
});
