// Pure (IO-free) analytics derivations for per-store reporting. The data layer
// (lib/data.ts) runs thin SQL GROUP BY queries and feeds the compact count rows
// here; everything testable (series shaping, trend %, peak selection, revenue,
// eco) lives in this file. Bucketing is UTC, consistent across keys + SQL.

import type { TimePoint } from "./types";

/** A grouped count row from SQL: a bucket key (day "YYYY-MM-DD" or month "YYYY-MM"). */
export interface BucketCount { bucket: string; count: number }
export interface DowCount { dow: number; count: number }   // dow 0..6 (Sun..Sat, Postgres)
export interface HourCount { hour: number; count: number } // hour 0..23
export interface BucketKey { key: string; label: string }

const round2 = (n: number) => Math.round(n * 100) / 100;

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
export function bucketsToSeries(counts: BucketCount[], keys: BucketKey[], price: number): TimePoint[] {
  const byKey = new Map(counts.map((c) => [c.bucket, c.count]));
  return keys.map((k) => {
    const receipts = byKey.get(k.key) ?? 0;
    return { label: k.label, receipts, revenue: round2(receipts * price) };
  });
}
