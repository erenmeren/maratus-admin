// Pure (IO-free) analytics derivations for per-store reporting. The data layer
// (lib/data.ts) runs thin SQL GROUP BY queries and feeds the compact count rows
// here; everything testable (series shaping, trend %, peak selection, revenue,
// eco) lives in this file. Bucketing is UTC, consistent across keys + SQL.

import type { TimePoint } from "./types";
import { computeEcoSavings, type EcoSavings } from "./eco";

/** A grouped count row from SQL: a bucket key (day "YYYY-MM-DD" or month "YYYY-MM"). */
export interface BucketCount { bucket: string; count: number }
export interface DowCount { dow: number; count: number }   // dow 0..6 (Sun..Sat, Postgres)
export interface HourCount { hour: number; count: number } // hour 0..23
export interface BucketKey { key: string; label: string }

/** n UTC day keys ending on `now`'s date, oldest first. */
export function dayKeys(now: Date, n: number): BucketKey[] {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const keys: BucketKey[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base - i * 86_400_000);
    keys.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    });
  }
  return keys;
}

/** n UTC month keys ending on `now`'s month, oldest first. */
export function monthKeys(now: Date, n: number): BucketKey[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const keys: BucketKey[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    keys.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
    });
  }
  return keys;
}

/** Join grouped counts onto the expected ordered keys, zero-filling gaps. */
export function bucketsToSeries(counts: BucketCount[], keys: BucketKey[]): TimePoint[] {
  const byKey = new Map(counts.map((c) => [c.bucket, c.count]));
  return keys.map((k) => {
    const activations = byKey.get(k.key) ?? 0;
    return { label: k.label, activations };
  });
}

export interface Trend {
  current: number;
  previous: number;
  /** Percent change vs previous; null when previous is 0 (undefined ratio). */
  pctChange: number | null;
}
export interface Peak {
  busiestDow: number | null;
  busiestDowLabel: string | null;
  busiestDowCount: number;
  peakHour: number | null;
  peakHourLabel: string | null;
  peakHourCount: number;
}
export interface Heatmap {
  grid: number[][]; // [7][24] — grid[dow][hour] = activation count (dow 0=Sun..6=Sat)
  max: number;      // largest single-cell count (0 when empty); drives intensity
  total: number;
  peak: Peak;       // busiest day + peak hour, derived from the grid
}
export interface StoreAnalytics {
  daily: TimePoint[];
  monthly: TimePoint[];
  monthTrend: Trend;
  eco: EcoSavings;
  peak: Peak;
  heatmap: Heatmap;
}
export interface StoreComparisonRow {
  storeId: string;
  storeName: string;
  activationsThisMonth: number;
  trend: Trend;
  eco: EcoSavings;
}

const DOW_LABELS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

export function computeTrend(current: number, previous: number): Trend {
  const pctChange = previous === 0 ? null : Math.round(((current - previous) / previous) * 100);
  return { current, previous, pctChange };
}

export function dowLabel(dow: number): string {
  return DOW_LABELS[dow] ?? "";
}

export function hourLabel(hour: number): string {
  const to12 = (h: number) => ({
    base: h % 12 === 0 ? 12 : h % 12,
    period: h < 12 ? "am" : "pm",
  });
  const start = to12(hour);
  const end = to12((hour + 1) % 24);
  return start.period === end.period
    ? `${start.base}–${end.base}${end.period}`
    : `${start.base}${start.period}–${end.base}${end.period}`;
}

/** Returns the bucket with the most activations; on a tie the first in input order wins. Empty/all-zero → null fields. */
export function pickPeakDow(rows: DowCount[]): { dow: number | null; count: number; label: string | null } {
  let best: DowCount | null = null;
  for (const r of rows) if (!best || r.count > best.count) best = r;
  if (!best || best.count === 0) return { dow: null, count: 0, label: null };
  return { dow: best.dow, count: best.count, label: dowLabel(best.dow) };
}

/** Returns the bucket with the most activations; on a tie the first in input order wins. Empty/all-zero → null fields. */
export function pickPeakHour(rows: HourCount[]): { hour: number | null; count: number; label: string | null } {
  let best: HourCount | null = null;
  for (const r of rows) if (!best || r.count > best.count) best = r;
  if (!best || best.count === 0) return { hour: null, count: 0, label: null };
  return { hour: best.hour, count: best.count, label: hourLabel(best.hour) };
}

export function buildPeak(dowRows: DowCount[], hourRows: HourCount[]): Peak {
  const d = pickPeakDow(dowRows);
  const h = pickPeakHour(hourRows);
  return {
    busiestDow: d.dow, busiestDowLabel: d.label, busiestDowCount: d.count,
    peakHour: h.hour, peakHourLabel: h.label, peakHourCount: h.count,
  };
}

/**
 * Build a 7×24 day-of-week × hour grid from sparse SQL count rows. The busiest
 * day and peak hour are derived from the grid via buildPeak (so KPIs and heatmap
 * share one source of truth). Out-of-range dow/hour rows are ignored.
 */
export function buildHeatmap(rows: { dow: number; hour: number; count: number }[]): Heatmap {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let total = 0;
  for (const r of rows) {
    if (r.dow < 0 || r.dow > 6 || r.hour < 0 || r.hour > 23) continue;
    grid[r.dow][r.hour] += r.count;
    total += r.count;
  }
  let max = 0;
  for (const row of grid) for (const c of row) if (c > max) max = c;

  const dowTotals: DowCount[] = grid.map((row, dow) => ({
    dow,
    count: row.reduce((a, c) => a + c, 0),
  }));
  const hourTotals: HourCount[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: grid.reduce((a, row) => a + row[hour], 0),
  }));

  return { grid, max, total, peak: buildPeak(dowTotals, hourTotals) };
}

export function toComparisonRows(
  input: Array<{ storeId: string; storeName: string; current: number; previous: number }>,
): StoreComparisonRow[] {
  return input
    .map((s) => ({
      storeId: s.storeId,
      storeName: s.storeName,
      activationsThisMonth: s.current,
      trend: computeTrend(s.current, s.previous),
      eco: computeEcoSavings(s.current),
    }))
    .sort((a, b) => b.activationsThisMonth - a.activationsThisMonth);
}

/** Group dates into UTC day-key ("YYYY-MM-DD") counts. Pairs with dayKeys. */
export function countByDayKey(dates: Date[]): BucketCount[] {
  const m = new Map<string, number>();
  for (const d of dates) {
    const k = d.toISOString().slice(0, 10);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([bucket, count]) => ({ bucket, count }));
}

/** Group dates into UTC month-key ("YYYY-MM") counts. Pairs with monthKeys. */
export function countByMonthKey(dates: Date[]): BucketCount[] {
  const m = new Map<string, number>();
  for (const d of dates) {
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([bucket, count]) => ({ bucket, count }));
}
