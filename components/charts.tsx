"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimePoint } from "@/lib/types";
import { formatCompact, formatNumber } from "@/lib/format";

const AXIS = {
  stroke: "var(--muted-foreground)",
  fontSize: 12,
  tickLine: false,
  axisLine: false,
};

interface TipItem {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: TipItem[];
  label?: string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line-strong bg-popover px-2.5 py-2 text-[13px]">
      <p className="text-xs text-muted-foreground">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">
            {formatNumber(Number(p.value))}
          </span>
          {unit && <span>{unit}</span>}
        </div>
      ))}
    </div>
  );
}

/** Activations over time: a neutral line whose last point is the one orange mark. */
export function ActivationsAreaChart({
  data,
  height = 280,
}: {
  data: TimePoint[];
  height?: number;
}) {
  // Keep axis readable: show every Nth label for dense daily series.
  const interval = data.length > 14 ? Math.floor(data.length / 7) : 0;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 18, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fillActivations" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-area)" />
            <stop offset="100%" stopColor="var(--chart-area)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="label"
          {...AXIS}
          axisLine={{ stroke: "var(--line-strong)" }}
          tickMargin={8}
          interval={interval}
          minTickGap={16}
        />
        <YAxis {...AXIS} width={44} tickFormatter={(v) => formatCompact(Number(v))} />
        <Tooltip
          content={<ChartTooltip unit="activations" />}
          cursor={{ stroke: "var(--line-strong)" }}
        />
        <Area
          type="monotone"
          dataKey="activations"
          stroke="var(--chart-1)"
          strokeWidth={1.75}
          fill="url(#fillActivations)"
          dot={(p: { cx?: number; cy?: number; index?: number }) =>
            p.index === data.length - 1 && p.cx != null && p.cy != null ? (
              <circle
                key="last"
                cx={p.cx}
                cy={p.cy}
                r={4}
                fill="var(--chart-point)"
                stroke="var(--card)"
                strokeWidth={2}
              />
            ) : (
              <g key={p.index} />
            )
          }
          activeDot={{ r: 4, strokeWidth: 0, fill: "var(--chart-1)" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface BreakdownDatum {
  label: string;
  value: number;
}

/** Horizontal-ish vertical bar chart for store/device breakdowns. */
export function BreakdownBarChart({
  data,
  height = 280,
}: {
  data: BreakdownDatum[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 8, bottom: 4 }}
      >
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
        <XAxis
          type="number"
          {...AXIS}
          tickFormatter={(v) => formatCompact(Number(v))}
        />
        <YAxis
          type="category"
          dataKey="label"
          {...AXIS}
          width={120}
          tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + "…" : v)}
        />
        <Tooltip
          content={<ChartTooltip unit="activations" />}
          cursor={{ fill: "var(--accent)", opacity: 0.4 }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
          {data.map((_, i) => (
            <Cell key={i} fill={`var(--chart-${(i % 5) + 1})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
