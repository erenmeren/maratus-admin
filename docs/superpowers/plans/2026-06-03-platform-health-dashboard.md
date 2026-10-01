# Platform Health Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `/admin/health` operational dashboard — fleet freshness, ingest activity, per-tenant usage, and live-computed alerts — all derived from existing tables.

**Architecture:** Pure threshold/alert logic (`lib/health.ts`, TDD) consumes summarized metrics from a single read-only `getPlatformHealth()` aggregate query layer; the page renders sections with existing `KpiCard`/`Card`. No new schema, no jobs.

**Tech Stack:** Next.js 16 App Router, Drizzle/Neon, vitest.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `lib/health.ts` | pure `isStale`, `computeAlerts`, thresholds, types | Create |
| `lib/health.test.ts` | tests | Create |
| `lib/data.ts` | `getPlatformHealth()` | Modify |
| `components/health/alerts-banner.tsx` | alert list (presentational) | Create |
| `app/(admin)/admin/health/page.tsx` | dashboard | Create |
| `lib/nav.ts` | + Health in `ADMIN_NAV` | Modify |

---

## Task 1: Pure health helpers (TDD)

**Files:** Create `lib/health.ts`, `lib/health.test.ts`.

- [ ] **Step 1: Write the failing test** `lib/health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isStale, computeAlerts, STALE_MINUTES } from "./health";

const now = new Date("2026-06-03T12:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("isStale", () => {
  it("false for never-seen (null) and paused devices", () => {
    expect(isStale(null, "online", now)).toBe(false);
    expect(isStale(minsAgo(60), "paused", now)).toBe(false);
  });
  it("false when seen within the threshold, true when older", () => {
    expect(isStale(minsAgo(STALE_MINUTES - 1), "online", now)).toBe(false);
    expect(isStale(minsAgo(STALE_MINUTES + 1), "online", now)).toBe(true);
  });
  it("false exactly at the threshold (strictly greater)", () => {
    expect(isStale(minsAgo(STALE_MINUTES), "online", now)).toBe(false);
  });
});

describe("computeAlerts", () => {
  it("no alerts when everything is clear", () => {
    expect(computeAlerts({ staleCount: 0, stuckPendingCount: 0, inactiveTenants: [] })).toEqual([]);
  });
  it("warns on stale devices and stuck receipts", () => {
    const a = computeAlerts({ staleCount: 3, stuckPendingCount: 2, inactiveTenants: [] });
    expect(a.map((x) => x.key)).toEqual(["devices-stale", "receipts-stuck"]);
    expect(a.every((x) => x.severity === "warning")).toBe(true);
  });
  it("emits one info per inactive tenant", () => {
    const a = computeAlerts({ staleCount: 0, stuckPendingCount: 0, inactiveTenants: [{ id: "o1", name: "Acme" }] });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ key: "tenant-inactive:o1", severity: "info" });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- lib/health.test.ts`

- [ ] **Step 3: Implement `lib/health.ts`:**

```ts
// lib/health.ts
// Pure operational-health thresholds + alert rules (no IO).

export const STALE_MINUTES = 15;
export const STUCK_PENDING_MINUTES = 30;
export const INACTIVE_DAYS = 7;

export type AlertSeverity = "info" | "warning";
export interface HealthAlert {
  key: string;
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

/** Derive the live alert list from summarized metrics. */
export function computeAlerts(input: {
  staleCount: number;
  stuckPendingCount: number;
  inactiveTenants: { id: string; name: string }[];
}): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  if (input.staleCount > 0)
    alerts.push({
      key: "devices-stale",
      severity: "warning",
      message: `${input.staleCount} device(s) not seen in ${STALE_MINUTES}+ minutes`,
    });
  if (input.stuckPendingCount > 0)
    alerts.push({
      key: "receipts-stuck",
      severity: "warning",
      message: `${input.stuckPendingCount} receipt(s) stuck pending ${STUCK_PENDING_MINUTES}+ minutes`,
    });
  for (const t of input.inactiveTenants)
    alerts.push({
      key: `tenant-inactive:${t.id}`,
      severity: "info",
      message: `${t.name}: no receipts in ${INACTIVE_DAYS} days`,
    });
  return alerts;
}
```

- [ ] **Step 4: Run, expect PASS**; then `npm test` (full suite green).

