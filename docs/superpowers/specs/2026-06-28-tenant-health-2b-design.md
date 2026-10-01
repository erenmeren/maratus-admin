# Phase 2B — Tenant Health Drill-down + Alert Delivery — Design

**Date:** 2026-06-28
**Repo:** `maratus-admin`
**Status:** Approved design, pre-implementation
**Phase:** 2 ("feature expansion"), sub-project **2B**. Builds on **2A** (device fleet ops, merged). Sibling: **2C** audit-log UI polish.

## Problem

Platform admins can see fleet-wide health, but not **per-tenant** health, and tenants are never told when their own devices drop:
- The admin **customers list** shows only a raw total device count — no online/offline split, no traffic-light.
- The **customer detail page** renders raw stored device status (a device can read "online" while stale, because `getCustomerDetail` does NOT apply `effectiveDeviceStatus`), and has no health summary.
- **Tenant-facing alert delivery does not exist.** `evaluateAndPersistAlerts` emails only `platform_admin` users (that path is done); an org owner is never notified when their device goes offline.

2B adds per-tenant health visibility for admins and a tenant-facing offline notification, reusing 2A's `effectiveDeviceStatus`/`reconcileOfflineDevices` and 1C's email infra. **No `alert` table schema change** — per-tenant health is computed from device/document rows.

## Decisions (locked via brainstorming)

1. **Health levels** (pure rule):
   - **critical**: subscription suspended (`isSuspended`), OR has devices but zero online.
   - **warning**: any offline device, OR stuck-pending docs > 0, OR `subscriptionStatus === "past_due"`, OR inactive (no activity in `INACTIVE_DAYS`).
   - **healthy**: otherwise.
2. **Offline email is batched one-per-org-per-sweep** — group the devices flipped in a single `reconcileOfflineDevices` run by org, send ONE owner email listing them (no per-device flood).
3. **No `alert` table change** — compute per-tenant health directly.
4. **Reuse, don't refactor:** the offline-email builder reuses the exported `emailLayout`/`escapeHtml` from `lib/billing/invoice-emails.ts` (generic despite the file name); no extraction refactor.
5. **Platform-admin digest unchanged** (`alertEmail` → platform admins + `notifiedAt`).

## Architecture

### A) Pure health level — `lib/health.ts` (extend) or `lib/tenant-health.ts` (new, pure)

```ts
export type HealthLevel = "healthy" | "warning" | "critical";

export interface TenantHealthInput {
  deviceCount: number;
  onlineCount: number;
  offlineCount: number;
  subscriptionStatus: string | null;
  stuckPendingCount?: number;   // omitted in the list (cheap path) → treated as 0
  lastActivityAt?: Date | null;  // omitted in the list → inactivity not escalated
}

export function tenantHealthLevel(input: TenantHealthInput, now: Date): HealthLevel;
```

Logic (reuses `isSuspended` from `lib/billing/billing-status.ts` and `INACTIVE_DAYS` from `lib/health.ts`):
- `critical` if `isSuspended(subscriptionStatus)` OR (`deviceCount > 0 && onlineCount === 0`).
- else `warning` if `offlineCount > 0` OR `(stuckPendingCount ?? 0) > 0` OR `subscriptionStatus === "past_due"` OR (`lastActivityAt` present AND older than `INACTIVE_DAYS`).
- else `healthy`.

Pure → unit-tested for each level + precedence (critical beats warning).

### B) Admin customers list — `lib/data.ts` (`summarize`/`TenantSummary`) + `app/(admin)/admin/customers/page.tsx` + `components/.../tenant table`

- Extend `TenantSummary` (`lib/types.ts` + `summarize`) with `onlineCount: number`, `offlineCount: number`, `health: HealthLevel`. `summarize` already loads the org's devices, so compute online/offline via `effectiveDeviceStatus` and the level via `tenantHealthLevel({ deviceCount, onlineCount, offlineCount, subscriptionStatus })` — **no new query** (the cheap subset: device + subscription signals; `stuckPendingCount`/`lastActivityAt` omitted here). `subscriptionStatus` is read from the org's `tenantSettings` already loaded in the bundle (add it to the projection if not present).
- Render a **Health column**: a colored dot (`green`/`amber`/`red`) + label, plus an `online/total` hint. Reuse `StatusDot`/a small badge; place it before or after the Status column.

### C) Customer detail page — `lib/data.ts` (`getCustomerDetail`/`mapDevice`) + `app/(admin)/admin/customers/[tenantId]/page.tsx`

