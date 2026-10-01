# Repoint operational metrics from `document` → trigger activity

**Date:** 2026-07-02
**Status:** Draft — awaiting user review
**Context:** Follow-up #1 from the trigger-only device teardown (merged `a724a25`, deployed 2026-07-02).

## Problem

After the trigger-only pivot, Maratus no longer creates `document` rows. Every dashboard,
analytics view, and health rollup still reads the `document` table, so they display a
**frozen, stale count** (33 seed-era rows on prod) that never moves — not zero, but a
number that is now a lie. Meanwhile the real activity — devices being triggered to show a
QR — lives in `device_command` (`type='trigger'`) and is invisible to every operator
surface.

This project repoints the **operational metrics** (tenant dashboards, analytics, health)
onto live trigger activity. It deliberately does **not** touch billing — that is a
separate deferred follow-up (#2, "retire the per-print billing model").

## Metric unit

One event = **one acked trigger**:

```sql
device_command WHERE type = 'trigger' AND status = 'acked'
```

bucketed by `created_at`.

- `status='acked'` = the device fetched the command and confirmed it rendered the QR — the
  event a customer actually experienced, and the event that settled a credit.
- `created_at` (not `acked_at`) is the bucket timestamp: it is always present and matches
  the old `document.created_at` bucketing semantics. `acked_at` is seconds later and would
  add null-handling for no analytic benefit.
- **Store attribution:** `device_command` has no `store_id`. Join
  `device_command → device (on device_id) → store (via device.store_id)`. `device.store_id`
  exists, is nullable (`onDelete: set null`), and is indexed (`device_store_id_idx`).
- **Org attribution:** `device_command.organization_id` is present and non-null — use it
  directly (no join needed for org-scoped counts).

### Prod reality at design time
- `device_command type='trigger'`: 2 rows, both `acked`.
- `credit_ledger`: `settle` rows carry `action = null` (the `show_qr` tag lives only on the
  `hold` row) — this is why the ledger is **not** the chosen source; `device_command` keeps
  status + action + timestamps in one row.
- `document`: 33 stale seed rows.

## Naming

Rename **both** the internal view-model fields and the user-facing labels from
"documents" → **"Activations"**. The product has no documents anymore; leaving the word in
place would actively mislead future readers and operators.

| Old | New |
|---|---|
| `documentsToday` | `activationsToday` |
| `documentsThisMonth` | `activationsThisMonth` |
| `TimePoint.documents` | `TimePoint.activations` |
| `eco.documents` | `eco.activations` |
| `ecoYtdDocuments` | `ecoYtdActivations` |
| label "Documents" / "Documents today" / "Documents this month" | "Activations" / "Activations today" / "Activations this month" |
| chart `dataKey="documents"`, `unit="documents"` | `dataKey="activations"`, `unit="activations"` |
| "Daily digital documents, last 30 days" | "Daily activations, last 30 days" |
| "Monthly documents per store…" / "…by documents this month" | "Monthly activations per store…" / "…by activations this month" |

> **ASSUMPTION — confirm the term.** "Activations" is the working name (device activated →
> QR shown). Alternatives considered: "Triggers", "QR shows". Change once here if you prefer
> a different word; the spec/plan will propagate it.

## Scope — IN

All changes live in `lib/data.ts` (the data seam) plus the UI components that render the
renamed fields.

### `lib/data.ts` foundation
- **`loadOrg`** — the central reader. Replace the three `documentTable` queries
  (`deviceCountRows` per-device today/month, `dailyBuckets`, `monthlyBuckets`) with the same
  aggregations over `device_command` filtered `type='trigger' AND status='acked'`, scoped by
  `organization_id`, bucketed by `created_at`. Every downstream tenant/admin view inherits
  the repoint through this one loader.
- **`mapDevice`, `buildTenant`, `summarize`, `dailySeries`, `monthlySeries`, `sumSeries`** —
  carry renamed fields; no SQL change beyond field renames.

### Tenant surfaces
- `getTenantDashboard` — KPI tiles, `ecoYtdActivations = round(activationsThisMonth * 7.4)`,
  daily series.
- `getTenantStores`, `getStoresAnalytics` (cross-store comparison), `tenantDaily`,
  `tenantMonthly`, `getTenant`, `getStore`, `getDevice`.
- **`getStoreAnalytics`** — queries the source **directly** (not via `loadOrg`). Repoint
  daily/monthly and the **day-of-week × hour heatmap** to `device_command` joined to
  `device` to scope by `store_id`. Preserve the store-timezone re-anchoring of the timestamp
  (`localTs`), `extract(dow|hour)`, and the `since90` window. Revenue/eco/peak/monthTrend
  derive from the new count.

### Super-admin surfaces
- `getTenantSummaries`, `getAllDevices`, `getAdminOverview`.
- `getBillingOverview` — money stays invoice-based (unchanged); only its **activity chart
  series** (`sumSeries(monthlySeries)`) moves to triggers automatically via `loadOrg`. This
  is intentional and consistent (an admin activity chart should show real activity).

### Health / alerts (semantic remap)
Triggers use a different status model than documents (`pending | delivered | acked | failed
| expired` vs `pending | ready | downloaded`). Remap:
- **`getPlatformHealth`** — `last1h`/`last24h` = acked triggers in window; status breakdown
  grouped by `device_command.status` (over `type='trigger'`); `stuckPending` = trigger
  commands in `status='pending'` older than the cutoff (`device_command` has both `status`
  and `expires_at`); `topTenants` = acked triggers per org over 24h;
  `lastDocumentAt → lastActivationAt` = `max(created_at)` of acked triggers per org.
- **`getAlertInputs`** — mirror: `stuckPendingCount` = pending triggers past cutoff;
  per-org last-activation = `max(created_at)` of acked triggers.
- **`getCustomerDetail`** — `health.stuckPendingCount` = pending triggers past cutoff; last
  activity = `max(created_at)` of acked triggers.
- Health UI relabels: "Ingest activity" → "Trigger activity"; "Documents (1h/24h)" →
  "Activations (1h/24h)"; "Stuck pending" retained; "Stuck docs" → "Stuck pending"; the
  status-breakdown line changes to trigger statuses; heatmap empty-state / aria / cell copy
  → "activations".

### Eco / revenue tiles
Keep the formulas, swap the count source:
- Eco: `activations × 7.4` (paperless-equivalent multiplier), `eco.activations`.
- Revenue estimate tiles: `activations × perPrintPrice`. These are **estimate tiles**, not
  billing truth. They stay live rather than frozen. (The `perPrintPrice` concept is retired
  in follow-up #2; these tiles will be revisited then.)

## Scope — OUT (stays document / per-print)

Explicitly untouched — these belong to deferred follow-up #2 (retire per-print billing):
- **`lib/billing-engine.ts`** — draft-invoice generation (`count(document)` × per-print).
  Billing source of truth stays document-based.
- **`getApiUsage`** — the public `/v1/usage` partner API (scope `usage:read`). Keeps
  returning document counts so the documented API contract does not silently change.
- **`invoice.documentCount`**, billing pages (`tenant/billing`, `admin/billing`),
  `new-customer-dialog` "Charged per digital document issued.", `usage-metering`.

### Accepted transitional divergence
Because billing stays document-based while dashboards move to triggers, an operator may see
a **different count on the billing page than on the dashboard** during the transition (e.g.
invoice `documentCount` from stale/seed data vs live activation count). This is a known,
intentional interim state that resolves when follow-up #2 retires per-print billing. It will
be called out in the plan and, if warranted, with a one-line note in the billing UI.

## Non-goals
- No schema migration. `device_command` already has everything needed. The `document` and
  `usage_event` tables stay (still referenced by billing).
- No new index required for correctness; the plan will assess whether a
  `(organization_id, type, status, created_at)` partial index on `device_command` is worth
  adding for the time-bucket scans (current volume is tiny; likely deferred with a note).
- No change to the frozen trigger API contract.

## Testing
- Unit-level: the pure helpers (`sumSeries`, `dailySeries`, `monthlySeries`, eco math) keep
  their existing tests with renamed fields.
- Data-layer: seed a handful of `device_command` trigger rows (mixed status, across
  devices/stores/days) in the seed script or a test fixture and assert the repointed
  functions bucket/attribute them correctly (per-device, per-store, heatmap dow/hour,
  daily/monthly, health windows, stuck-pending).
- Regression: existing `document`-based billing tests stay green (billing untouched).
- End-to-end sanity: after deploy, the 2 real acked triggers on prod should surface on the
  tenant dashboard / analytics instead of the frozen 33.

## Rollout
Code-only change (no migration). Deploy via the standard `vercel --prod --yes`. Verify the
tenant dashboard and admin health page reflect the 2 live triggers.
