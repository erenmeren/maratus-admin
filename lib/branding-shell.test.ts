import { describe, it, expect } from "vitest";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_DEFAULT,
  clampZoom,
  stepIndex,
  swipeStep,
} from "./branding-shell";

describe("clampZoom", () => {
  it("clamps below the minimum", () => {
    expect(clampZoom(10)).toBe(ZOOM_MIN);
  });
  it("clamps above the maximum", () => {
    expect(clampZoom(999)).toBe(ZOOM_MAX);
  });
  it("snaps to the nearest 5% step", () => {
    expect(clampZoom(82)).toBe(80);
    expect(clampZoom(83)).toBe(85);
  });
  it("falls back to the default for non-finite input", () => {
    expect(clampZoom(Number.NaN)).toBe(ZOOM_DEFAULT);
  });
});

describe("stepIndex", () => {
  it("advances forward", () => {
    expect(stepIndex(0, 1, 7)).toBe(1);
  });
  it("wraps forward past the end", () => {
    expect(stepIndex(6, 1, 7)).toBe(0);
  });
  it("wraps backward before the start", () => {
    expect(stepIndex(0, -1, 7)).toBe(6);
  });
  it("is safe for an empty list", () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe("swipeStep", () => {
  it("returns +1 when swiped left past the threshold", () => {
    expect(swipeStep(-80, 200)).toBe(1);
  });
  it("returns -1 when swiped right past the threshold", () => {
    expect(swipeStep(80, 200)).toBe(-1);
  });
  it("returns 0 for a small drag", () => {
    expect(swipeStep(10, 200)).toBe(0);
  });
  it("is safe for a zero-width frame", () => {
    expect(swipeStep(50, 0)).toBe(0);
  });
});
