# Receipt Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A filterable, paginated receipt list + side-effect-free detail view for tenants (own org) and platform admins (all orgs).

**Architecture:** Pure URL-param parsing (`lib/receipts-search.ts`, TDD) feeds a shared `searchReceipts` query; filter UI is a URL-driven client bar; the detail view presigns the R2 object directly (no status flip, unlike the public `/r/[token]` page).

**Tech Stack:** Next.js 16 App Router, Drizzle/Neon, Cloudflare R2 presign, vitest.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `lib/receipts-search.ts` | pure `parseReceiptFilters`, `receiptPageCount`, types | Create |
| `lib/receipts-search.test.ts` | tests | Create |
| `lib/db/schema.ts` | + `receipt_store_id_idx` | Modify |
| `lib/data.ts` | `searchReceipts`, `getReceiptDetail`, `getReceiptFilterOptions` | Modify |
| `components/receipts/receipt-filters.tsx` | URL-driven filter bar (client) | Create |
| `components/receipts/receipts-table.tsx` | results table + pager (server) | Create |
| `components/receipts/receipt-detail.tsx` | image + metadata (server) | Create |
| `app/(tenant)/tenant/receipts/page.tsx` | tenant list | Create |
| `app/(tenant)/tenant/receipts/[receiptId]/page.tsx` | tenant detail | Create |
| `app/(admin)/admin/receipts/page.tsx` | admin list | Create |
| `app/(admin)/admin/receipts/[receiptId]/page.tsx` | admin detail | Create |
| `lib/nav.ts` | + Receipts in both navs | Modify |

---

## Task 1: Pure filter helpers (TDD)

**Files:** Create `lib/receipts-search.ts`, `lib/receipts-search.test.ts`.

- [ ] **Step 1: Write the failing test** `lib/receipts-search.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseReceiptFilters, receiptPageCount, PAGE_SIZE } from "./receipts-search";

describe("parseReceiptFilters", () => {
  it("defaults to page 1 and no filters on empty input", () => {
    expect(parseReceiptFilters({})).toEqual({ page: 1 });
  });
  it("keeps a valid status, drops an invalid one", () => {
    expect(parseReceiptFilters({ status: "ready" }).status).toBe("ready");
    expect(parseReceiptFilters({ status: "bogus" }).status).toBeUndefined();
  });
  it("clamps page to >= 1", () => {
    expect(parseReceiptFilters({ page: "0" }).page).toBe(1);
    expect(parseReceiptFilters({ page: "-4" }).page).toBe(1);
    expect(parseReceiptFilters({ page: "x" }).page).toBe(1);
    expect(parseReceiptFilters({ page: "3" }).page).toBe(3);
  });
  it("parses valid dates and drops garbage", () => {
    expect(parseReceiptFilters({ from: "2026-01-01" }).from).toBeInstanceOf(Date);
    expect(parseReceiptFilters({ from: "not-a-date" }).from).toBeUndefined();
  });
  it("trims token/ids and drops empties", () => {
    expect(parseReceiptFilters({ token: "  abc  " }).token).toBe("abc");
    expect(parseReceiptFilters({ token: "   " }).token).toBeUndefined();
    expect(parseReceiptFilters({ store: "s1", device: "d1", org: "o1" })).toMatchObject({
      storeId: "s1",
      deviceId: "d1",
      organizationId: "o1",
    });
  });
});

describe("receiptPageCount", () => {
  it("computes pages and never returns < 1", () => {
    expect(receiptPageCount(0)).toBe(1);
    expect(receiptPageCount(PAGE_SIZE)).toBe(1);
    expect(receiptPageCount(PAGE_SIZE + 1)).toBe(2);
    expect(receiptPageCount(PAGE_SIZE * 3)).toBe(3);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- lib/receipts-search.test.ts`

- [ ] **Step 3: Implement `lib/receipts-search.ts`:**

