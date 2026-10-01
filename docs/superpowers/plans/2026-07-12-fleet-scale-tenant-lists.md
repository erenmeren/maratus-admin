# Fleet-Scale Tenant Stores & Devices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tenant Stores page scale to ~2,000 stores and add a new org-wide tenant Devices page (~4,000 devices) — server-driven pagination, URL-state search/filters, status tabs, and inline assign/move actions.

**Architecture:** Search/filter/page state lives in the URL; server components fetch exactly one 50-row page per request via two new paginated SQL functions in `lib/data.ts` (single round trip with `count(*) over ()`). A pure `lib/list-params.ts` module owns URL parsing (TDD'd). Two shared components (debounced `ListControls`, link-based `PaginationBar`) serve both pages. Devices-page actions share a searchable `StorePickerDialog` calling the existing `assignDeviceToStore`.

**Tech Stack:** Next.js 16 App Router (RSC + searchParams), Drizzle `sql` template over neon-http, shadcn radix-nova (`Command`, `Dialog`, `Tabs` not required — pill links suffice), vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-fleet-scale-tenant-lists-design.md`. Tenant workspace ONLY (admin pages are a later spec).
- ⚠️ `.env.local` = PROD Neon. `db:migrate`/`db:push`/`db:seed` FORBIDDEN. No migration exists in this feature (code-only). Do not run scripts that write to the DB; live QA happens only in Task 6 through the deployed UI.
- Page size = 50 (`PAGE_SIZE` in `lib/list-params.ts` — single source).
- Status semantics = STORED `device.status` column (matches `buildTenant`; do NOT re-derive from `lastSeenAt`).
- Pool = `store_id IS NULL AND claimed_at IS NOT NULL`. All lists show claimed devices only.
- Online/Offline/Paused tabs INCLUDE pool devices; Pool tab filters by location. Tab counts obey the same rule and always reflect the current `q`.
- Activation definition byte-identical to today: `device_command` rows `type='trigger' AND status='acked'`, `created_at >= ` first instant of the current UTC month.
- Search is `ILIKE` with `\`, `%`, `_` escaped; `q` trimmed, max 100 chars.
- Layout: pages return fragments; `PageHeader` / section rhythm per CLAUDE.md; shadcn style radix-nova (never the `base` color system).
- Assign/move visible only to owner/admin (`canManage` — same gate the pages already compute); viewing open to all members.
- Gates per task: `npx tsc --noEmit && npm test && npm run build` (build may be skipped for the pure-logic Task 1: tsc + tests suffice).
- Production domain for QA/smoke: **https://ditto-admin-brown.vercel.app** (NOT ditto-admin.vercel.app — that is a foreign app).
- Never touch the physical devices' claims (Printer b580 / 626a in org "Starbucks") destructively; QA may move them between stores and back.

---

### Task 1: Pure URL/list helpers — `lib/list-params.ts` (TDD)

**Files:**
- Create: `lib/list-params.ts`
- Test: `lib/list-params.test.ts`

**Interfaces:**
- Produces: `PAGE_SIZE = 50`; `type DeviceStatusFilter = "all" | "online" | "offline" | "paused" | "pool"`; `interface ListParams { q: string; status: DeviceStatusFilter; page: number }`; `parseListParams(sp: { q?: string | string[]; status?: string | string[]; page?: string | string[] }): ListParams`; `pageCount(total: number, pageSize?: number): number`; `escapeLike(q: string): string`.

- [ ] **Step 1: Write the failing tests**

`lib/list-params.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE,
  escapeLike,
  pageCount,
  parseListParams,
} from "./list-params";

