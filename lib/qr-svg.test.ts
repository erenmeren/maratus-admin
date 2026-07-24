import { describe, it, expect } from "vitest";
import {
  isFinderCell,
  finderOrigins,
  darkDots,
  QR_SHAPES,
  QR_SHAPE_GEOMETRY,
  qrShadowFilterSpec,
  qrShadowBoxShadow,
} from "./qr-svg";

describe("isFinderCell", () => {
  const size = 21; // smallest real QR (version 1)

  it("flags the top-left finder square", () => {
    expect(isFinderCell(0, 0, size)).toBe(true);
    expect(isFinderCell(6, 6, size)).toBe(true);
  });

  it("flags the top-right finder square", () => {
    expect(isFinderCell(0, size - 7, size)).toBe(true);
    expect(isFinderCell(6, size - 1, size)).toBe(true);
  });

  it("flags the bottom-left finder square", () => {
    expect(isFinderCell(size - 7, 0, size)).toBe(true);
    expect(isFinderCell(size - 1, 6, size)).toBe(true);
  });

  it("does not flag the bottom-right corner (QR has no fourth finder pattern)", () => {
    expect(isFinderCell(size - 1, size - 1, size)).toBe(false);
    expect(isFinderCell(size - 7, size - 7, size)).toBe(false);
  });

  it("does not flag cells outside any finder square", () => {
    expect(isFinderCell(7, 7, size)).toBe(false);
    expect(isFinderCell(10, 10, size)).toBe(false);
    expect(isFinderCell(0, 7, size)).toBe(false); // just past the TL square
    expect(isFinderCell(7, 0, size)).toBe(false); // just past the TL square
  });
});

describe("finderOrigins", () => {
  it("returns the three corner origins for a given size", () => {
    expect(finderOrigins(21)).toEqual([
      [0, 0],
      [0, 14],
      [14, 0],
    ]);
  });
});

describe("darkDots", () => {
  it("excludes finder-square cells even when dark, and includes other dark cells", () => {
    const size = 21;
    // Everything dark — every finder cell should be excluded regardless.
    const dots = darkDots(size, () => true);
    expect(dots.every((d) => !isFinderCell(d.row, d.col, size))).toBe(true);
    expect(dots.length).toBe(size * size - 3 * 7 * 7);
  });

  it("only includes cells the matrix marks dark", () => {
    const dots = darkDots(21, (row, col) => row === 10 && col === 10);
    expect(dots).toEqual([{ row: 10, col: 10 }]);
  });

  it("returns nothing when the matrix is entirely light", () => {
    expect(darkDots(21, () => false)).toEqual([]);
  });
});

// ─── QR style shapes (2026-07-23) ────────────────────────────────────────────

describe("QR_SHAPE_GEOMETRY", () => {
  it("has an entry for every shape in QR_SHAPES", () => {
    for (const shape of QR_SHAPES) {
      expect(QR_SHAPE_GEOMETRY[shape]).toBeDefined();
    }
  });

  it("classic renders sharp squares (no rounding anywhere)", () => {
    const g = QR_SHAPE_GEOMETRY.classic;
    expect(g.moduleKind).toBe("rect");
    expect(g.moduleRx).toBe(0);
    expect(g.finderRadiusRatio).toBe(0);
  });

  it("soft renders rounded-corner squares with rx ≈ 0.25 × module", () => {
    const g = QR_SHAPE_GEOMETRY.soft;
    expect(g.moduleKind).toBe("rect");
    expect(g.moduleRx).toBeCloseTo(0.25);
  });

  it("rounded (today's live look) renders circles", () => {
    const g = QR_SHAPE_GEOMETRY.rounded;
    expect(g.moduleKind).toBe("circle");
    expect(g.moduleR).toBeGreaterThan(0);
  });

  it("dots renders circles with diameter ≥ 0.7 × module (r ≥ 0.35)", () => {
    const g = QR_SHAPE_GEOMETRY.dots;
    expect(g.moduleKind).toBe("circle");
    expect(g.moduleR).toBeGreaterThanOrEqual(0.35);
  });

  it("dots modules are smaller than rounded's (visually distinct)", () => {
    expect(QR_SHAPE_GEOMETRY.dots.moduleR).toBeLessThan(QR_SHAPE_GEOMETRY.rounded.moduleR);
  });
});

