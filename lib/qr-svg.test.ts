import { describe, it, expect } from "vitest";
import { isFinderCell, finderOrigins, darkDots } from "./qr-svg";

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
