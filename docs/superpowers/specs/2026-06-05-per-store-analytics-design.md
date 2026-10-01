# Per-Store Analytics — Design

_Date: 2026-06-05_

## Context

Tenants (store chains on Maratus) can see org-wide reports (`/tenant/reports`:
monthly receipts, a basic "by store this month" bar, by-device, eco) and a
current-snapshot store page (`/tenant/stores/[storeId]`: KPIs + device cards).
What's missing: **per-store trends over time**, **period-over-period change**,
operational patterns (**busiest day / peak hour**), and a **store-vs-store
comparison** beyond a single this-month bar.

This is the Phase 2 "per-store analytics" roadmap item.

### Decisions (locked during brainstorming)

- **Two surfaces:** (1) enrich the existing store detail page into a single-store
  deep view, and (2) a **new `/tenant/analytics` page** for cross-store comparison.
- **Metrics:** receipts-over-time + trend (this period vs last), revenue
  (receipts × per-print price), eco savings, busiest day-of-week + peak hour.
- **Time range:** fixed — daily (~last 30 days) and monthly (~last 9 months),
  matching existing chart patterns. No range picker.
- **Aggregation: hybrid.** SQL `GROUP BY` returns compact per-store/per-bucket
  counts; pure helpers in a new `lib/analytics.ts` do all derivations (trend %,
  revenue, eco, peak selection, series shaping). This is the codebase's
  "pure mappers + IO" split (cf. `lib/billing/billing-status.ts` + `stripe-billing.ts`).

## Guiding principles

- **Heavy logic is pure and unit-tested.** All bucketing/trend/peak math lives in
  `lib/analytics.ts` (IO-free); `lib/data.ts` only runs queries and calls it.
- **Reuse existing components and types.** `TimePoint`, `BreakdownDatum`,
  `ReceiptsAreaChart`, `MetricAreaChart`, `BreakdownBarChart`, `KpiCard`,
  `EcoSavingsCard`, `ExportButton`, `computeEcoSavings`. One new chart only.
- **Org-scoped.** Both data functions are scoped to the active org; the store page
  verifies `store.organizationId === organizationId` (as `getStore` already does).
- **UTC bucketing**, consistent with the existing `dailySeries`/`monthlySeries`.
  Noted as a known caveat (no per-tenant timezone yet).

---

## Data layer

### New file: `lib/analytics.ts` (pure, IO-free, unit-tested)

Types:

```ts
import type { TimePoint } from "./types";
import { computeEcoSavings, type EcoSavings } from "./eco";

/** A grouped count row from SQL: one bucket key + its receipt count. */
export interface BucketCount {
  bucket: string; // ISO day "2026-06-05" or month "2026-06" (date_trunc output, stringified)
  count: number;
}
export interface DowCount { dow: number; count: number }   // dow 0..6 (Sun..Sat)
export interface HourCount { hour: number; count: number } // hour 0..23

export interface Trend {
  current: number;
  previous: number;
  /** Percent change vs previous; null when previous is 0 (can't divide). */
  pctChange: number | null;
}
export interface Peak {
  /** null when the store has no receipts in range. */
  busiestDow: number | null;
  busiestDowLabel: string | null;  // e.g. "Saturdays"
  busiestDowCount: number;
  peakHour: number | null;
  peakHourLabel: string | null;    // e.g. "12–1pm"
  peakHourCount: number;
}
export interface StoreAnalytics {
  daily: TimePoint[];      // zero-filled, last 30 days
  monthly: TimePoint[];    // zero-filled, last 9 months
  monthTrend: Trend;       // this calendar month vs last
  revenueThisMonth: number;
  eco: EcoSavings;         // for this month's receipts
  peak: Peak;
}
export interface StoreComparisonRow {
  storeId: string;
  storeName: string;
  receiptsThisMonth: number;
  trend: Trend;
  revenueThisMonth: number;
  eco: EcoSavings;
}
```

Pure functions:

- `bucketsToSeries(rows: BucketCount[], buckets: string[], price: number): TimePoint[]`
  — given grouped counts and the ordered list of expected bucket keys (the caller
  generates the 30 day-keys / 9 month-keys), produce a **zero-filled** `TimePoint[]`
  in order: `{ label, receipts: count, revenue: round2(count * price) }`. Missing
  buckets → 0. `label` formatted like the existing series ("May 24", "Jan").
- `computeTrend(current: number, previous: number): Trend` — `pctChange =
  previous === 0 ? null : round((current - previous) / previous * 100)`.
- `pickPeakDow(rows: DowCount[]): {dow, count, label} ` and
  `pickPeakHour(rows: HourCount[]): {hour, count, label}` — argmax (first on ties);
  empty → null fields. Label helpers: `dowLabel(0)="Sundays"`, `hourLabel(12)="12–1pm"`,
  `hourLabel(0)="12–1am"`, `hourLabel(23)="11pm–12am"`.
- `buildPeak(dowRows, hourRows): Peak` — composes the two pickers.
- `toComparisonRows(input: Array<{ storeId; storeName; current; previous; price }>):
  StoreComparisonRow[]` — maps each to a row (`computeTrend`, revenue, `computeEcoSavings(current)`),
  sorted by `receiptsThisMonth` desc.

