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
import { formatCompact, formatCurrency, formatNumber } from "@/lib/format";

const AXIS = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
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
  money,
}: {
  active?: boolean;
  payload?: TipItem[];
  label?: string;
  unit?: string;
  money?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-muted-foreground">
          <span
            className="size-2 rounded-full"
            style={{ background: p.color }}
          />
          <span className="tabular-nums text-foreground">
            {money
              ? formatCurrency(Number(p.value), { cents: true })
              : formatNumber(Number(p.value))}
          </span>
          {unit && <span>{unit}</span>}
        </div>
      ))}
    </div>
  );
}

/** Activations over time — soft emerald area chart. */
export function DocumentsAreaChart({
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
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillDocuments" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="label" {...AXIS} interval={interval} minTickGap={16} />
        <YAxis {...AXIS} width={40} tickFormatter={(v) => formatCompact(Number(v))} />
        <Tooltip
          content={<ChartTooltip unit="activations" />}
          cursor={{ stroke: "var(--border)" }}
        />
        <Area
          type="monotone"
          dataKey="activations"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#fillDocuments)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
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
  money = false,
}: {
  data: BreakdownDatum[];
  height?: number;
  money?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 8, bottom: 4 }}
      >
        <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          type="number"
          {...AXIS}
          tickFormatter={(v) =>
            money ? `$${formatCompact(Number(v))}` : formatCompact(Number(v))
          }
        />
        <YAxis
          type="category"
          dataKey="label"
          {...AXIS}
          width={120}
          tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + "…" : v)}
        />
        <Tooltip
          content={<ChartTooltip money={money} unit={money ? undefined : "activations"} />}
          cursor={{ fill: "var(--accent)", opacity: 0.4 }}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
          {data.map((_, i) => (
            <Cell key={i} fill={`var(--chart-${(i % 5) + 1})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