```ts
// lib/receipts-search.ts
// Pure parsing/normalization of receipt-search URL params (no IO).

export type ReceiptStatus = "pending" | "ready" | "downloaded";
export const PAGE_SIZE = 25;

const STATUSES: ReceiptStatus[] = ["pending", "ready", "downloaded"];

export interface ReceiptFilters {
  organizationId?: string;
  storeId?: string;
  deviceId?: string;
  status?: ReceiptStatus;
  from?: Date;
  to?: Date;
  token?: string;
  page: number;
}

function str(v: string | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : undefined;
}

function date(v: string | undefined): Date | undefined {
  const t = str(v);
  if (!t) return undefined;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Normalize raw URL search params into typed, validated filters. */
export function parseReceiptFilters(raw: Record<string, string | undefined>): ReceiptFilters {
  const statusRaw = str(raw.status);
  const status = STATUSES.includes(statusRaw as ReceiptStatus)
    ? (statusRaw as ReceiptStatus)
    : undefined;
  const pageNum = Number.parseInt(raw.page ?? "", 10);
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

  return {
    organizationId: str(raw.org),
    storeId: str(raw.store),
    deviceId: str(raw.device),
    status,
    from: date(raw.from),
    to: date(raw.to),
    token: str(raw.token),
    page,
  };
}

/** Total pages for a result count (never < 1). */
export function receiptPageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
```

- [ ] **Step 4: Run, expect PASS**; then `npm test` (full suite green).

Run: `npm test -- lib/receipts-search.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/receipts-search.ts lib/receipts-search.test.ts
git commit -m "feat: add pure receipt-search filter helpers"
```

---

## Task 2: `receipt_store_id_idx` migration

**Files:** Modify `lib/db/schema.ts`.

- [ ] **Step 1: Add the index** — in the `receipt` table's index array (currently `uniqueIndex("receipt_token_idx")`, `index("receipt_organization_id_idx")`, `index("receipt_device_id_idx")`, `index("receipt_created_at_idx")`), add:

```ts
    index("receipt_store_id_idx").on(t.storeId),
```

- [ ] **Step 2: Generate + apply**

Run: `npm run db:generate`
Expected: a migration with only `CREATE INDEX "receipt_store_id_idx"`. Inspect — additive only.

Run: `npm run db:migrate`
Expected: applies cleanly.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit`

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat: index receipt.storeId for store-filtered search"
```

---

## Task 3: Data layer — search, detail, filter options

**Files:** Modify `lib/data.ts`.

Context: `lib/data.ts` imports `{ and, desc, eq }` from `drizzle-orm`, `db` from `./db`, aliased tables (`receiptTable`, `storeTable`, `deviceTable`, `orgTable`), and `presignedGetUrl` from `./storage`. Add `gte`, `lte`, `count` to the drizzle import. Import the filter type.

- [ ] **Step 1: Add imports** — change the drizzle import line to:

```ts
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
```

and add near the other local imports:

```ts
import { type ReceiptFilters, PAGE_SIZE } from "./receipts-search";
```

- [ ] **Step 2: Append the three functions** to `lib/data.ts`:

