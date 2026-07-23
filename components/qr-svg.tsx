// Styled ("rounded dot module") QR renderer — shared by the branding studio's
// QrObject preview (device-preview/printer-preview.tsx) and the pinned-QR card
// (device-pin-control.tsx), matching the on-device firmware QR render. Dark
// modules render as circles; the three finder patterns render as rounded
// squares (outer ring + inner dot) instead of individual dot-modules, per
// docs/superpowers/specs/2026-07-22-screen-terminology-and-pinned-screen.md §D.

import * as React from "react";
import QRCode from "qrcode";
import { darkDots, finderOrigins, qrBackgroundRadius, QR_SHAPE_GEOMETRY, type QrCorner, type QrShape } from "@/lib/qr-svg";
import { DEFAULT_QR_STYLE } from "@/lib/printer-layout";

const UNIT = 4; // px per module at scale 1 (matches FauxQR's design-time unit)

export function QrSvg({
  value,
  className,
  style,
  ariaLabel,
  shape = DEFAULT_QR_STYLE.qrShape,
  fg = DEFAULT_QR_STYLE.qrFg,
  bg = DEFAULT_QR_STYLE.qrBg,
  corner = DEFAULT_QR_STYLE.qrCorner,
  shadow = DEFAULT_QR_STYLE.qrShadow,
}: {
  value: string;
  className?: string;
  style?: React.CSSProperties;
  /** Accessible label. Omit for purely decorative/illustrative previews. */
  ariaLabel?: string;
  /** Module + finder shape. Defaults to the org default ("rounded"). */
  shape?: QrShape;
  /** Dark-module / finder color. Defaults to the org default (#111111). */
  fg?: string;
  /** Background (incl. quiet zone) color. Defaults to the org default (#ffffff). */
  bg?: string;
  /** Background-plate corner treatment. Defaults to the org default ("rounded"). */
  corner?: QrCorner;
  /** Soft drop-shadow under the background plate. Defaults to the org default (false). */
  shadow?: boolean;
}) {
  const built = React.useMemo(() => {
    try {
      return QRCode.create(value, { errorCorrectionLevel: "M" });
    } catch {
      return null;
    }
  }, [value]);

  // useId output contains ":" which is invalid unescaped inside a CSS url()
  // reference — strip it so `filter={\`url(#${filterId})\`}` resolves.
  const filterId = `qr-shadow-${React.useId().replace(/:/g, "")}`;

  if (!built) return null;

  const { modules } = built;
  const size = modules.size;
  const dim = size * UNIT;
  const geo = QR_SHAPE_GEOMETRY[shape];
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
      {shadow && (
        <defs>
          <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow
              dx="0"
              dy={dim * 0.015}
              stdDeviation={dim * 0.02}
              floodColor="rgba(15,20,40,0.35)"
            />
          </filter>
        </defs>
      )}
      <rect
        width={dim}
        height={dim}
        rx={qrBackgroundRadius(dim, corner)}
        fill={bg}
        filter={shadow ? `url(#${filterId})` : undefined}
      />
      <g>
        {dots.map(({ row, col }) =>
          geo.moduleKind === "circle" ? (
            <circle
              key={`${row}-${col}`}
              cx={col * UNIT + UNIT / 2}
              cy={row * UNIT + UNIT / 2}
              r={UNIT * geo.moduleR}
              fill={fg}
            />
          ) : (
            <rect
              key={`${row}-${col}`}
              x={col * UNIT}
              y={row * UNIT}
              width={UNIT}
              height={UNIT}
              rx={UNIT * geo.moduleRx}
              fill={fg}
            />
          ),
        )}
      </g>
      {finderOrigins(size).map(([row, col]) => (
        <Finder key={`${row}-${col}`} row={row} col={col} fg={fg} bg={bg} finderRadiusRatio={geo.finderRadiusRatio} />
      ))}
    </svg>
  );
}

/** One finder pattern: 7×7 outer ring + 3×3 inner dot, both rects (rounded per shape). */
function Finder({
  row,
  col,
  fg,
  bg,
  finderRadiusRatio,
}: {
  row: number;
  col: number;
  fg: string;
  bg: string;
  finderRadiusRatio: number;
}) {
  const outer = 7 * UNIT;
  const inner = 5 * UNIT;
  const dot = 3 * UNIT;
  return (
    <g transform={`translate(${col * UNIT} ${row * UNIT})`}>
      <rect width={outer} height={outer} rx={outer * finderRadiusRatio} fill={fg} />
      <rect
        x={UNIT}
        y={UNIT}
        width={inner}
        height={inner}
        rx={inner * finderRadiusRatio}
        fill={bg}
      />
      <rect
        x={UNIT * 2}
        y={UNIT * 2}
        width={dot}
        height={dot}
        rx={dot * finderRadiusRatio}
        fill={fg}
      />
    </g>
  );
}