describe("parseListParams", () => {
  it("defaults: empty q, status all, page 1", () => {
    expect(parseListParams({})).toEqual({ q: "", status: "all", page: 1 });
  });
  it("trims q and caps it at 100 chars", () => {
    expect(parseListParams({ q: "  b580  " }).q).toBe("b580");
    expect(parseListParams({ q: "x".repeat(150) }).q).toHaveLength(100);
  });
  it("accepts every valid status and rejects junk", () => {
    for (const s of ["all", "online", "offline", "paused", "pool"] as const) {
      expect(parseListParams({ status: s }).status).toBe(s);
    }
    expect(parseListParams({ status: "hacked" }).status).toBe("all");
  });
  it("clamps page to a positive integer", () => {
    expect(parseListParams({ page: "3" }).page).toBe(3);
    for (const bad of ["0", "-2", "abc", "1.5", ""]) {
      expect(parseListParams({ page: bad }).page).toBe(1);
    }
  });
  it("takes the first value when Next hands an array", () => {
    expect(parseListParams({ q: ["a", "b"], page: ["2"] })).toEqual({
      q: "a",
      status: "all",
      page: 2,
    });
  });
});

describe("pageCount", () => {
  it("is ceil(total/size) with a floor of 1", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(1)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageCount(101, 50)).toBe(3);
  });
});

describe("escapeLike", () => {
  it("escapes backslash, percent and underscore", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });
  it("leaves plain text alone", () => {
    expect(escapeLike("kadikoy 12")).toBe("kadikoy 12");
  });
});