Run: `npm test -- lib/health.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/health.ts lib/health.test.ts
git commit -m "feat: add pure health thresholds and alert rules"
```

---

## Task 2: `getPlatformHealth` data layer

**Files:** Modify `lib/data.ts`.

Context: `lib/data.ts` imports from `drizzle-orm` (currently includes `and, count, desc, eq, gte, lte`), aliased tables `deviceTable`, `receiptTable`, `orgTable`. Add `lt`, `ne`, `isNotNull` to the drizzle import. Import the pure helpers.

- [ ] **Step 1: Update imports**
- Change the drizzle import to include the new operators, e.g.:
  `import { and, count, desc, eq, gte, isNotNull, lt, lte, ne } from "drizzle-orm";`
- Add: `import { computeAlerts, STALE_MINUTES, STUCK_PENDING_MINUTES, INACTIVE_DAYS, type HealthAlert } from "./health";`

- [ ] **Step 2: Append `getPlatformHealth`** to `lib/data.ts`:

```ts
export interface PlatformHealth {
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
    ready: number;
    downloaded: number;
    pending: number;
    stuckPending: number;
  };
  usage: {
    topTenants: { id: string; name: string; count: number }[];
    inactiveTenants: { id: string; name: string; lastReceiptAt: string | null }[];
  };
  alerts: HealthAlert[];
}

function zeroedHealth(): PlatformHealth {
  return {
    fleet: { total: 0, online: 0, offline: 0, paused: 0, staleCount: 0, stale: [] },
    ingest: { last1h: 0, last24h: 0, ready: 0, downloaded: 0, pending: 0, stuckPending: 0 },
    usage: { topTenants: [], inactiveTenants: [] },
    alerts: [],
  };
}

/** Read-only operational metrics across all orgs. Degrades to zeros on error. */
export async function getPlatformHealth(): Promise<PlatformHealth> {
  const now = new Date();
  const ms = (n: number) => new Date(now.getTime() - n);
  const h1 = ms(60 * 60 * 1000);
  const h24 = ms(24 * 60 * 60 * 1000);
  const staleCut = ms(STALE_MINUTES * 60 * 1000);
  const stuckCut = ms(STUCK_PENDING_MINUTES * 60 * 1000);
  const inactiveCut = ms(INACTIVE_DAYS * 24 * 60 * 60 * 1000);

  try {
    // --- Fleet ---
    const statusRows = await db
      .select({ status: deviceTable.status, c: count() })
      .from(deviceTable)
      .groupBy(deviceTable.status);
    const byStatus = { online: 0, offline: 0, paused: 0 } as Record<string, number>;
    let total = 0;
    for (const r of statusRows) {
      byStatus[r.status] = Number(r.c);
      total += Number(r.c);
    }

    const stalePred = and(
      isNotNull(deviceTable.lastSeenAt),
      lt(deviceTable.lastSeenAt, staleCut),
      ne(deviceTable.status, "paused"),
    );
    const staleRows = await db
      .select({
        deviceId: deviceTable.id,
        name: deviceTable.name,
        tenantName: orgTable.name,
        lastSeen: deviceTable.lastSeenAt,
      })
      .from(deviceTable)
      .leftJoin(orgTable, eq(deviceTable.organizationId, orgTable.id))
      .where(stalePred)
      .orderBy(deviceTable.lastSeenAt)
      .limit(50);
    const [{ staleCount }] = await db
      .select({ staleCount: count() })
      .from(deviceTable)
      .where(stalePred);

    // --- Ingest ---
    const [{ last1h }] = await db.select({ last1h: count() }).from(receiptTable).where(gte(receiptTable.createdAt, h1));
    const [{ last24h }] = await db.select({ last24h: count() }).from(receiptTable).where(gte(receiptTable.createdAt, h24));
    const breakdownRows = await db
      .select({ status: receiptTable.status, c: count() })
      .from(receiptTable)
      .where(gte(receiptTable.createdAt, h24))
      .groupBy(receiptTable.status);
    const breakdown = { ready: 0, downloaded: 0, pending: 0 } as Record<string, number>;
    for (const r of breakdownRows) breakdown[r.status] = Number(r.c);
    const [{ stuckPending }] = await db
      .select({ stuckPending: count() })
      .from(receiptTable)
      .where(and(eq(receiptTable.status, "pending"), lt(receiptTable.createdAt, stuckCut)));

    // --- Usage ---
    const topRows = await db
      .select({ id: orgTable.id, name: orgTable.name, c: count() })
      .from(receiptTable)
      .innerJoin(orgTable, eq(receiptTable.organizationId, orgTable.id))
      .where(gte(receiptTable.createdAt, h24))
      .groupBy(orgTable.id, orgTable.name)
      .orderBy(desc(count()))
      .limit(5);
    const topTenants = topRows.map((r) => ({ id: r.id, name: r.name, count: Number(r.c) }));

    const allOrgs = await db.select({ id: orgTable.id, name: orgTable.name }).from(orgTable);
    const lastRows = await db
      .select({ org: receiptTable.organizationId, last: receiptTable.createdAt })
      .from(receiptTable)
      .orderBy(desc(receiptTable.createdAt));
    const lastByOrg = new Map<string, Date>();
    for (const r of lastRows) if (!lastByOrg.has(r.org)) lastByOrg.set(r.org, r.last);
    const inactiveTenants = allOrgs
      .filter((o) => {
        const last = lastByOrg.get(o.id);
        return !last || last < inactiveCut;
      })
      .map((o) => ({
        id: o.id,
        name: o.name,
        lastReceiptAt: lastByOrg.get(o.id)?.toISOString() ?? null,
      }));

    const alerts = computeAlerts({
      staleCount: Number(staleCount),
      stuckPendingCount: Number(stuckPending),
      inactiveTenants: inactiveTenants.map((t) => ({ id: t.id, name: t.name })),
    });

    return {
      fleet: {
        total,
        online: byStatus.online ?? 0,
        offline: byStatus.offline ?? 0,
        paused: byStatus.paused ?? 0,
        staleCount: Number(staleCount),
        stale: staleRows.map((r) => ({
          deviceId: r.deviceId,
          name: r.name,
          tenantName: r.tenantName,
          lastSeen: r.lastSeen ? r.lastSeen.toISOString() : "",
        })),
      },
      ingest: {
        last1h: Number(last1h),
        last24h: Number(last24h),
        ready: breakdown.ready ?? 0,
        downloaded: breakdown.downloaded ?? 0,
        pending: breakdown.pending ?? 0,
        stuckPending: Number(stuckPending),
      },
      usage: { topTenants, inactiveTenants },
      alerts,
    };
  } catch (err) {
    console.error("[health] getPlatformHealth failed", err);
    return zeroedHealth();
  }
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; tests pass. If tsc complains about `byStatus[r.status]`/`breakdown[r.status]` index typing, the `as Record<string, number>` cast (already present) resolves it; report any other change. If `orderBy(desc(count()))` errors, use `.orderBy(desc(sql\`count(*)\`))` importing `sql` — report the change.

- [ ] **Step 4: Commit**

```bash
git add lib/data.ts
git commit -m "feat: getPlatformHealth operational metrics"
```

---

## Task 3: Alerts banner component

**Files:** Create `components/health/alerts-banner.tsx`.

- [ ] **Step 1: Write the component**

```tsx
import type { HealthAlert } from "@/lib/health";

export function AlertsBanner({ alerts }: { alerts: HealthAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-status-online/30 bg-status-online/10 px-4 py-3 text-sm text-status-online">
        All systems nominal.
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((a) => (
        <li
          key={a.key}
          className={
            a.severity === "warning"
              ? "rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              : "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
          }
        >
          {a.message}
        </li>
      ))}
    </ul>
  );
}
```

> Note: this uses `status-online` and `destructive` color tokens already used elsewhere (e.g. `tenant-status-badge.tsx`, the past_due banner). If `status-online` is not a valid token, substitute `emerald`-based classes and report.

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit`

```bash
git add components/health/
git commit -m "feat: health alerts banner component"
```

---

## Task 4: Dashboard page + nav

**Files:** Create `app/(admin)/admin/health/page.tsx`; Modify `lib/nav.ts`.

- [ ] **Step 1: Write the page** `app/(admin)/admin/health/page.tsx`:

```tsx
import { requirePlatformAdmin } from "@/lib/session";
import { getPlatformHealth } from "@/lib/data";
import { KpiCard } from "@/components/kpi-card";
import { AlertsBanner } from "@/components/health/alerts-banner";

export default async function HealthPage() {
  await requirePlatformAdmin();
  const h = await getPlatformHealth();

  return (
    <div className="flex flex-col gap-8 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Platform health</h1>

      <AlertsBanner alerts={h.alerts} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Fleet freshness</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Devices" value={String(h.fleet.total)} />
          <KpiCard label="Online" value={String(h.fleet.online)} />
          <KpiCard label="Paused" value={String(h.fleet.paused)} />
          <KpiCard label="Stale (15m+)" value={String(h.fleet.staleCount)} />
        </div>
        {h.fleet.stale.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground"><th className="py-2">Device</th><th>Tenant</th><th>Last seen</th></tr>
            </thead>
            <tbody>
              {h.fleet.stale.map((d) => (
                <tr key={d.deviceId} className="border-t">
                  <td className="py-2">{d.name}</td>
                  <td>{d.tenantName ?? "—"}</td>
                  <td>{d.lastSeen ? d.lastSeen.slice(0, 19).replace("T", " ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Ingest activity</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Receipts (1h)" value={String(h.ingest.last1h)} />
          <KpiCard label="Receipts (24h)" value={String(h.ingest.last24h)} />
          <KpiCard label="Stuck pending" value={String(h.ingest.stuckPending)} />
        </div>
        <p className="text-sm text-muted-foreground">
          Last 24h: {h.ingest.ready} ready · {h.ingest.downloaded} downloaded · {h.ingest.pending} pending
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Per-tenant usage</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Top tenants (24h)</h3>
            {h.usage.topTenants.length === 0 ? (
              <p className="text-sm text-muted-foreground">No receipts in the last 24h.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {h.usage.topTenants.map((t) => (
                  <li key={t.id} className="flex justify-between border-t py-1.5"><span>{t.name}</span><span className="text-muted-foreground">{t.count}</span></li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Inactive (7d+)</h3>
            {h.usage.inactiveTenants.length === 0 ? (
              <p className="text-sm text-muted-foreground">All tenants active.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {h.usage.inactiveTenants.map((t) => (
                  <li key={t.id} className="flex justify-between border-t py-1.5">
                    <span>{t.name}</span>
                    <span className="text-muted-foreground">{t.lastReceiptAt ? t.lastReceiptAt.slice(0, 10) : "never"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Nav** — in `lib/nav.ts`, add `HeartPulse` to the lucide import and add to `ADMIN_NAV` (after "Device Fleet"):

```ts
  { label: "Health", href: "/admin/health", icon: HeartPulse },
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean; `/admin/health` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/health/" lib/nav.ts
git commit -m "feat: platform health dashboard page"
```

> If `HeartPulse` is not a valid lucide-react export in the installed version, use `Activity` (already imported in nav for the tenant Activity link) — but a distinct icon is preferred; report the substitution.

---

## Task 5: Manual verification (human-run)

- [ ] As `admin@maratus.app`, open `/admin/health`. Confirm fleet/ingest/usage
      sections populate from seeded data (9 devices, 30 receipts, Roastwell + the
      test org).
- [ ] In `npm run db:studio`, set one online device's `last_seen_at` to several
      hours ago → reload → it appears in the stale table + a "device(s) not seen"
      warning alert shows.
- [ ] Confirm an org with no receipts in 7 days shows under "Inactive" + an info alert.
- [ ] Confirm a non-admin (tenant) cannot reach `/admin/health` (redirected by
      `requirePlatformAdmin` / the admin layout).

---

## Self-Review

- **Spec coverage:** pure helpers (T1); fleet/ingest/usage/alerts metrics (T2); alerts banner (T3); dashboard sections + nav + auth (T4); manual (T5). Degraded-render error handling is in `getPlatformHealth` (T2, try/catch → `zeroedHealth`). All spec sections mapped.
- **Placeholder scan:** no logic placeholders; the tsc/lucide/color-token notes are adaptation fallbacks (the code is complete).
- **Type consistency:** `isStale`/`computeAlerts`/`HealthAlert`/thresholds (T1) used in T2/T3; `PlatformHealth` shape (T2) consumed exactly by the page (T4) and `AlertsBanner` takes `HealthAlert[]` (T3); `KpiCard` receives string `value`s.

## Execution notes

- **Runs green now:** Task 1 (pure). T2–T4 compile without external services; the dashboard reads the DB (needs `DATABASE_URL`, present in `.env.local`).
- **No migration** — all metrics derive from existing tables/indexes.
