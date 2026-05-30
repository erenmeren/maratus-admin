// Decorative QR-like matrix for the kiosk mockup. Not a real scannable code —
// it just reads as a QR on the preview. Deterministic from `seed`.

function matrix(size: number, seed: number): boolean[][] {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;

  const grid = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => rnd() > 0.52),
  );

  // Carve out the three finder-pattern corners so it looks like a real QR.
  const clear = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const r1 = r0 + r;
        const c1 = c0 + c;
        if (r1 < 0 || c1 < 0 || r1 >= size || c1 >= size) continue;
        grid[r1][c1] = false;
      }
    }
  };
  clear(0, 0);
  clear(0, size - 7);
  clear(size - 7, 0);
  return grid;
}

function Finder({ x, y, unit }: { x: number; y: number; unit: number }) {
  return (
    <g transform={`translate(${x * unit} ${y * unit})`}>
      <rect width={unit * 7} height={unit * 7} rx={unit} fill="currentColor" />
      <rect
        x={unit}
        y={unit}
        width={unit * 5}
        height={unit * 5}
        rx={unit * 0.6}
        fill="var(--qr-bg, #fff)"
      />
      <rect
        x={unit * 2}
        y={unit * 2}
        width={unit * 3}
        height={unit * 3}
        rx={unit * 0.4}
        fill="currentColor"
      />
    </g>
  );
}

export function FauxQR({
  seed = 7,
  className,
  style,
}: {
  seed?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const size = 25;
  const unit = 4;
  const dim = size * unit;
  const grid = matrix(size, seed);

  return (
    <svg
      viewBox={`0 0 ${dim} ${dim}`}
      className={className}
      style={style}
      shapeRendering="crispEdges"
    >
      <rect width={dim} height={dim} fill="var(--qr-bg, #fff)" />
      <g>
        {grid.map((row, r) =>
          row.map((on, c) =>
            on ? (
              <rect
                key={`${r}-${c}`}
                x={c * unit}
                y={r * unit}
                width={unit}
                height={unit}
                fill="currentColor"
              />
            ) : null,
          ),
        )}
      </g>
      <Finder x={0} y={0} unit={unit} />
      <Finder x={size - 7} y={0} unit={unit} />
      <Finder x={0} y={size - 7} unit={unit} />
    </svg>
  );
}