### `lib/data.ts` (IO; calls the pure helpers)

- `getStoreAnalytics(storeId: string): Promise<{ store: Store; analytics: StoreAnalytics } | null>`
  - Look up the store (and its org) as `getStore` does; return `null` if missing.
  - Run grouped queries **filtered to this `storeId`**:
    - daily counts over the last 30 days: `date_trunc('day', created_at)`.
    - monthly counts over the last 9 months: `date_trunc('month', created_at)`.
    - day-of-week counts (whole range, e.g. last 90 days): `extract(dow ...)`.
    - hour counts (same range): `extract(hour ...)`.
    - this-month and last-month totals (or derive from the monthly series).
  - Build `StoreAnalytics` via the pure helpers; `price = dollars(perPrintPriceCents)`.
  - Returns `store` so the page can render headers without a second load.
- `getStoresAnalytics(organizationId: string): Promise<{ rows: StoreComparisonRow[];
  monthlyByStore: Array<{ storeId: string; storeName: string; monthly: TimePoint[] }> }>`
  - One grouped query: receipts per `storeId` for this month + last month → `toComparisonRows`.
  - One grouped query: receipts per `storeId` per month (last 9) → per-store `bucketsToSeries`
    for the multi-line compare chart.
  - Degrades to empty arrays on error (cf. `getPlatformHealth`).

SQL: Drizzle aggregate selects on `receipt` using `sql` for `count(*)`,
`date_trunc(...)`, and `extract(...)`, filtered by `organizationId` (+ `storeId`
for the single-store fns) and the time window. Empty results are valid (a store
with no receipts → all-zero series, null peaks).

---

## Surfaces

### 1. Store detail page — `app/(tenant)/tenant/stores/[storeId]/page.tsx`

Add an **Analytics** section after the existing KPI row (keep KPIs + device cards):

- **Receipts over time** card — `ReceiptsAreaChart data={analytics.daily}` (last 30 days).
- **Stat row** (`KpiCard`s): Trend (this month vs last, `▲/▼ {pct}%`, or "new" when
  previous = 0), Revenue this month, Paper saved (`eco`), Busiest day
  (`peak.busiestDowLabel ?? "—"`), Peak hour (`peak.peakHourLabel ?? "—"`).
- Call `getStoreAnalytics(storeId)`; the page already calls `getStore` — replace with
  the analytics fn (which returns `store` too) or call alongside. Verify
  `store.organizationId === organizationId` → `notFound()` otherwise.

### 2. New Analytics page — `app/(tenant)/tenant/analytics/page.tsx`

`requireTenant()` → `getStoresAnalytics(organizationId)`. Renders:

- **PageHeader** "Analytics" + `ExportButton` (CSV of the comparison rows:
  Store, Receipts (mo), Trend %, Revenue, Paper saved).
- **Store comparison** card: `BreakdownBarChart` of receipts-by-store, plus a
  ranked list/cards showing each store's trend ▲/▼, revenue, eco.
- **Trajectories** card: new `StoreCompareChart` — a multi-line monthly chart,
  one line per store, from `monthlyByStore`.
- Empty state when the org has no stores/receipts.

Add to `TENANT_NAV` (`lib/nav.ts`): `{ label: "Analytics", href: "/tenant/analytics",
icon: LineChart }` (lucide `LineChart`), placed after "Reports".

### Components — `components/charts.tsx`

- **New `StoreCompareChart`**: `data: { storeName: string; monthly: TimePoint[] }[]`
  → recharts `LineChart` with one `<Line>` per store over a shared month axis,
  using the existing chart color tokens + `ResponsiveContainer`. Self-contained.
- Everything else reused as-is.

---

## Testing

`lib/analytics.test.ts` (vitest, `lib/**/*.test.ts` convention):

- `bucketsToSeries`: zero-fills missing buckets; preserves bucket order; computes
  revenue = count × price (rounded); maps labels.
- `computeTrend`: normal (+/-), `previous = 0` → `pctChange: null`, both zero.
- `pickPeakDow` / `pickPeakHour`: argmax, tie → first, empty → null.
- `dowLabel` / `hourLabel`: boundary hours (0 → "12–1am", 12 → "12–1pm", 23 →
  "11pm–12am") and all 7 dow labels.
- `toComparisonRows`: sorted by receipts desc; trend/revenue/eco mapped; empty input → `[]`.
- Empty-store path: all-zero series + null peaks produce a coherent `StoreAnalytics`.

Data functions (`getStoreAnalytics`, `getStoresAnalytics`) are IO — not unit-tested,
per codebase convention. Verified via `npm run build` + manual page render.

## Out of scope

- Selectable/custom date ranges; hourly heatmaps.
- Admin (cross-tenant) store analytics.
- Revenue from Stripe actuals (uses per-print price only, as elsewhere).
- Per-tenant timezone (UTC bucketing, like existing series).

## Follow-ups

- Per-tenant timezone for bucketing once tenants span regions.
- Move `dailySeries`/`monthlySeries` (org-wide) onto the same SQL-aggregate path
  if in-memory receipt loading becomes a bottleneck (not now — out of scope).