```ts
export interface ReceiptListRow {
  id: string;
  token: string;
  status: "pending" | "ready" | "downloaded";
  storeName: string | null;
  deviceName: string | null;
  createdAt: string;
  byteSize: number;
}

/** Build the WHERE conditions shared by the list + count queries. */
function receiptConditions(f: ReceiptFilters) {
  const c = [];
  if (f.organizationId) c.push(eq(receiptTable.organizationId, f.organizationId));
  if (f.storeId) c.push(eq(receiptTable.storeId, f.storeId));
  if (f.deviceId) c.push(eq(receiptTable.deviceId, f.deviceId));
  if (f.status) c.push(eq(receiptTable.status, f.status));
  if (f.from) c.push(gte(receiptTable.createdAt, f.from));
  if (f.to) c.push(lte(receiptTable.createdAt, f.to));
  if (f.token) c.push(eq(receiptTable.token, f.token));
  return c;
}

/** Filterable, paginated receipt search (tenant: pass organizationId; admin: omit). */
export async function searchReceipts(
  f: ReceiptFilters,
): Promise<{ rows: ReceiptListRow[]; total: number }> {
  const conds = receiptConditions(f);
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: receiptTable.id,
      token: receiptTable.token,
      status: receiptTable.status,
      storeName: storeTable.name,
      deviceName: deviceTable.name,
      createdAt: receiptTable.createdAt,
      byteSize: receiptTable.byteSize,
    })
    .from(receiptTable)
    .leftJoin(storeTable, eq(receiptTable.storeId, storeTable.id))
    .leftJoin(deviceTable, eq(receiptTable.deviceId, deviceTable.id))
    .where(where)
    .orderBy(desc(receiptTable.createdAt))
    .limit(PAGE_SIZE)
    .offset((f.page - 1) * PAGE_SIZE);

  const [{ total }] = await db
    .select({ total: count() })
    .from(receiptTable)
    .where(where);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      token: r.token,
      status: r.status,
      storeName: r.storeName,
      deviceName: r.deviceName,
      createdAt: r.createdAt.toISOString(),
      byteSize: r.byteSize,
    })),
    total: Number(total),
  };
}

/** One receipt + a fresh presigned image URL. Read-only — never flips status. */
export async function getReceiptDetail(
  receiptId: string,
  opts: { organizationId?: string },
) {
  const conds = [eq(receiptTable.id, receiptId)];
  if (opts.organizationId) conds.push(eq(receiptTable.organizationId, opts.organizationId));
  const [r] = await db
    .select({
      id: receiptTable.id,
      token: receiptTable.token,
      status: receiptTable.status,
      storageKey: receiptTable.storageKey,
      byteSize: receiptTable.byteSize,
      createdAt: receiptTable.createdAt,
      downloadedAt: receiptTable.downloadedAt,
      storeName: storeTable.name,
      deviceName: deviceTable.name,
    })
    .from(receiptTable)
    .leftJoin(storeTable, eq(receiptTable.storeId, storeTable.id))
    .leftJoin(deviceTable, eq(receiptTable.deviceId, deviceTable.id))
    .where(and(...conds))
    .limit(1);
  if (!r) return null;

  let imageUrl: string | null = null;
  if (r.status !== "pending") {
    try {
      imageUrl = await presignedGetUrl(r.storageKey);
    } catch {
      imageUrl = null;
    }
  }
  return {
    id: r.id,
    token: r.token,
    status: r.status,
    storeName: r.storeName,
    deviceName: r.deviceName,
    byteSize: r.byteSize,
    createdAt: r.createdAt.toISOString(),
    downloadedAt: r.downloadedAt ? r.downloadedAt.toISOString() : null,
    imageUrl,
  };
}

/** Stores + devices for an org, for the tenant filter dropdowns. */
export async function getReceiptFilterOptions(organizationId: string) {
  const [stores, devices] = await Promise.all([
    db.select({ id: storeTable.id, name: storeTable.name }).from(storeTable).where(eq(storeTable.organizationId, organizationId)),
    db.select({ id: deviceTable.id, name: deviceTable.name }).from(deviceTable).where(eq(deviceTable.organizationId, organizationId)),
  ]);
  return { stores, devices };
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/data.ts
git commit -m "feat: receipt search + detail data layer"
```

---

## Task 4: Shared components

**Files:** Create `components/receipts/receipt-filters.tsx`, `components/receipts/receipts-table.tsx`, `components/receipts/receipt-detail.tsx`.

- [ ] **Step 1: Filter bar (client)** `components/receipts/receipt-filters.tsx`:

```tsx
"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

type Opt = { id: string; name: string };

export function ReceiptFilters({
  stores,
  devices,
  orgs,
}: {
  stores?: Opt[];
  devices?: Opt[];
  orgs?: Opt[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page"); // any filter change resets to page 1
    router.replace(`${pathname}?${next.toString()}`);
  }

  const sel = "h-8 rounded-lg border border-input bg-transparent px-2 text-sm";

  return (
    <div className="flex flex-wrap items-end gap-3">
      {orgs && (
        <select className={sel} defaultValue={params.get("org") ?? ""} onChange={(e) => set("org", e.target.value)}>
          <option value="">All organizations</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      {stores && (
        <select className={sel} defaultValue={params.get("store") ?? ""} onChange={(e) => set("store", e.target.value)}>
          <option value="">All stores</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {devices && (
        <select className={sel} defaultValue={params.get("device") ?? ""} onChange={(e) => set("device", e.target.value)}>
          <option value="">All devices</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      <select className={sel} defaultValue={params.get("status") ?? ""} onChange={(e) => set("status", e.target.value)}>
        <option value="">Any status</option>
        <option value="pending">Pending</option>
        <option value="ready">Ready</option>
        <option value="downloaded">Downloaded</option>
      </select>
      <Input type="date" defaultValue={params.get("from") ?? ""} onChange={(e) => set("from", e.target.value)} className="w-auto" />
      <Input type="date" defaultValue={params.get("to") ?? ""} onChange={(e) => set("to", e.target.value)} className="w-auto" />
      <Input placeholder="Token…" defaultValue={params.get("token") ?? ""} onChange={(e) => set("token", e.target.value)} className="w-40" />
    </div>
  );
}
```

- [ ] **Step 2: Results table + pager (server)** `components/receipts/receipts-table.tsx`:

```tsx
import Link from "next/link";
import type { ReceiptListRow } from "@/lib/data";

export function ReceiptsTable({
  rows,
  page,
  pageCount,
  basePath,
  query,
}: {
  rows: ReceiptListRow[];
  page: number;
  pageCount: number;
  basePath: string; // e.g. "/tenant/receipts"
  query: string; // current search params without `page`, e.g. "store=s1&status=ready"
}) {
  function pageHref(p: number) {
    const q = new URLSearchParams(query);
    q.set("page", String(p));
    return `${basePath}?${q.toString()}`;
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No receipts match these filters.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-2">Created</th>
            <th>Store</th>
            <th>Device</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-2">{r.createdAt.slice(0, 19).replace("T", " ")}</td>
              <td>{r.storeName ?? "—"}</td>
              <td>{r.deviceName ?? "—"}</td>
              <td>{r.status}</td>
              <td className="text-right">
                <Link className="underline" href={`${basePath}/${r.id}`}>View</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Page {page} of {pageCount}</span>
        <span className="flex gap-3">
          {page > 1 ? <Link className="underline" href={pageHref(page - 1)}>Previous</Link> : <span className="text-muted-foreground">Previous</span>}
          {page < pageCount ? <Link className="underline" href={pageHref(page + 1)}>Next</Link> : <span className="text-muted-foreground">Next</span>}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Detail (server)** `components/receipts/receipt-detail.tsx`:

```tsx
import { env } from "@/lib/env";

type Detail = {
  id: string;
  token: string;
  status: string;
  storeName: string | null;
  deviceName: string | null;
  byteSize: number;
  createdAt: string;
  downloadedAt: string | null;
  imageUrl: string | null;
};

