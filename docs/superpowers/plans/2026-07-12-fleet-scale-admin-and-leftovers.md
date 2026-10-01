# Fleet-Scale Admin Fleet + Unpaginated Leftovers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the fleet-scale list infrastructure (spec `docs/superpowers/specs/2026-07-12-fleet-scale-tenant-lists-design.md`, follow-up section) to the admin Device Fleet page, and remove the remaining unpaginated `getTenantStores` callers (tenant dashboard top-stores, tenant reports).

**Architecture:** Reuse `lib/list-params.ts`, `ListControls`, `PaginationBar` unchanged. `getTenantStoresPage` gains an optional `sort: "name" | "activations"` (default `"name"`). A new `getAdminDevicesPage` mirrors `getTenantDevicesPage` without the org filter, joining org name and searching it too. `getAllDevices`'s bundle-loading remains for now ONLY if other callers exist — the admin devices page stops using it.

**Tech Stack:** Same as the tenant wave: Next.js 16 RSC + searchParams, drizzle raw `sql`, shadcn radix-nova, vitest.

## Global Constraints

- ⚠️ `.env.local` = PROD Neon: db:migrate/db:push/db:seed and any DB-connecting script FORBIDDEN. Code-only.
- All list semantics identical to the tenant wave: STORED `device.status`; pool = `store_id IS NULL AND claimed_at IS NOT NULL`; physical-status tabs include pool; counts respect `q` not the active status filter; totals honest (never `count(*) over ()` on the page query); `PAGE_SIZE`/`escapeLike`/`parseListParams` from `lib/list-params`; ILIKE parameterized; Date params in raw SQL ALWAYS `${d.toISOString()}::timestamp` (never a raw Date — local-wallclock serialization trap); LIMIT/OFFSET orderings always carry a unique `id` tiebreak.
- Admin lists show ALL devices claimed or not? NO — same claimed-only rule as tenant lists, with one admin addition: an extra `unclaimed` tab (provisioned rows with `claimed_at IS NULL`) because admins provision devices and need to see pending ones. `all` = claimed devices (matches tenant semantics); `unclaimed` is a separate location-style tab like `pool`.
- Existing admin Device Fleet columns/links must be preserved where the data still exists (read the current page first): device name/link to `/admin/devices/[deviceId]`, org (customer) name, store name, status, firmware badge, last seen.
- Gates per task: `npx tsc --noEmit && npm test && npm run build`.
- Prod domain: https://ditto-admin-brown.vercel.app.

---

### Task 1: Data layer — `sort` option + `getAdminDevicesPage`

**Files:**
- Modify: `lib/data.ts` (extend `getTenantStoresPage`; add `AdminDeviceListRow`, `AdminDeviceListPage`, `getAdminDevicesPage`; possibly extend `DeviceStatusFilter` usage)
- Modify: `lib/list-params.ts` + `lib/list-params.test.ts` (add `"unclaimed"` to `DeviceStatusFilter` — TDD the parser change)

**Interfaces:**
- Consumes: existing `getTenantStoresPage`/`getTenantDevicesPage` shapes, `PAGE_SIZE`, `escapeLike`.
- Produces:
  - `parseListParams` accepts `status: "unclaimed"` as valid (test: `parseListParams({status:"unclaimed"}).status === "unclaimed"`).
  - `getTenantStoresPage(organizationId, { q, page, sort })` where `sort?: "name" | "activations"` (default `"name"`); `sort: "activations"` orders `activations desc, s.name asc, s.id asc`. Everything else unchanged.
  - `interface AdminDeviceListRow { id: string; name: string; serial: string | null; orgId: string; orgName: string; storeId: string | null; storeName: string | null; status: DeviceStatus; firmwareVersion: string; lastSeen: string; claimed: boolean }`
  - `interface AdminDeviceListPage { rows: AdminDeviceListRow[]; total: number; counts: { all: number; online: number; offline: number; paused: number; pool: number; unclaimed: number } }`
  - `getAdminDevicesPage({ q, status, page }): Promise<AdminDeviceListPage>`

- [ ] **Step 1 (TDD): extend DeviceStatusFilter with "unclaimed"** — add the failing test first (valid-status loop gains `"unclaimed"`), see it fail, add the value to `STATUSES` + the union type, see it pass.

- [ ] **Step 2: `sort` option on getTenantStoresPage** — signature `opts: { q: string; page: number; sort?: "name" | "activations" }`; ORDER BY becomes:
```ts
const orderBy = opts.sort === "activations"
  ? sql`coalesce(act.n, 0) desc, s.name asc, s.id asc`
  : sql`s.name asc, s.id asc`;
```
interpolated as `order by ${orderBy}`. No other changes.