- **Fix:** apply `effectiveDeviceStatus` in `mapDevice` (or in `getCustomerDetail` when building the `devices` array) so the device table + any status-derived counts reflect reality. (This also fixes the existing "online while stale" display bug.)
- Add a **health summary card** at the top: online / offline / paused counts (effective), a per-org **stuck-pending** count (documents `status='pending'` older than `STUCK_PENDING_MINUTES` for this org — one filtered count), the **subscription status** badge, and the overall `tenantHealthLevel(...)` (full input: includes stuckPendingCount + lastActivityAt). Add the needed fields to `CustomerDetail` (e.g. `health`, `statusCounts`, `stuckPendingCount`, `subscriptionStatus`, `lastActivityAt`).

### D) Tenant-facing offline email — new pure builder + trigger in `reconcileOfflineDevices`

- New module `lib/devices/device-emails.ts` (pure):
  ```ts
  export function deviceOfflineEmail(input: {
    orgName: string;
    devices: { name: string; storeName: string; lastSeenLabel: string }[];
  }): { subject: string; html: string };
  ```
  Subject e.g. `"A Maratus printer went offline"` (singular) / `"N Maratus printers went offline"` (plural); body lists each device (name · store · last seen) + a link to the dashboard. Imports `emailLayout`/`escapeHtml` from `lib/billing/invoice-emails.ts`. `orgName` + device/store names escaped.
- **Trigger** in `lib/alerts-sync.ts` `reconcileOfflineDevices(now)`: after the bulk flip + per-device audit, **group `toFlip` by `organizationId`**; for each org, resolve `getOrgEmailContext(orgId)` and, if there's an owner, `sendEmail(ownerEmail, ...deviceOfflineEmail(...))`. The builder needs device name + store name + last-seen; the reconcile's `SELECT` is widened to include `name`/`storeId` (or it loads names for the flipped ids). `sendEmail` never throws / no-ops without Resend, so the cron is never broken. One email per org per sweep.

## Data flow

```
Daily /api/cron/health → evaluateAndPersistAlerts:
  reconcileOfflineDevices(now):
    flip online→offline (+audit, 2A)         ← unchanged
    group flipped by org → deviceOfflineEmail → sendEmail(owner)   ← NEW (2B)
  computeAlerts(...) → platform-admin digest (+notifiedAt)         ← unchanged

Admin /admin/customers: each row shows tenantHealthLevel (traffic-light) + online/total
Admin /admin/customers/[id]: health summary card (effective counts + stuck + subscription + level)
```

## Error handling / edge cases

- **No owner / Resend unset:** `getOrgEmailContext` → null → skip; `sendEmail` no-ops. Cron unaffected.
- **Many devices flip at once:** batched into ONE email per org (no flood).
- **Self-heal:** the flip (and thus the email) only happens on the online→offline transition; a returning device sets itself online via ingest, no email churn.
- **List cost:** the customers-list health uses only already-loaded device + subscription data (no per-row extra query). Only the single customer detail page pays for the stuck-pending count.
- **Effective-status fix scope:** changing `mapDevice` affects `getCustomerDetail` (and any other consumer of `mapDevice`) — verify consumers expect effective status (they should; raw was a latent bug). If `mapDevice` is shared with a path that needs raw status, apply the fix in `getCustomerDetail` only.

## Testing

- **Pure unit tests:**
  - `lib/tenant-health.test.ts` (or in `health.test.ts`): `tenantHealthLevel` — suspended → critical; all-offline-with-devices → critical; some offline → warning; stuck-pending → warning; past_due → warning; inactive → warning; healthy baseline; critical-beats-warning precedence; empty fleet (deviceCount 0) → not critical.
  - `lib/devices/device-emails.test.ts`: `deviceOfflineEmail` — singular vs plural subject; each device name + store + lastSeen present; a malicious org/device name is escaped.
- **Existing suite green** (`npm run test`, 286 → grows) + `npm run build` + `npx tsc --noEmit`.
- **Manual / cron checks (deferred):** `/admin/customers` shows the Health column; `/admin/customers/[id]` shows the health card with effective counts; triggering `/api/cron/health` with a stale online device flips it AND (with Resend configured) sends the owner one offline email.

## Out of scope

- **2C:** audit-log UI polish (labels/filter/pagination).
- Threshold-configuration UI (the `STALE_MINUTES`/`STUCK_PENDING_MINUTES`/`INACTIVE_DAYS` constants stay hardcoded).
- Health trend/sparklines over time (point-in-time only).
- Adding `organizationId` to the `alert` table (not needed — health computed from source rows).
- A tenant-facing "stuck documents" or "back online" email (only the offline notification; YAGNI).
