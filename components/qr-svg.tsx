// Styled ("rounded dot module") QR renderer — shared by the branding studio's
// QrObject preview (device-preview/printer-preview.tsx) and the pinned-QR card
// (device-pin-control.tsx), matching the on-device firmware QR render. Dark
// modules render as circles; the three finder patterns render as rounded
// squares (outer ring + inner dot) instead of individual dot-modules, per
// docs/superpowers/specs/2026-07-22-screen-terminology-and-pinned-screen.md §D.

import * as React from "react";
import QRCode from "qrcode";
import {
  darkDots,
  finderOrigins,
  qrBackgroundRadius,
  qrShadowFilterSpec,
  QR_SHAPE_GEOMETRY,
  type QrCorner,
  type QrShadowMode,
  type QrShape,
} from "@/lib/qr-svg";
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
  shadowMode = DEFAULT_QR_STYLE.qrShadowMode,
  shadowStrength = DEFAULT_QR_STYLE.qrShadowStrength,
  shadowColor = DEFAULT_QR_STYLE.qrShadowColor,
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
  /** Background-plate shadow effect. Defaults to the org default ("none"). */
  shadowMode?: QrShadowMode;
  /** Shadow/glow intensity, 0..100. Defaults to the org default (50). */
  shadowStrength?: number;
  /** Shadow/glow color. Defaults to the org default (#000000). */
  shadowColor?: string;
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
  const filterSpec = React.useMemo(
    () => qrShadowFilterSpec(shadowMode, shadowStrength, shadowColor),
    [shadowMode, shadowStrength, shadowColor],
  );

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
      {filterSpec && (
        <defs>
          <filter id={filterId} x="-60%" y="-60%" width="220%" height="220%">
            {filterSpec.kind === "drop" ? (
              <feDropShadow
                dx="0"
                dy={filterSpec.dy}
                stdDeviation={filterSpec.stdDeviation}
                floodColor={filterSpec.floodColor}
              />
            ) : (
              <>
                <feFlood floodColor={filterSpec.color} result="flood" />
                <feComposite in="flood" in2="SourceAlpha" operator="in" result="colored" />
                <feGaussianBlur in="colored" stdDeviation={filterSpec.stdDeviations[1]} result="glowWide" />
                <feGaussianBlur in="colored" stdDeviation={filterSpec.stdDeviations[0]} result="glowTight" />
                <feMerge>
                  <feMergeNode in="glowWide" />
                  <feMergeNode in="glowTight" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </>
            )}
          </filter>
        </defs>
      )}
      <rect
        width={dim}
        height={dim}
        rx={qrBackgroundRadius(dim, corner)}
        fill={bg}
        filter={filterSpec ? `url(#${filterId})` : undefined}
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
