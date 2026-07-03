"use client";

import * as React from "react";
import type { Heatmap } from "@/lib/analytics";
import { hourLabel } from "@/lib/analytics";

// Postgres dow is 0=Sun..6=Sat. Render Mon-first for readability.
const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const ROW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL_DAY = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const HOUR_TICKS: Record<number, string> = { 0: "12a", 6: "6a", 12: "12p", 18: "6p" };

function cellStyle(count: number, max: number): React.CSSProperties {
  if (max === 0 || count === 0) return { backgroundColor: "var(--muted)" };
  // 0..1 → faint..solid emerald. Floor keeps non-zero cells visibly tinted.
  const intensity = 0.15 + 0.85 * (count / max);
  return { backgroundColor: "var(--chart-1)", opacity: intensity };
}

export function PeakHeatmap({ heatmap, timezone }: { heatmap: Heatmap; timezone: string }) {
  const { grid, max, total } = heatmap;

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
        <p className="text-sm font-medium">No activations in the last 90 days yet</p>
        <p className="text-xs text-muted-foreground">
          Busiest times appear here once this store starts showing QR codes.
        </p>
      </div>
    );
  }

  const summary =
    heatmap.peak.busiestDowLabel && heatmap.peak.peakHourLabel
      ? `Activation heatmap, last 90 days (${timezone}). Busiest on ${heatmap.peak.busiestDowLabel} around ${heatmap.peak.peakHourLabel}. ${total} activations total.`
      : `Activation heatmap, last 90 days (${timezone}). ${total} activations total.`;

  return (
    <div className="@container" role="img" aria-label={summary}>
      <div className="overflow-x-auto">
        <div className="min-w-[480px]">
          {/* hour tick row */}
          <div className="mb-1 grid grid-cols-[2.5rem_repeat(24,1fr)] items-end gap-px">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center text-[10px] text-muted-foreground">
                {HOUR_TICKS[h] ?? ""}
              </span>
            ))}
          </div>
          {/* one row per weekday */}
          {ROW_ORDER.map((dow, i) => (
            <div key={dow} className="grid grid-cols-[2.5rem_repeat(24,1fr)] items-center gap-px">
              <span className="pr-2 text-right text-[11px] text-muted-foreground">{ROW_LABELS[i]}</span>
              {grid[dow].map((count, hour) => (
                <div
                  key={hour}
                  className="aspect-square rounded-[2px]"
                  style={cellStyle(count, max)}
                  title={`${FULL_DAY[dow]} ${hourLabel(hour)} · ${count} activation${count === 1 ? "" : "s"}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Local time — {timezone} · last 90 days
      </p>
    </div>
  );
}
