import { describe, it, expect } from "vitest";
import { resizeBox, snapMove, snapResize, clampToCanvas, MIN_BOX, type Box } from "./kiosk-geometry";

const box: Box = { x: 0.4, y: 0.45, w: 0.2, h: 0.1 }; // edges L0.4 R0.6 T0.45 B0.55

describe("resizeBox (top-left box)", () => {
  it("east edge changes width, left fixed", () => {
    const r = resizeBox(box, "e", { x: 0.8, y: 0.99 });
    expect(r.x).toBeCloseTo(0.4, 6);
    expect(r.w).toBeCloseTo(0.4, 6);
    expect(r.h).toBeCloseTo(0.1, 6);
  });
  it("west edge changes x and width, right fixed", () => {
    const r = resizeBox(box, "w", { x: 0.5, y: 0.5 });
    expect(r.x).toBeCloseTo(0.5, 6);
    expect(r.w).toBeCloseTo(0.1, 6); // R0.6 - 0.5
  });
  it("south-east corner changes width and height independently", () => {
    const r = resizeBox(box, "se", { x: 0.9, y: 0.85 });
    expect(r.w).toBeCloseTo(0.5, 6);
    expect(r.h).toBeCloseTo(0.4, 6);
  });
  it("floors at MIN_BOX and never inverts", () => {
    const r = resizeBox(box, "e", { x: 0.1, y: 0.5 }); // dragged past left
    expect(r.w).toBeGreaterThanOrEqual(MIN_BOX);
    expect(r.x).toBeCloseTo(0.4, 6);
  });
  it("north edge dragged past the bottom floors height and re-anchors top", () => {
    const r = resizeBox(box, "n", { x: 0.5, y: 0.9 }); // bottom is 0.55
    expect(r.h).toBe(MIN_BOX);
    expect(r.y).toBeCloseTo(0.55 - MIN_BOX, 6); // re-anchored to bottom - MIN_BOX
  });
  it("nw corner dragged past se floors BOTH axes and re-anchors to the se corner", () => {
    const r = resizeBox(box, "nw", { x: 0.99, y: 0.99 }); // right 0.6, bottom 0.55
    expect(r.w).toBe(MIN_BOX);
    expect(r.h).toBe(MIN_BOX);
    expect(r.x).toBeCloseTo(0.6 - MIN_BOX, 6);
    expect(r.y).toBeCloseTo(0.55 - MIN_BOX, 6);
  });
});

describe("snapMove", () => {
  it("snaps the box center to the canvas center", () => {
    const moving: Box = { x: 0.39, y: 0.45, w: 0.2, h: 0.1 }; // centerX 0.49, near 0.5
    const { box: r, guides } = snapMove(moving, [], 0.02);
    expect(r.x + r.w / 2).toBeCloseTo(0.5, 6);
    expect(guides.vx).toContain(0.5);
  });
  it("snaps the left edge to another object's left edge", () => {
    const other: Box = { x: 0.2, y: 0.0, w: 0.1, h: 0.1 };
    const moving: Box = { x: 0.205, y: 0.5, w: 0.1, h: 0.1 };
    const { box: r, guides } = snapMove(moving, [other], 0.02);
    expect(r.x).toBeCloseTo(0.2, 6);
    expect(guides.vx).toContain(0.2);
  });
  it("does not snap outside the threshold", () => {
    const moving: Box = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
    const { box: r, guides } = snapMove(moving, [], 0.005);
    expect(r.x).toBeCloseTo(0.1, 6);
    expect(guides.vx).toHaveLength(0);
    expect(guides.hy).toHaveLength(0);
  });
  it("snaps the top edge to the canvas top and reports a horizontal guide", () => {
    const moving: Box = { x: 0.5, y: 0.01, w: 0.1, h: 0.1 }; // top near 0
    const { box: r, guides } = snapMove(moving, [], 0.02);
    expect(r.y).toBeCloseTo(0, 6);
    expect(guides.hy).toContain(0);
  });
});

describe("snapResize", () => {
  it("snaps the dragged east edge to the canvas right and reports a guide", () => {
    const b: Box = { x: 0.2, y: 0.2, w: 0.78, h: 0.2 }; // right edge 0.98, near 1
    const { box: r, guides } = snapResize(b, "e", [], 0.03);
    expect(r.x + r.w).toBeCloseTo(1, 6);
    expect(guides.vx).toContain(1);
  });
  it("leaves the non-dragged edges alone", () => {
    const b: Box = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
    const { box: r } = snapResize(b, "e", [], 0.03);
    expect(r.x).toBeCloseTo(0.2, 6);
    expect(r.y).toBeCloseTo(0.2, 6);
    expect(r.h).toBeCloseTo(0.6, 6);
  });
  it("snaps the south edge to the canvas bottom", () => {
    const b: Box = { x: 0.2, y: 0.2, w: 0.2, h: 0.78 }; // bottom 0.98, near 1
    const { box: r, guides } = snapResize(b, "s", [], 0.03);
    expect(r.y + r.h).toBeCloseTo(1, 6);
    expect(guides.hy).toContain(1);
  });
  it("does NOT report a guide when MIN_BOX overrides the snap", () => {
    // east drag on a tiny box: right 0.53 snaps toward 0.5, but that collapses
    // width below MIN_BOX, so the edge is pushed back out — no honest guide.
    const b: Box = { x: 0.49, y: 0.2, w: 0.04, h: 0.2 };
    const { box: r, guides } = snapResize(b, "e", [], 0.04);
    expect(r.w).toBeGreaterThanOrEqual(MIN_BOX);
    expect(guides.vx).toHaveLength(0);
  });
});

describe("clampToCanvas", () => {
  it("pulls a box back onto the canvas", () => {
    expect(clampToCanvas({ x: 0.9, y: 0.95, w: 0.3, h: 0.2 })).toMatchObject({ x: 0.7, y: 0.8 });
  });
  it("clamps an oversized box and floors a tiny one", () => {
    const big = clampToCanvas({ x: -1, y: -1, w: 5, h: 5 });
    expect(big).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
    expect(clampToCanvas({ x: 0.5, y: 0.5, w: 0, h: 0 }).w).toBe(MIN_BOX);
  });
});