describe("PAGE_SIZE", () => {
  it("is 50 per the spec", () => {
    expect(PAGE_SIZE).toBe(50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/list-params.test.ts`
Expected: FAIL — cannot resolve `./list-params`.

- [ ] **Step 3: Implement `lib/list-params.ts`**

```ts
// Pure URL-state helpers for the paginated tenant list pages
// (docs/superpowers/specs/2026-07-12-fleet-scale-tenant-lists-design.md).
// Search / status filter / page number live in the URL; this module is the
// single owner of how those params are parsed and bounded.

export const PAGE_SIZE = 50;

export type DeviceStatusFilter = "all" | "online" | "offline" | "paused" | "pool";

const STATUSES: readonly DeviceStatusFilter[] = ["all", "online", "offline", "paused", "pool"];

export interface ListParams {
  q: string;
  status: DeviceStatusFilter;
  page: number;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseListParams(sp: {
  q?: string | string[];
  status?: string | string[];
  page?: string | string[];
}): ListParams {
  const q = (first(sp.q) ?? "").trim().slice(0, 100);
  const rawStatus = first(sp.status) ?? "all";
  const status = (STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as DeviceStatusFilter)
    : "all";
  const rawPage = Number(first(sp.page));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  return { q, status, page };
}

export function pageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Escape LIKE/ILIKE wildcards so user input matches literally
 *  (backslash is Postgres's default escape character). */
export function escapeLike(q: string): string {
  return q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/list-params.test.ts`
Expected: PASS (10 tests). Then `npx tsc --noEmit && npm test` — all green.

- [ ] **Step 5: Commit**

```bash
git add lib/list-params.ts lib/list-params.test.ts
git commit -m "feat(lists): pure URL/list param helpers for paginated tenant pages"
```

---

### Task 2: Paginated data functions — `lib/data.ts`

**Files:**
- Modify: `lib/data.ts` (add three functions + two interfaces near the existing tenant-store functions, ~line 437; add imports of `PAGE_SIZE`/`escapeLike` from `@/lib/list-params`)

**Interfaces:**
- Consumes: `PAGE_SIZE`, `escapeLike`, `DeviceStatusFilter` (Task 1); existing `StoreSummary` type (`lib/types.ts`), `db`, `sql` (drizzle), `DeviceStatus` type.
- Produces:
  - `interface StoreListPage { rows: StoreSummary[]; total: number; fleet: { stores: number; devices: number; online: number } }`
  - `getTenantStoresPage(organizationId: string, opts: { q: string; page: number }): Promise<StoreListPage>`
  - `interface DeviceListRow { id: string; name: string; serial: string | null; storeId: string | null; storeName: string | null; status: DeviceStatus; lastSeen: string }`
  - `interface DeviceListPage { rows: DeviceListRow[]; total: number; counts: { all: number; online: number; offline: number; paused: number; pool: number } }`
  - `getTenantDevicesPage(organizationId: string, opts: { q: string; status: DeviceStatusFilter; page: number }): Promise<DeviceListPage>`
  - `getTenantStoreOptions(organizationId: string): Promise<{ id: string; name: string }[]>`

Notes for the implementer: `lib/data.ts` mostly uses the query builder, but windowed/`FILTER` aggregates are cleaner raw — use `db.execute(sql\`...\`)` with drizzle's tagged template (interpolations are parameterized automatically) and map rows. `rollUpStoreStatus` semantics are mirrored in SQL: any online device → `online`; else any paused → `paused`; else `offline`.

- [ ] **Step 1: Implement the three functions**

Add to `lib/data.ts`:

```ts
// ---------------------------------------------------------------------------
// Paginated fleet-scale lists (tenant Stores + Devices pages).
// One 50-row page per call; totals via count(*) over (); search is escaped
// ILIKE. Status is the STORED device.status column — the same thing every
// other tenant page shows (the daily reconcile keeps it honest).

export interface StoreListPage {
  rows: StoreSummary[];
  total: number;
  fleet: { stores: number; devices: number; online: number };
}

export async function getTenantStoresPage(
  organizationId: string,
  opts: { q: string; page: number },
): Promise<StoreListPage> {
  const like = `%${escapeLike(opts.q)}%`;
  const offset = (opts.page - 1) * PAGE_SIZE;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [pageRes, fleetRes] = await Promise.all([
    db.execute(sql`
      select s.id, s.name, s.address, s.timezone,
             coalesce(dv.device_count, 0)::int  as device_count,
             coalesce(dv.online_count, 0)::int  as online_count,
             coalesce(dv.paused_count, 0)::int  as paused_count,
             coalesce(act.n, 0)::int            as activations,
             count(*) over ()::int              as total
      from store s
      left join (
        select store_id,
               count(*)::int                                as device_count,
               count(*) filter (where status = 'online')::int as online_count,
               count(*) filter (where status = 'paused')::int as paused_count
        from device
        where organization_id = ${organizationId}
          and claimed_at is not null and store_id is not null
        group by store_id
      ) dv on dv.store_id = s.id
      left join (
        select d.store_id, count(*)::int as n
        from device_command c
        join device d on d.id = c.device_id
        where d.organization_id = ${organizationId}
          and c.type = 'trigger' and c.status = 'acked'
          and c.created_at >= ${monthStart}
        group by d.store_id
      ) act on act.store_id = s.id
      where s.organization_id = ${organizationId}
        and (${opts.q} = '' or s.name ilike ${like} or s.address ilike ${like})
      order by s.name asc
      limit ${PAGE_SIZE} offset ${offset}
    `),
    db.execute(sql`
      select (select count(*)::int from store where organization_id = ${organizationId}) as stores,
             count(*)::int                                       as devices,
             count(*) filter (where status = 'online')::int      as online
      from device
      where organization_id = ${organizationId} and claimed_at is not null
    `),
  ]);

  type Row = {
    id: string; name: string; address: string; timezone: string;
    device_count: number; online_count: number; paused_count: number;
    activations: number; total: number;
  };
  const rows = (pageRes.rows as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    timezone: r.timezone,
    deviceCount: r.device_count,
    onlineCount: r.online_count,
    activationsThisMonth: r.activations,
    status: (r.online_count > 0 ? "online" : r.paused_count > 0 ? "paused" : "offline") as StoreSummary["status"],
  }));
  const fleet = fleetRes.rows[0] as { stores: number; devices: number; online: number };
  return {
    rows,
    total: (pageRes.rows[0] as Row | undefined)?.total ?? 0,
    fleet: { stores: Number(fleet.stores), devices: Number(fleet.devices), online: Number(fleet.online) },
  };
}

export interface DeviceListRow {
  id: string;
  name: string;
  serial: string | null;
  storeId: string | null;
  storeName: string | null;
  status: DeviceStatus;
  lastSeen: string;
}

export interface DeviceListPage {
  rows: DeviceListRow[];
  total: number;
  counts: { all: number; online: number; offline: number; paused: number; pool: number };
}

export async function getTenantDevicesPage(
  organizationId: string,
  opts: { q: string; status: DeviceStatusFilter; page: number },
): Promise<DeviceListPage> {
  const like = `%${escapeLike(opts.q)}%`;
  const offset = (opts.page - 1) * PAGE_SIZE;
  const statusCond =
    opts.status === "all"
      ? sql`true`
      : opts.status === "pool"
        ? sql`d.store_id is null`
        : sql`d.status = ${opts.status}`;

  const [pageRes, countRes] = await Promise.all([
    db.execute(sql`
      select d.id, d.name, d.serial, d.store_id, s.name as store_name, d.status,
             coalesce(d.last_seen_at, d.created_at) as last_seen,
             count(*) over ()::int as total
      from device d
      left join store s on s.id = d.store_id
      where d.organization_id = ${organizationId}
        and d.claimed_at is not null
        and (${opts.q} = '' or d.name ilike ${like} or d.serial ilike ${like} or s.name ilike ${like})
        and ${statusCond}
      order by d.name asc, d.id asc
      limit ${PAGE_SIZE} offset ${offset}
    `),
    db.execute(sql`
      select count(*)::int                                        as all_count,
             count(*) filter (where d.status = 'online')::int     as online,
             count(*) filter (where d.status = 'offline')::int    as offline,
             count(*) filter (where d.status = 'paused')::int     as paused,
             count(*) filter (where d.store_id is null)::int      as pool
      from device d
      left join store s on s.id = d.store_id
      where d.organization_id = ${organizationId}
        and d.claimed_at is not null
        and (${opts.q} = '' or d.name ilike ${like} or d.serial ilike ${like} or s.name ilike ${like})
    `),
  ]);

  type Row = {
    id: string; name: string; serial: string | null; store_id: string | null;
    store_name: string | null; status: string; last_seen: string | Date; total: number;
  };
  const rows = (pageRes.rows as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    serial: r.serial,
    storeId: r.store_id,
    storeName: r.store_name,
    status: r.status as DeviceStatus,
    lastSeen: new Date(r.last_seen).toISOString(),
  }));
  const c = countRes.rows[0] as {
    all_count: number; online: number; offline: number; paused: number; pool: number;
  };
  return {
    rows,
    total: (pageRes.rows[0] as Row | undefined)?.total ?? 0,
    counts: {
      all: Number(c.all_count),
      online: Number(c.online),
      offline: Number(c.offline),
      paused: Number(c.paused),
      pool: Number(c.pool),
    },
  };
}

/** Lightweight store options (id + name) for the assign/move picker. */
export async function getTenantStoreOptions(
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: storeTable.id, name: storeTable.name })
    .from(storeTable)
    .where(eq(storeTable.organizationId, organizationId))
    .orderBy(asc(storeTable.name));
}
```

Import `DeviceStatusFilter`, `PAGE_SIZE`, `escapeLike` from `@/lib/list-params` at the top of `lib/data.ts` (check `asc` is already imported from drizzle-orm; add if missing). If `db.execute` result typing differs (neon-http returns `{ rows }`), match the file's existing raw-sql usage — if there is none, `const res = await db.execute(...)` then `res.rows` as shown.

- [ ] **Step 2: Typecheck, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: PASS (no page consumes these yet).

- [ ] **Step 3: Commit**

```bash
git add lib/data.ts
git commit -m "feat(lists): paginated tenant store/device page queries with SQL aggregates"
```

---

### Task 3: Shared list UI — `ListControls` + `PaginationBar`

**Files:**
- Create: `components/list-controls.tsx`
- Create: `components/pagination-bar.tsx`

**Interfaces:**
- Consumes: `DeviceStatusFilter` (Task 1); shadcn `Input`; `next/navigation` hooks.
- Produces:
  - `ListControls({ initialQ, placeholder, tabs }: { initialQ: string; placeholder: string; tabs?: { value: string; label: string; count: number; active: boolean }[] })` — client component; search writes `q` (debounced 300 ms, Enter = immediate), tab click writes `status`; both delete `page`.
  - `PaginationBar({ page, total, pageSize, pathname, params }: { page: number; total: number; pageSize?: number; pathname: string; params: Record<string, string> })` — server-renderable; hidden when 1 page.

- [ ] **Step 1: Implement `components/list-controls.tsx`**

```tsx
"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Debounced search box + optional status pill tabs. All state lives in the
 *  URL (?q=&status=&page=); changing either resets the page. */
export function ListControls({
  initialQ,
  placeholder,
  tabs,
}: {
  initialQ: string;
  placeholder: string;
  tabs?: { value: string; label: string; count: number; active: boolean }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = React.useState(initialQ);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      next.delete("page"); // any filter change restarts at page 1
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
    },
    [router, pathname, searchParams],
  );

  function onChange(v: string) {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ q: v.trim() }), 300);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          placeholder={placeholder}
          className="pl-9"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (timer.current) clearTimeout(timer.current);
              apply({ q: value.trim() });
            }
          }}
        />
      </div>
      {tabs && (
        <div className="flex flex-wrap items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => apply({ status: t.value === "all" ? null : t.value })}
              className={cn(
                "rounded-full px-3 py-1 text-sm tabular-nums transition-colors",
                t.active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t.label} · {t.count}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `components/pagination-bar.tsx`**

```tsx
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE, pageCount } from "@/lib/list-params";
import { cn } from "@/lib/utils";

/** Link-based pager (works without JS). Hidden when everything fits one page. */
export function PaginationBar({
  page,
  total,
  pageSize = PAGE_SIZE,
  pathname,
  params,
}: {
  page: number;
  total: number;
  pageSize?: number;
  pathname: string;
  params: Record<string, string>;
}) {
  const pages = pageCount(total, pageSize);
  if (pages <= 1) return null;

  const href = (p: number) => {
    const next = new URLSearchParams(params);
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const linkCls = (disabled: boolean) =>
    cn(
      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm",
      disabled ? "pointer-events-none text-muted-foreground/40" : "hover:bg-muted",
    );

  return (
    <nav className="flex items-center justify-between text-sm text-muted-foreground" aria-label="Pagination">
      <Link href={href(page - 1)} className={linkCls(page <= 1)} aria-disabled={page <= 1}>
        <ChevronLeft className="size-4" /> Previous
      </Link>
      <span className="tabular-nums">
        Page {page} of {pages} · {total.toLocaleString()} total
      </span>
      <Link href={href(page + 1)} className={linkCls(page >= pages)} aria-disabled={page >= pages}>
        Next <ChevronRight className="size-4" />
      </Link>
    </nav>
  );
}
```

- [ ] **Step 3: Typecheck, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: PASS (components not yet consumed; build confirms they compile in isolation).

- [ ] **Step 4: Commit**

```bash
git add components/list-controls.tsx components/pagination-bar.tsx
git commit -m "feat(lists): shared debounced search/tab controls and link-based pagination bar"
```

---

### Task 4: Stores page — search + pagination

**Files:**
- Modify: `app/(tenant)/tenant/stores/page.tsx` (full rework of data fetching + table wrapper; row markup unchanged)

**Interfaces:**
- Consumes: `parseListParams` (Task 1), `getTenantStoresPage` (Task 2), `ListControls`/`PaginationBar` (Task 3). Existing: `AddStoreDialog`, `StoreRowActions`, `UnassignedDevices`, `getTenantUnassignedDevices`, `requireTenant`, table components.
- Produces: `/tenant/stores?q=&page=` behavior later tasks assume.

- [ ] **Step 1: Rework the page**

Keep the existing row markup (Store link, address, printers x/y with `StatusDot`, activations, `StatusBadge`, `StoreRowActions`) — only the data source and the chrome around the table change. New structure (adapt the row JSX from the current file verbatim):

```tsx
export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { ctx, organizationId } = await requireTenant();
  const { q, page } = parseListParams(await searchParams);
  const [{ rows: stores, total, fleet }, unassigned] = await Promise.all([
    getTenantStoresPage(organizationId, { q, page }),
    getTenantUnassignedDevices(organizationId),
  ]);
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canManage = !!membership && ["owner", "admin"].includes(membership.role);
  const params: Record<string, string> = {};
  if (q) params.q = q;

  return (
    <>
      <PageHeader
        title="Stores"
        description={`${formatNumber(fleet.stores)} branches · ${formatNumber(fleet.online)}/${formatNumber(fleet.devices)} printers online`}
      >
        {canManage && <AddStoreDialog />}
      </PageHeader>

      <ListControls initialQ={q} placeholder="Search stores by name or address…" />

      <Card className="overflow-hidden py-0">
        <Table>
          {/* header row unchanged */}
          <TableBody>
            {stores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No stores match{q ? ` “${q}”` : ""}.
                </TableCell>
              </TableRow>
            ) : (
              stores.map((s) => (
                /* existing row JSX, unchanged */
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <PaginationBar page={page} total={total} pathname="/tenant/stores" params={params} />

      <UnassignedDevices ... /* unchanged in this task; Task 5 removes it */ />
    </>
  );
}
```

The `UnassignedDevices` invocation and its current props stay exactly as they are in the file today (it is removed in Task 5, not here). Delete the old `getTenantStores` call and the JS `reduce` totals — header numbers come from `fleet`.

- [ ] **Step 2: Typecheck, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(tenant)/tenant/stores/page.tsx"
git commit -m "feat(stores): server-paginated searchable tenant store directory"
```

---

### Task 5: Devices page + nav + StorePickerDialog; retire the Stores pool section

**Files:**
- Modify: `lib/nav.ts` (TENANT_NAV — add Devices under Stores)
- Create: `components/store-picker-dialog.tsx`
- Create: `components/device-list-actions.tsx`
- Create: `app/(tenant)/tenant/devices/page.tsx`
- Modify: `app/(tenant)/tenant/stores/page.tsx` (remove `UnassignedDevices` section + its data fetch)
- Delete: `components/unassigned-devices.tsx`
- Modify: `lib/actions/devices.ts` (add `getTenantStoreOptionsAction`)

**Interfaces:**
- Consumes: `parseListParams`, `DeviceStatusFilter` (Task 1); `getTenantDevicesPage`, `getTenantStoreOptions` (Task 2); `ListControls`, `PaginationBar` (Task 3); existing `assignDeviceToStore` (`lib/actions/devices.ts:340`, `(deviceId, storeId) → ActionResult`), `StatusBadge`, `timeAgo` (`lib/format`).
- Produces: `/tenant/devices` route; `StorePickerDialog({ open, onOpenChange, title, excludeStoreId, onPick, pending })`; `getTenantStoreOptionsAction(): Promise<{ id: string; name: string }[]>` (tenant-gated).

- [ ] **Step 1: Nav entry**

In `lib/nav.ts` TENANT_NAV, insert directly after the Stores item:

```ts
  { label: "Devices", href: "/tenant/devices", icon: Cpu },
```

(`Cpu` is already imported for ADMIN_NAV.)

- [ ] **Step 2: Server action for picker options**

In `lib/actions/devices.ts` (bottom of file):

```ts
/** Store options for the tenant device assign/move picker (any member may read). */
export async function getTenantStoreOptionsAction(): Promise<{ id: string; name: string }[]> {
  const { organizationId } = await requireTenant();
  return getTenantStoreOptions(organizationId);
}
```

with `import { getTenantStoreOptions } from "@/lib/data";` added to the file's imports (check the file's existing import from `@/lib/data` and extend it if present).

- [ ] **Step 3: `components/store-picker-dialog.tsx`**

A searchable store list — deliberately NOT a `<Select>`: at 2,000 stores the picker needs its own typeahead. Uses the shadcn `Command` family (`components/ui/command.tsx`; verify it exists — if the repo lacks it, use a plain `Input` filter over a scrollable list with the same props, same behavior).

```tsx
"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getTenantStoreOptionsAction } from "@/lib/actions/devices";

/** Searchable store picker; options load lazily on first open. */
export function StorePickerDialog({
  open,
  onOpenChange,
  title,
  excludeStoreId,
  onPick,
  pending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  excludeStoreId?: string | null;
  onPick: (storeId: string) => void;
  pending: boolean;
}) {
  const [options, setOptions] = React.useState<{ id: string; name: string }[] | null>(null);

  React.useEffect(() => {
    if (open && options === null) {
      getTenantStoreOptionsAction().then(setOptions).catch(() => setOptions([]));
    }
  }, [open, options]);

  const visible = (options ?? []).filter((o) => o.id !== excludeStoreId);

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Command>
          <CommandInput placeholder="Search stores…" autoFocus />
          <CommandList className="max-h-64">
            <CommandEmpty>
              {options === null ? "Loading stores…" : "No stores found."}
            </CommandEmpty>
            {visible.map((o) => (
              <CommandItem key={o.id} value={o.name} disabled={pending} onSelect={() => onPick(o.id)}>
                {o.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: `components/device-list-actions.tsx`**

Row-level action: "Assign to store" (pool rows) or "Move to store" (assigned rows) — one component, mode by `storeId`.

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StorePickerDialog } from "@/components/store-picker-dialog";
import { assignDeviceToStore } from "@/lib/actions/devices";

export function DeviceListActions({
  deviceId,
  deviceName,
  storeId,
}: {
  deviceId: string;
  deviceName: string;
  storeId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const isPool = storeId === null;

  async function pick(targetStoreId: string) {
    setPending(true);
    const res = await assignDeviceToStore(deviceId, targetStoreId);
    setPending(false);
    if (!res.ok) {
      toast.error(isPool ? "Couldn't assign device" : "Couldn't move device", { description: res.error });
      return;
    }
    setOpen(false);
    toast.success(isPool ? "Device assigned" : "Device moved");
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {isPool ? "Assign to store" : "Move to store"}
      </Button>
      <StorePickerDialog
        open={open}
        onOpenChange={setOpen}
        title={`${isPool ? "Assign" : "Move"} ${deviceName}`}
        excludeStoreId={storeId}
        onPick={pick}
        pending={pending}
      />
    </>
  );
}
```

- [ ] **Step 5: `app/(tenant)/tenant/devices/page.tsx`**

```tsx
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { ListControls } from "@/components/list-controls";
import { PaginationBar } from "@/components/pagination-bar";
import { DeviceListActions } from "@/components/device-list-actions";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getTenantDevicesPage } from "@/lib/data";
import { parseListParams } from "@/lib/list-params";
import { requireTenant } from "@/lib/session";
import { formatNumber, timeAgo } from "@/lib/format";

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { ctx, organizationId } = await requireTenant();
  const { q, status, page } = parseListParams(await searchParams);
  const { rows, total, counts } = await getTenantDevicesPage(organizationId, { q, status, page });
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canManage = !!membership && ["owner", "admin"].includes(membership.role);

  const tabs = [
    { value: "all", label: "All", count: counts.all, active: status === "all" },
    { value: "online", label: "Online", count: counts.online, active: status === "online" },
    { value: "offline", label: "Offline", count: counts.offline, active: status === "offline" },
    { value: "paused", label: "Paused", count: counts.paused, active: status === "paused" },
    { value: "pool", label: "Unassigned", count: counts.pool, active: status === "pool" },
  ];
  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (status !== "all") params.status = status;

  return (
    <>
      <PageHeader
        title="Devices"
        description={`${formatNumber(counts.all)} printers · ${formatNumber(counts.online)} online`}
      />

      <ListControls initialQ={q} placeholder="Search by device, serial or store…" tabs={tabs} />

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Device</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last seen</TableHead>
              {canManage && <TableHead className="w-36" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 5 : 4} className="py-10 text-center text-sm text-muted-foreground">
                  {status === "pool" ? "No unassigned devices." : `No devices match${q ? ` “${q}”` : ""}.`}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    {d.storeId ? (
                      <Link href={`/tenant/stores/${d.storeId}/${d.id}`} className="flex flex-col">
                        <span className="font-medium">{d.name}</span>
                        {d.serial && <span className="font-mono text-xs text-muted-foreground">{d.serial}</span>}
                      </Link>
                    ) : (
                      <span className="flex flex-col">
                        <span className="font-medium">{d.name}</span>
                        {d.serial && <span className="font-mono text-xs text-muted-foreground">{d.serial}</span>}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.storeName ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{timeAgo(d.lastSeen)}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <DeviceListActions deviceId={d.id} deviceName={d.name} storeId={d.storeId} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <PaginationBar page={page} total={total} pathname="/tenant/devices" params={params} />
    </>
  );
}
```

Verify `StatusBadge`'s prop name (`status`) and `timeAgo`'s signature against their sources and adapt if they differ.

- [ ] **Step 6: Retire the Stores pool section**

In `app/(tenant)/tenant/stores/page.tsx`: remove the `UnassignedDevices` import + JSX + the `getTenantUnassignedDevices` fetch (header `fleet` numbers already include pool devices via Task 2's SQL). Delete `components/unassigned-devices.tsx` (grep first: `grep -rn "UnassignedDevices\|unassigned-devices" app components lib` must show no remaining consumers; `getTenantUnassignedDevices` in `lib/data.ts` stays if other callers exist — check with grep, and if the stores page was its only caller, delete it too).

- [ ] **Step 7: Typecheck, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: PASS; build lists the new `/tenant/devices` route.

- [ ] **Step 8: Commit**

```bash
git add lib/nav.ts lib/actions/devices.ts lib/data.ts components/store-picker-dialog.tsx components/device-list-actions.tsx "app/(tenant)/tenant/devices/page.tsx" "app/(tenant)/tenant/stores/page.tsx"
git rm components/unassigned-devices.tsx
git commit -m "feat(devices): org-wide tenant fleet page with status tabs, search and assign/move"
```

---

### Task 6: Live QA + deploy

**Files:** none (verification only; deploy at the end).

**Interfaces:**
- Consumes: everything above, deployed to https://ditto-admin-brown.vercel.app.

- [ ] **Step 1: Deploy**

```bash
git push origin main && vercel deploy --prod
```
Expected: deployment Ready.

- [ ] **Step 2: QA checklist (production, org "Starbucks", user erenmeren88@gmail.com or admin@maratus.app via workspace switcher)**

Using Playwright MCP (remember: use `browser_evaluate` with native `.click()` — `browser_click` doesn't fire React handlers on this app):

1. Sidebar shows **Devices** under Stores; both pages load.
2. Stores: search matches name and address; bogus search shows the empty state; header totals unchanged by search.
3. Devices: All/Online/Offline/Paused/Unassigned tab counts sum sensibly (all = online+offline+paused; pool counted inside its physical status too); tab click filters rows and updates URL.
4. Search by full serial (`e8f60ae0b580`), by partial device name, and by store name — each finds the device.
5. Assign: put a device in the pool first if none (move it out via store detail or use an existing pool device), then Assign from the Unassigned tab via the picker (type-to-filter works) → toast, row gains store, pool count drops.
6. Move: move a device between two stores from the All tab → toast, store cell updates; move it back. Audit page shows "Device reassigned" entries.
7. Pagination: do NOT mass-create stores in prod. The pagination math is unit-tested (Task 1); live, verify the honest-empty behavior instead: open `/tenant/stores?page=2` directly → the table shows the empty state, the pagination bar stays hidden (single page), and nothing crashes. Same check on `/tenant/devices?page=99`.
8. Assigned-device row links to the existing device detail page; pool row has no link.
9. Non-manager view (if a member-role user exists; otherwise verify by code inspection that `canManage` gates the actions column).

- [ ] **Step 3: Record results**

Append the QA outcomes to the progress ledger; note any follow-ups found.
