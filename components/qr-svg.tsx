// Styled ("rounded dot module") QR renderer — shared by the branding studio's
// QrObject preview (device-preview/printer-preview.tsx) and the pinned-QR card
// (device-pin-control.tsx), matching the on-device firmware QR render. Dark
// modules render as circles; the three finder patterns render as rounded
// squares (outer ring + inner dot) instead of individual dot-modules, per
// docs/superpowers/specs/2026-07-22-screen-terminology-and-pinned-screen.md §D.

import * as React from "react";
import QRCode from "qrcode";
import { darkDots, finderOrigins } from "@/lib/qr-svg";

const UNIT = 4; // px per module at scale 1 (matches FauxQR's design-time unit)
const DOT_RADIUS_RATIO = 0.425; // r ≈ 0.425 × module
const FINDER_RADIUS_RATIO = 1 / 3; // rx ≈ 1/3 of each finder rect's own size

export function QrSvg({
  value,
  className,
  style,
  ariaLabel,
}: {
  value: string;
  className?: string;
  style?: React.CSSProperties;
  /** Accessible label. Omit for purely decorative/illustrative previews. */
  ariaLabel?: string;
}) {
  const built = React.useMemo(() => {
    try {
      return QRCode.create(value, { errorCorrectionLevel: "M" });
    } catch {
      return null;
    }
  }, [value]);

  if (!built) return null;

  const { modules } = built;
  const size = modules.size;
  const dim = size * UNIT;
  const dotR = UNIT * DOT_RADIUS_RATIO;
  const dots = darkDots(size, (row, col) => modules.get(row, col) === 1);

  return (
    <svg
      viewBox={`0 0 ${dim} ${dim}`}
      className={className}
      style={style}
      shapeRendering="geometricPrecision"
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <rect width={dim} height={dim} fill="var(--qr-bg, #fff)" />
      <g>
        {dots.map(({ row, col }) => (
          <circle
            key={`${row}-${col}`}
            cx={col * UNIT + UNIT / 2}
            cy={row * UNIT + UNIT / 2}
            r={dotR}
            fill="currentColor"
          />
        ))}
      </g>
      {finderOrigins(size).map(([row, col]) => (
        <Finder key={`${row}-${col}`} row={row} col={col} />
      ))}
    </svg>
  );
}

/** One finder pattern: 7×7 outer ring + 3×3 inner dot, both rounded rects. */
function Finder({ row, col }: { row: number; col: number }) {
  const outer = 7 * UNIT;
  const inner = 5 * UNIT;
  const dot = 3 * UNIT;
  return (
    <g transform={`translate(${col * UNIT} ${row * UNIT})`}>
      <rect width={outer} height={outer} rx={outer * FINDER_RADIUS_RATIO} fill="currentColor" />
      <rect
        x={UNIT}
        y={UNIT}
        width={inner}
        height={inner}
        rx={inner * FINDER_RADIUS_RATIO}
        fill="var(--qr-bg, #fff)"
      />
      <rect
        x={UNIT * 2}
        y={UNIT * 2}
        width={dot}
        height={dot}
        rx={dot * FINDER_RADIUS_RATIO}
        fill="currentColor"
      />
    </g>
  );
}
