# Phase 2 — Platform Health Dashboard Design

_Last updated: 2026-06-03_

## Context

`/admin` already shows **business** KPIs (tenants, devices, receipts, revenue) +
receipts/revenue charts + a tenant list. This feature adds a separate
**operational health** view for platform admins: fleet freshness, ingest
activity, per-tenant usage, and computed alerts — all derived live from existing
tables (`device`, `receipt`, `organization`).

Two data realities scoped this feature:
- **No ingest-error data exists** (the ingest route doesn't persist failures), so
  "error rate" is out of scope until logging/Sentry is added.
- **Nothing auto-flips `device.status` to offline** (that's the separate
  "offline detection" feature), so fleet freshness is computed from
  **`lastSeenAt` staleness**, not the `status` field.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Sections | Fleet freshness · Ingest activity · Per-tenant usage · Computed alerts (all four) |
| Alerts | **Live-computed per page load** (no storage/cron/email). Persistence + cron + email is a deferred Spec B (needs Vercel + Resend). |
| Thresholds | stale = **15 min**, stuck-pending = **30 min**, inactive tenant = **7 days** |
| Stale definition | A device that **was active then went quiet**: `lastSeenAt` not null, `< now − 15 min`, status ≠ `paused`. Excludes paused + never-seen devices. |

## Goals

1. A platform admin sees, at `/admin/health`: which devices have gone quiet,
   how ingest is flowing, which tenants are busiest/inactive, and any active alerts.
2. All metrics computed live from existing tables — no new schema, no jobs.
3. Threshold/alert logic is pure and unit-tested.

## Non-Goals (deferred)

- **Spec B:** persisted `alert` table, scheduled evaluator (Vercel Cron),
  email notifications on trip.
- Ingest **error rate** (no error data persisted yet).
- Auto-marking devices offline (separate "offline detection" feature).
- Time-series charts of health (the existing `/admin` charts cover receipt trends).

---

## Architecture

### 1. Pure health logic (`lib/health.ts`)

```ts
export const STALE_MINUTES = 15;
export const STUCK_PENDING_MINUTES = 30;
export const INACTIVE_DAYS = 7;

export type AlertSeverity = "info" | "warning";
export interface HealthAlert {
  key: string;            // stable id, e.g. "devices-stale" / "tenant-inactive:<orgId>"
  severity: AlertSeverity;
  message: string;
}

/** A device that was active then went quiet (not paused, has been seen). */
export function isStale(
  lastSeenAt: Date | null,
  status: string,
  now: Date,
  thresholdMinutes = STALE_MINUTES,
): boolean {
  if (!lastSeenAt || status === "paused") return false;
  return now.getTime() - lastSeenAt.getTime() > thresholdMinutes * 60_000;
}

/** Derive the live alert list from summarized metrics. Pure. */
export function computeAlerts(input: {
  staleCount: number;
  stuckPendingCount: number;
  inactiveTenants: { id: string; name: string }[];
}): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  if (input.staleCount > 0)
    alerts.push({ key: "devices-stale", severity: "warning",
      message: `${input.staleCount} device(s) not seen in ${STALE_MINUTES}+ minutes` });
  if (input.stuckPendingCount > 0)
    alerts.push({ key: "receipts-stuck", severity: "warning",
      message: `${input.stuckPendingCount} receipt(s) stuck pending ${STUCK_PENDING_MINUTES}+ minutes` });
  for (const t of input.inactiveTenants)
    alerts.push({ key: `tenant-inactive:${t.id}`, severity: "info",
      message: `${t.name}: no receipts in ${INACTIVE_DAYS} days` });
  return alerts;
}
```

These are IO-free and unit-tested. `now` is always injected (never `Date.now()` inside).

### 2. Metrics data layer (`lib/data.ts`)

`getPlatformHealth(): Promise<PlatformHealth>` runs the aggregate queries (all
orgs) with `const now = new Date()` and returns:

```ts
interface PlatformHealth {
  fleet: {
    total: number;
    online: number;
    offline: number;
    paused: number;
    staleCount: number;
    stale: { deviceId: string; name: string; tenantName: string | null; lastSeen: string }[];
  };
  ingest: {
    last1h: number;
    last24h: number;
    ready: number;        // last 24h status breakdown
    downloaded: number;
    pending: number;
    stuckPending: number; // pending older than 30 min
  };
  usage: {
    topTenants: { id: string; name: string; count: number }[]; // last 24h, top 5
    inactiveTenants: { id: string; name: string; lastReceiptAt: string | null }[];
  };
  alerts: HealthAlert[];  // = computeAlerts(...) over the above
}
```

Query sketch (Drizzle; uses `count`, `gte`, `lt`, `and`, `desc`, `isNotNull`, `ne`, `groupBy`):
- **Fleet status:** `select status, count(*) group by status` over `device`.
- **Stale list:** `device ⋈ organization` where `lastSeenAt IS NOT NULL AND lastSeenAt < now-15m AND status <> 'paused'`, ordered `lastSeenAt asc`, limit 50; `staleCount` from the same predicate.
- **Ingest counts:** `count` of `receipt` where `createdAt >= now-1h`; `>= now-24h`; status breakdown = `count` per status where `createdAt >= now-24h`; `stuckPending` = `count` where `status='pending' AND createdAt < now-30m`.
- **Top tenants:** `receipt ⋈ organization` where `createdAt >= now-24h`, `group by org`, `count desc`, limit 5.
- **Inactive tenants:** orgs with no receipt in `now-7d` — left-style: for each org, max(receipt.createdAt); keep those with none in the window (or `NOT EXISTS`). Include `lastReceiptAt`.

Then `alerts = computeAlerts({ staleCount, stuckPendingCount: stuckPending, inactiveTenants })`.

### 3. Dashboard page (`app/(admin)/admin/health/page.tsx`)

`requirePlatformAdmin()` → `getPlatformHealth()`. Layout (reusing `KpiCard` /
`Card`):
- **Alerts** banner/list at top (empty → "All systems nominal").
- **Fleet freshness:** KPI row (total / online / stale) + a stale-device table
  (device, tenant, last seen).
- **Ingest activity:** KPI row (1h / 24h / stuck-pending) + status breakdown.
- **Per-tenant usage:** top-5 leaderboard + inactive-tenant list.

Add `{ label: "Health", href: "/admin/health", icon: HeartPulse }` to `ADMIN_NAV`.

### 4. Components

A small `components/health/alerts-banner.tsx` (presentational) for the alert list
(color by severity). The metric sections are rendered inline in the page using
existing `Card`/`KpiCard` (no new heavy components).

---

## Error handling

- Queries are read-only aggregates; an empty platform yields zeros + "All systems nominal".
- A failed sub-query shouldn't blank the whole page — wrap `getPlatformHealth` so
  a partial failure logs and returns zeroed blocks rather than throwing (the page
  still renders). (Acceptable simpler alternative: let it throw to the error
  boundary — but prefer degraded render.)

## Testing

- **Pure unit (TDD):** `isStale` — null lastSeen → false; paused → false; exactly
  at threshold vs over; fresh → false. `computeAlerts` — no alerts when all clear;
  warning when stale/stuck > 0; one info per inactive tenant; combined.
- **tsc + build** gate the query/page integration.
- **Manual:** open `/admin/health` as `admin@maratus.app`; age a seeded device's
  `lastSeenAt` (db studio) → it appears in the stale list + a warning alert shows.

## File structure

| File | Responsibility | New? |
|---|---|---|
| `lib/health.ts` | pure `isStale`, `computeAlerts`, thresholds, types | Create |
| `lib/health.test.ts` | tests | Create |
| `lib/data.ts` | `getPlatformHealth()` | Modify |
| `components/health/alerts-banner.tsx` | alert list (presentational) | Create |
| `app/(admin)/admin/health/page.tsx` | the dashboard | Create |
| `lib/nav.ts` | + Health in `ADMIN_NAV` | Modify |

## Sequencing

1. Pure helpers + tests.
2. `getPlatformHealth` data layer.
3. Alerts banner component.
4. Dashboard page + nav.
5. Manual verification.