export function ReceiptDetail({ receipt }: { receipt: Detail }) {
  const publicUrl = `${env.BETTER_AUTH_URL}/r/${receipt.token}`;
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:max-w-md">
        <dt className="text-muted-foreground">Store</dt><dd>{receipt.storeName ?? "—"}</dd>
        <dt className="text-muted-foreground">Device</dt><dd>{receipt.deviceName ?? "—"}</dd>
        <dt className="text-muted-foreground">Status</dt><dd>{receipt.status}</dd>
        <dt className="text-muted-foreground">Created</dt><dd>{receipt.createdAt.slice(0, 19).replace("T", " ")}</dd>
        <dt className="text-muted-foreground">Downloaded</dt><dd>{receipt.downloadedAt ? receipt.downloadedAt.slice(0, 19).replace("T", " ") : "—"}</dd>
        <dt className="text-muted-foreground">Public link</dt>
        <dd><a className="underline break-all" href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a></dd>
      </dl>
      {receipt.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={receipt.imageUrl} alt="Receipt" className="max-w-sm rounded-lg border" />
      ) : (
        <p className="text-sm text-muted-foreground">Image not available yet.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/receipts/
git commit -m "feat: receipt filter bar, results table, detail view components"
```

---

## Task 5: Tenant pages + nav

**Files:** Create `app/(tenant)/tenant/receipts/page.tsx`, `app/(tenant)/tenant/receipts/[receiptId]/page.tsx`; Modify `lib/nav.ts`.

- [ ] **Step 1: Tenant list** `app/(tenant)/tenant/receipts/page.tsx`:

```tsx
import { requireTenant } from "@/lib/session";
import { searchReceipts, getReceiptFilterOptions } from "@/lib/data";
import { parseReceiptFilters, receiptPageCount } from "@/lib/receipts-search";
import { ReceiptFilters } from "@/components/receipts/receipt-filters";
import { ReceiptsTable } from "@/components/receipts/receipts-table";

export default async function TenantReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { organizationId } = await requireTenant();
  const raw = await searchParams;
  const filters = parseReceiptFilters({ ...raw, org: organizationId });
  const [{ rows, total }, options] = await Promise.all([
    searchReceipts({ ...filters, organizationId }),
    getReceiptFilterOptions(organizationId),
  ]);
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(raw).filter(([k, v]) => k !== "page" && v)) as Record<string, string>,
  ).toString();

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Receipts</h1>
      <ReceiptFilters stores={options.stores} devices={options.devices} />
      <ReceiptsTable rows={rows} page={filters.page} pageCount={receiptPageCount(total)} basePath="/tenant/receipts" query={query} />
    </div>
  );
}
```

- [ ] **Step 2: Tenant detail** `app/(tenant)/tenant/receipts/[receiptId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireTenant } from "@/lib/session";
import { getReceiptDetail } from "@/lib/data";
import { ReceiptDetail } from "@/components/receipts/receipt-detail";

export default async function TenantReceiptDetailPage({
  params,
}: {
  params: Promise<{ receiptId: string }>;
}) {
  const { organizationId } = await requireTenant();
  const { receiptId } = await params;
  const receipt = await getReceiptDetail(receiptId, { organizationId });
  if (!receipt) notFound();

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/tenant/receipts">← Back to receipts</Link>
      <h1 className="text-2xl font-semibold tracking-tight">Receipt</h1>
      <ReceiptDetail receipt={receipt} />
    </div>
  );
}
```

- [ ] **Step 3: Nav** — in `lib/nav.ts`, add `ReceiptText` to the lucide import and add to `TENANT_NAV` (after Reports):

```ts
  { label: "Receipts", href: "/tenant/receipts", icon: ReceiptText },
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean; `/tenant/receipts` and `/tenant/receipts/[receiptId]` listed.

- [ ] **Step 5: Commit**

```bash
git add "app/(tenant)/tenant/receipts/" lib/nav.ts
git commit -m "feat: tenant receipts list + detail pages"
```

---

## Task 6: Admin pages + nav

**Files:** Create `app/(admin)/admin/receipts/page.tsx`, `app/(admin)/admin/receipts/[receiptId]/page.tsx`; Modify `lib/nav.ts`.

Context: `getTenants()` in `lib/data.ts` returns the org list (read it to confirm the field names — it returns objects with at least `id` and `name`; adapt the `.map` below to the actual property names).

- [ ] **Step 1: Admin list** `app/(admin)/admin/receipts/page.tsx`:

```tsx
import { requirePlatformAdmin } from "@/lib/session";
import { searchReceipts, getTenants } from "@/lib/data";
import { parseReceiptFilters, receiptPageCount } from "@/lib/receipts-search";
import { ReceiptFilters } from "@/components/receipts/receipt-filters";
import { ReceiptsTable } from "@/components/receipts/receipts-table";

export default async function AdminReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePlatformAdmin();
  const raw = await searchParams;
  const filters = parseReceiptFilters(raw);
  const [{ rows, total }, tenants] = await Promise.all([searchReceipts(filters), getTenants()]);
  const orgs = tenants.map((t) => ({ id: t.id, name: t.name }));
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(raw).filter(([k, v]) => k !== "page" && v)) as Record<string, string>,
  ).toString();

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Receipts</h1>
      <ReceiptFilters orgs={orgs} />
      <ReceiptsTable rows={rows} page={filters.page} pageCount={receiptPageCount(total)} basePath="/admin/receipts" query={query} />
    </div>
  );
}
```

> Read `getTenants()`'s return type first; if its name field is e.g. `name` use it directly. If `getTenants` returns a shape without `name`, use the correct property.

- [ ] **Step 2: Admin detail** `app/(admin)/admin/receipts/[receiptId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { getReceiptDetail } from "@/lib/data";
import { ReceiptDetail } from "@/components/receipts/receipt-detail";

export default async function AdminReceiptDetailPage({
  params,
}: {
  params: Promise<{ receiptId: string }>;
}) {
  await requirePlatformAdmin();
  const { receiptId } = await params;
  const receipt = await getReceiptDetail(receiptId, {});
  if (!receipt) notFound();

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/admin/receipts">← Back to receipts</Link>
      <h1 className="text-2xl font-semibold tracking-tight">Receipt</h1>
      <ReceiptDetail receipt={receipt} />
    </div>
  );
}
```

- [ ] **Step 3: Nav** — add to `ADMIN_NAV` (after Device Fleet):

```ts
  { label: "Receipts", href: "/admin/receipts", icon: ReceiptText },
```

(`ReceiptText` is already imported from Task 5.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean; `/admin/receipts` + `/admin/receipts/[receiptId]` listed.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/receipts/" lib/nav.ts
git commit -m "feat: admin cross-org receipts list + detail pages"
```

---

## Task 7: Manual verification (human-run)

- [ ] As `dana@roastwell.co`: open `/tenant/receipts` (30 seeded receipts). Filter by
      store, device, status, date; confirm the URL updates and results filter.
- [ ] Paginate (set page size context: 25/page → seeded 30 gives 2 pages). Prev/Next work.
- [ ] Click a `ready`/`downloaded` receipt → image renders; re-check its status in
      `npm run db:studio` → **unchanged** (viewing did not flip it).
- [ ] Token lookup: paste a known token → single matching row.
- [ ] As `admin@maratus.app`: open `/admin/receipts` → all orgs; filter by org; open a receipt.

---

## Self-Review

- **Spec coverage:** pure parsing (T1), store index (T2), `searchReceipts`/`getReceiptDetail`/`getReceiptFilterOptions` (T3), filter bar/table/detail (T4), tenant pages + nav (T5), admin pages + nav (T6), manual (T7). All spec sections mapped. No-status-flip is satisfied — `getReceiptDetail` only reads + presigns (T3).
- **Placeholder scan:** no logic placeholders. T6 carries a "confirm `getTenants` field names" adaptation note (the `.map` is fully written; only property names may need adjustment).
- **Type consistency:** `ReceiptFilters`/`PAGE_SIZE`/`receiptPageCount` (T1) used in T3/T5/T6; `ReceiptListRow` (T3) consumed by `ReceiptsTable` (T4) and pages; `getReceiptDetail` return shape (T3) matches `ReceiptDetail`'s `Detail` type (T4); `searchReceipts`/`getReceiptFilterOptions`/`getReceiptDetail` signatures match their call sites.

## Execution notes

- **Runs green now:** Task 1 (pure). T2 migration needs `DATABASE_URL`.
- **No external services** beyond the DB; detail-image presign needs R2 creds to actually render (already in `.env.local`), but the page degrades to "image not available" without them.
