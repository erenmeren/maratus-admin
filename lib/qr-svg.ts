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