- [ ] **Step 3: `getAdminDevicesPage`** — mirror `getTenantDevicesPage`'s two-query shape with these deltas: no `organization_id` filter; join `organization o on o.id = d.organization_id` and select `o.id as org_id, o.name as org_name, d.firmware_version, d.claimed_at`; search predicate adds `or o.name ilike ${like}`; claimed-rule: base predicate is `d.claimed_at is not null` EXCEPT when `status = 'unclaimed'` (then `d.claimed_at is null`); `statusCond` handles `all` (true), `pool` (`d.store_id is null` — combined with the claimed base), `unclaimed` (handled via the base predicate swap; statusCond true), physical statuses (`d.status = ${status}`). Counts query computes all six counts in ONE pass over claimed+unclaimed rows:
```sql
select count(*) filter (where d.claimed_at is not null)::int                              as all_count,
       count(*) filter (where d.claimed_at is not null and d.status = 'online')::int      as online,
       count(*) filter (where d.claimed_at is not null and d.status = 'offline')::int     as offline,
       count(*) filter (where d.claimed_at is not null and d.status = 'paused')::int      as paused,
       count(*) filter (where d.claimed_at is not null and d.store_id is null)::int       as pool,
       count(*) filter (where d.claimed_at is null)::int                                   as unclaimed
from device d
left join store s on s.id = d.store_id
join organization o on o.id = d.organization_id
where (${q} = '' or d.name ilike ${like} or d.serial ilike ${like} or s.name ilike ${like} or o.name ilike ${like})
```
`total` = counts[status] mapping (all→all_count, pool→pool, unclaimed→unclaimed, else physical). Order `d.name asc, d.id asc`. `lastSeen` = `coalesce(last_seen_at, created_at)` ISO. `claimed` = `claimed_at is not null`.

- [ ] **Step 4: gates** — `npx tsc --noEmit && npm test && npm run build`.

- [ ] **Step 5: commit** — `feat(lists): admin fleet page query + activations sort + unclaimed filter`

---

### Task 2: Pages — admin Device Fleet rework, tenant dashboard top-stores, reports swap

**Files:**
- Modify: `app/(admin)/admin/devices/page.tsx` (full rework onto `getAdminDevicesPage` + `ListControls` + `PaginationBar`)
- Modify: `app/(tenant)/tenant/page.tsx` (replace `getTenantStores` with `getTenantStoresPage(..., { q: "", page: 1, sort: "activations" })`, take `rows.slice(0, 4)` as topStores — field names identical, JSX untouched)
- Modify: `app/(tenant)/tenant/reports/page.tsx` (read the page: replace its `getTenantStores` call with `getTenantStoresPage` sorted by activations; if it renders a full per-store table, cap it at the first page (50) and add `PaginationBar` if the page structure allows it cheaply — otherwise cap at 50 with a muted "showing top 50 stores by activations" note; judgment call, document it)

**Interfaces:**
- Consumes: everything from Task 1; `ListControls`/`PaginationBar`/`parseListParams` from the tenant wave; existing admin page components (read the current page for `getTenants` usage — if it only feeds a filter dropdown or name lookup, drop it; org name now comes from the row).
- Produces: `/admin/devices?q=&status=&page=` with six tabs (All/Online/Offline/Paused/Unassigned/Unclaimed).

- [ ] **Step 1: admin devices page** — mirror the tenant devices page structure (searchParams → parseListParams → data → ListControls with six tabs → table → PaginationBar with `pathname="/admin/devices"`). Preserve the current page's columns and row link (`/admin/devices/[deviceId]` — verify against the existing file) and add the Customer (org name) column; keep the firmware badge markup from the current page. No admin assign/move actions in this wave (admin move exists on the customer page).
- [ ] **Step 2: tenant dashboard** — swap to `getTenantStoresPage` as above; delete the `getTenantStores` import if now unused in the file.
- [ ] **Step 3: reports page** — per the judgment call above; keep the rest of the page untouched.
- [ ] **Step 4:** grep `getTenantStores\b` — if zero callers remain, delete it (and note whether `getAllDevices` still has callers; if zero, delete it too along with any now-orphaned helpers it alone used — verify by grep, list in the report).
- [ ] **Step 5: gates** — `npx tsc --noEmit && npm test && npm run build`.
- [ ] **Step 6: commit** — `feat(admin): paginated searchable device fleet; retire unpaginated store/device loaders`

---

### Task 3: Live QA + deploy

- [ ] Deploy: push main after merge + `vercel deploy --prod`.
- [ ] QA (Playwright, native-click quirk applies), signed in as admin@maratus.app on https://ditto-admin-brown.vercel.app:
  1. /admin/devices: six tabs with counts; search by serial `e8f60ae0b580`, by org name `Starbucks`, by store `Kadikoy`; bogus q → empty state; tab URLs correct; row links to device detail work.
  2. Unclaimed tab: provision a device from the customer page if none exists (creates an unclaimed row), verify it appears ONLY under Unclaimed, then delete it (admin device actions) — restore state.
  3. Tenant dashboard (workspace: erenmeren88's Starbucks — needs that login; otherwise verify by code inspection + screenshot of admin view only, and note it): greeting + top-stores block renders.
  4. Out-of-range: /admin/devices?page=99 honest empty.
- [ ] Record results in the ledger; note follow-ups.
