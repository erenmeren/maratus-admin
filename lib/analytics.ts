// Pure (IO-free) analytics derivations for per-store reporting. The data layer
// (lib/data.ts) runs thin SQL GROUP BY queries and feeds the compact count rows
// here; everything testable (series shaping, trend %) lives in this file.
// Bucketing is UTC, consistent across keys + SQL.

import type { TimePoint } from "./types";

/** A grouped count row from SQL: a bucket key (day "YYYY-MM-DD" or month "YYYY-MM"). */
export interface BucketCount { bucket: string; count: number }
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
export interface StoreAnalytics {
  daily: TimePoint[];
  monthly: TimePoint[];
  monthTrend: Trend;
}

export function computeTrend(current: number, previous: number): Trend {
  const pctChange = previous === 0 ? null : Math.round(((current - previous) / previous) * 100);
  return { current, previous, pctChange };
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