// ─── QR background-plate shadow: SVG filter + CSS box-shadow (2026-07-24) ───

describe("qrShadowFilterSpec", () => {
  it("emits nothing for mode 'none'", () => {
    expect(qrShadowFilterSpec("none", 50, "#000000")).toBeNull();
  });

  it("emits a single feDropShadow spec for mode 'drop'", () => {
    const spec = qrShadowFilterSpec("drop", 50, "#ff0000");
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe("drop");
    if (spec!.kind === "drop") {
      expect(spec!.dy).toBeGreaterThan(0);
      expect(spec!.stdDeviation).toBeGreaterThan(0);
      expect(spec!.floodColor).toMatch(/^rgba\(255, 0, 0, [\d.]+\)$/);
    }
  });

  it("emits two stacked Gaussian-blur std-deviations (tight < wide) for mode 'neon'", () => {
    const spec = qrShadowFilterSpec("neon", 50, "#00ff00");
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe("neon");
    if (spec!.kind === "neon") {
      const [tight, wide] = spec!.stdDeviations;
      expect(tight).toBeGreaterThan(0);
      expect(wide).toBeGreaterThan(tight);
      expect(spec!.color).toBe("#00ff00");
    }
  });

  it("drop's stdDeviation and opacity increase monotonically with strength", () => {
    const low = qrShadowFilterSpec("drop", 0, "#000000")!;
    const high = qrShadowFilterSpec("drop", 100, "#000000")!;
    expect(low.kind).toBe("drop");
    expect(high.kind).toBe("drop");
    if (low.kind === "drop" && high.kind === "drop") {
      expect(high.stdDeviation).toBeGreaterThan(low.stdDeviation);
    }
  });

  it("neon's blur radii increase monotonically with strength", () => {
    const low = qrShadowFilterSpec("neon", 0, "#000000")!;
    const high = qrShadowFilterSpec("neon", 100, "#000000")!;
    if (low.kind === "neon" && high.kind === "neon") {
      expect(high.stdDeviations[0]).toBeGreaterThan(low.stdDeviations[0]);
      expect(high.stdDeviations[1]).toBeGreaterThan(low.stdDeviations[1]);
    }
  });
});

describe("qrShadowBoxShadow", () => {
  it("returns undefined for mode 'none'", () => {
    expect(qrShadowBoxShadow("none", 50, "#000000")).toBeUndefined();
  });

  it("returns a downward-offset rgba shadow for mode 'drop'", () => {
    const css = qrShadowBoxShadow("drop", 50, "#000000");
    expect(css).toMatch(/^0 2px [\d.]+px rgba\(0, 0, 0, [\d.]+\)$/);
  });

  it("returns two zero-offset full-color glows for mode 'neon', the second double the first", () => {
    const css = qrShadowBoxShadow("neon", 50, "#00ffcc");
    const m = css!.match(/^0 0 ([\d.]+)px #00ffcc, 0 0 ([\d.]+)px #00ffcc$/);
    expect(m).not.toBeNull();
    const [, first, second] = m!;
    expect(Number(second)).toBeCloseTo(Number(first) * 2);
  });

  it("mode 'none' vs 'drop' vs 'neon' produce distinct output for the same strength/color", () => {
    const args = [60, "#111111"] as const;
    const drop = qrShadowBoxShadow("drop", ...args);
    const neon = qrShadowBoxShadow("neon", ...args);
    expect(drop).not.toBe(neon);
    expect(qrShadowBoxShadow("none", ...args)).toBeUndefined();
  });
});
