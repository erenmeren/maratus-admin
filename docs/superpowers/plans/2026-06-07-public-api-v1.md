# Public REST API v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only, tenant-scoped public REST API (`/api/v1`) for receipts + usage, authenticated by org-scoped API keys, with a key-management UI and a served OpenAPI 3.1 document.

**Architecture:** Org-scoped API keys mirror the existing device-key pattern (random key → SHA-256 hash + visible prefix, stored hashed). A thin per-route flow does auth → rate-limit → suspension check → parse → query → serialize. Pure helpers (cursor/params/serialize/respond) are unit-tested; data access reuses the existing read-only layer with one new cursor query and a usage aggregate. A committed `openapi.json` is served verbatim.

**Tech Stack:** Next.js 16 route handlers (`runtime="nodejs"`), Drizzle/Neon, `lib/rate-limit`, `lib/storage` presigned URLs, `recordAudit`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-public-api-v1-design.md`

---

## File Structure

**Create:**
- `lib/api/cursor.ts` + `lib/api/cursor.test.ts` — opaque keyset cursor encode/decode
- `lib/api/params.ts` + `lib/api/params.test.ts` — query-param parsing/validation
- `lib/api/serialize.ts` + `lib/api/serialize.test.ts` — view-model → API JSON (snake_case, cents)
- `lib/api/respond.ts` — `apiError` / `apiJson` response helpers
- `lib/api-auth.ts` — `authenticateApiKey(req)`
- `app/api/v1/receipts/route.ts` — GET list (cursor)
- `app/api/v1/receipts/[id]/route.ts` — GET one
- `app/api/v1/usage/route.ts` — GET usage
- `app/api/v1/openapi.json/route.ts` — serve the OpenAPI doc
- `openapi.json` — OpenAPI 3.1 document (repo root) + `lib/api/openapi.test.ts` (structural guard)
- `lib/actions/api-keys.ts` — `createApiKey` / `revokeApiKey`
- `app/(tenant)/tenant/api/page.tsx` — key-management page
- `components/api-key-create-dialog.tsx`, `components/api-key-row-actions.tsx`

**Modify:**
- `lib/db/schema.ts` — `apiKey` table; migration `drizzle/0011_*.sql`
- `lib/ids.ts` — `generateApiKey`, `hashApiKey`
- `lib/data.ts` — `listReceiptsByCursor`, `getApiUsage`, `getApiKeys`; extend `getReceiptDetail` with `storeId`/`deviceId`
- `lib/audit.ts` — `apiKeyCreated`, `apiKeyRevoked`
- `lib/nav.ts` — `/tenant/api` nav entry

---

## Task 1: API key id/hash helpers

**Files:**
- Modify: `lib/ids.ts`
- Test: `lib/ids.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `lib/ids.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey } from "./ids";

describe("generateApiKey", () => {
  it("returns a dk_live_ key, its sha256 hash, and a visible prefix", () => {
    const { key, hash, prefix } = generateApiKey();
    expect(key).toMatch(/^dk_live_[A-Za-z0-9_-]{40}$/);
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(key.startsWith(prefix)).toBe(true);
    expect(prefix).toBe(`dk_live_${key.slice("dk_live_".length, "dk_live_".length + 6)}`);
  });
  it("is unique across calls", () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key);
  });
});

describe("hashApiKey", () => {
  it("is deterministic", () => {
    expect(hashApiKey("dk_live_abc")).toBe(hashApiKey("dk_live_abc"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ids.test.ts`
Expected: FAIL — `generateApiKey`/`hashApiKey` not exported.

- [ ] **Step 3: Implement**

In `lib/ids.ts`, append (reuses the existing `nanoid` + `createHash` imports already at the top):

```ts
/** SHA-256 hex of an API key (same algorithm as device keys). */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Raw API key (shown once) + its hash + a short visible prefix for the UI list. */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `dk_live_${nanoid(40)}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, "dk_live_".length + 6) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ids.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ids.ts lib/ids.test.ts
git commit -m "feat(api): api key generation + hashing helpers"
```

---

## Task 2: Cursor encode/decode

**Files:**
- Create: `lib/api/cursor.ts`
- Test: `lib/api/cursor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/api/cursor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encodeCursor, decodeCursor } from "./cursor";

describe("cursor", () => {
  it("round-trips an encoded cursor", () => {
    const c = { t: "2026-06-07T12:00:00.000Z", id: "rcp_abc123" };
    const decoded = decodeCursor(encodeCursor(c));
    expect(decoded).toEqual(c);
  });
  it("produces a url-safe opaque string", () => {
    const s = encodeCursor({ t: "2026-06-07T12:00:00.000Z", id: "rcp_abc" });
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("returns null for garbage", () => {
    expect(decodeCursor("!!!notbase64!!!")).toBeNull();
    expect(decodeCursor(btoa("not json"))).toBeNull();
  });
  it("returns null when fields are missing or the date is invalid", () => {
    expect(decodeCursor(btoa(JSON.stringify({ id: "x" })))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ t: "nope", id: "x" })))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ t: "2026-06-07T12:00:00.000Z" })))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/api/cursor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/api/cursor.ts`:

```ts
// Opaque keyset cursor for /api/v1/receipts. Encodes (created_at ISO, id);
// the route orders by (created_at DESC, id DESC) and pages with a row-value
// comparison. Pure + IO-free.

export interface Cursor {
  t: string; // created_at as ISO-8601
  id: string;
}

export function encodeCursor(c: Cursor): string {
  const json = JSON.stringify({ t: c.t, id: c.id });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(s: string): Cursor | null {
  try {
    const json = Buffer.from(s, "base64url").toString("utf8");
    const obj = JSON.parse(json) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const { t, id } = obj as Record<string, unknown>;
    if (typeof t !== "string" || typeof id !== "string" || !id) return null;
    if (Number.isNaN(new Date(t).getTime())) return null;
    return { t, id };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/api/cursor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api/cursor.ts lib/api/cursor.test.ts
git commit -m "feat(api): opaque keyset cursor encode/decode"
```

---

## Task 3: Query-param parsing

**Files:**
- Create: `lib/api/params.ts`
- Test: `lib/api/params.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/api/params.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseListParams } from "./params";

const sp = (q: string) => new URLSearchParams(q);

describe("parseListParams", () => {
  it("defaults limit to 50 and accepts no filters", () => {
    const r = parseListParams(sp(""));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ limit: 50 });
  });
  it("clamps limit to 1..100", () => {
    expect((parseListParams(sp("limit=1000")) as any).value.limit).toBe(100);
    expect((parseListParams(sp("limit=0")) as any).value.limit).toBe(50);
    expect((parseListParams(sp("limit=25")) as any).value.limit).toBe(25);
  });
  it("parses filters", () => {
    const r = parseListParams(sp("store_id=str_1&device_id=dev_1&status=ready&token=tok"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.storeId).toBe("str_1");
      expect(r.value.deviceId).toBe("dev_1");
      expect(r.value.status).toBe("ready");
      expect(r.value.token).toBe("tok");
    }
  });
  it("parses ISO dates", () => {
    const r = parseListParams(sp("created_after=2026-06-01T00:00:00Z"));
    if (r.ok) expect(r.value.createdAfter instanceof Date).toBe(true);
    else throw new Error("expected ok");
  });
  it("rejects an invalid status", () => {
    const r = parseListParams(sp("status=bogus"));
    expect(r.ok).toBe(false);
  });
  it("rejects an unparseable date", () => {
    const r = parseListParams(sp("created_after=not-a-date"));
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/api/params.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/api/params.ts`:

```ts
// Pure parsing/validation of /api/v1/receipts query params. No IO.
import type { ReceiptStatus } from "@/lib/receipts-search";

const STATUSES: ReceiptStatus[] = ["pending", "ready", "downloaded"];

export interface ListParams {
  storeId?: string;
  deviceId?: string;
  status?: ReceiptStatus;
  createdAfter?: Date;
  createdBefore?: Date;
  token?: string;
  limit: number;
}

export type ParseResult =
  | { ok: true; value: ListParams }
  | { ok: false; error: string };

function str(v: string | null): string | undefined {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : undefined;
}

function parseDate(v: string | null, field: string): Date | undefined | { error: string } {
  const t = str(v);
  if (!t) return undefined;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? { error: `invalid_param: ${field}` } : d;
}

export function parseListParams(sp: URLSearchParams): ParseResult {
  const value: ListParams = { limit: 50 };

  const limitRaw = str(sp.get("limit"));
  if (limitRaw !== undefined) {
    const n = Number.parseInt(limitRaw, 10);
    if (Number.isFinite(n) && n >= 1) value.limit = Math.min(n, 100);
    // non-positive / NaN → keep default 50
  }

  const statusRaw = str(sp.get("status"));
  if (statusRaw !== undefined) {
    if (!STATUSES.includes(statusRaw as ReceiptStatus)) return { ok: false, error: "invalid_param: status" };
    value.status = statusRaw as ReceiptStatus;
  }

  value.storeId = str(sp.get("store_id"));
  value.deviceId = str(sp.get("device_id"));
  value.token = str(sp.get("token"));

  const after = parseDate(sp.get("created_after"), "created_after");
  if (after && "error" in (after as object)) return { ok: false, error: (after as { error: string }).error };
  if (after instanceof Date) value.createdAfter = after;

  const before = parseDate(sp.get("created_before"), "created_before");
  if (before && "error" in (before as object)) return { ok: false, error: (before as { error: string }).error };
  if (before instanceof Date) value.createdBefore = before;

  return { ok: true, value };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/api/params.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api/params.ts lib/api/params.test.ts
git commit -m "feat(api): query-param parsing + validation for receipts list"
```

---

## Task 4: Response helpers + serializers

**Files:**
- Create: `lib/api/respond.ts`
- Create: `lib/api/serialize.ts`
- Test: `lib/api/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/api/serialize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { serializeReceiptRow, serializeReceiptDetail, serializeUsage } from "./serialize";

describe("serializeReceiptRow", () => {
  it("maps to snake_case with ISO created_at", () => {
    const out = serializeReceiptRow({
      id: "rcp_1", token: "tok", status: "ready",
      storeId: "str_1", deviceId: "dev_1", byteSize: 2048,
      createdAt: new Date("2026-06-07T12:00:00.000Z"),
    });
    expect(out).toEqual({
      id: "rcp_1", token: "tok", status: "ready",
      store_id: "str_1", device_id: "dev_1", byte_size: 2048,
      created_at: "2026-06-07T12:00:00.000Z",
    });
  });
});

describe("serializeReceiptDetail", () => {
  it("includes image url + expiry and downloaded_at", () => {
    const out = serializeReceiptDetail({
      id: "rcp_1", token: "tok", status: "downloaded",
      storeId: "str_1", deviceId: "dev_1", byteSize: 2048,
      createdAt: "2026-06-07T12:00:00.000Z", downloadedAt: "2026-06-07T13:00:00.000Z",
      imageUrl: "https://r2/x",
    });
    expect(out.image_url).toBe("https://r2/x");
    expect(out.image_expires_in).toBe(300);
    expect(out.downloaded_at).toBe("2026-06-07T13:00:00.000Z");
    expect(out.store_id).toBe("str_1");
  });
  it("nulls image_expires_in when there is no image", () => {
    const out = serializeReceiptDetail({
      id: "rcp_1", token: "tok", status: "pending",
      storeId: null, deviceId: "dev_1", byteSize: 0,
      createdAt: "2026-06-07T12:00:00.000Z", downloadedAt: null, imageUrl: null,
    });
    expect(out.image_url).toBeNull();
    expect(out.image_expires_in).toBeNull();
  });
});

describe("serializeUsage", () => {
  it("passes through integer cents + machine keys", () => {
    const out = serializeUsage({
      unitPriceCents: 4, receiptsThisMonth: 10,
      currentPeriod: { start: "2026-06-01T00:00:00.000Z", end: "2026-07-01T00:00:00.000Z", receiptCount: 10, amountDueCents: 40 },
      daily: [{ date: "2026-06-01", receipts: 3 }],
      monthly: [{ month: "2026-06", receipts: 10 }],
    });
    expect(out.unit_price_cents).toBe(4);
    expect(out.current_period.amount_due_cents).toBe(40);
    expect(out.daily[0]).toEqual({ date: "2026-06-01", receipts: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/api/serialize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement both files**

Create `lib/api/respond.ts`:

```ts
import { NextResponse } from "next/server";

/** Consistent error body: { error: { code, message } }. */
export function apiError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function apiJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
```

Create `lib/api/serialize.ts`:

```ts
// view-model → public API JSON (snake_case, integer cents). Pure.
import type { ReceiptStatus } from "@/lib/receipts-search";

const IMAGE_TTL_SECONDS = 300; // matches lib/storage presigned GET TTL

export interface ApiReceiptRow {
  id: string;
  token: string;
  status: ReceiptStatus;
  storeId: string | null;
  deviceId: string;
  byteSize: number;
  createdAt: Date;
}

export function serializeReceiptRow(r: ApiReceiptRow) {
  return {
    id: r.id,
    token: r.token,
    status: r.status,
    store_id: r.storeId,
    device_id: r.deviceId,
    byte_size: r.byteSize,
    created_at: r.createdAt.toISOString(),
  };
}

export interface ApiReceiptDetail {
  id: string;
  token: string;
  status: ReceiptStatus;
  storeId: string | null;
  deviceId: string;
  byteSize: number;
  createdAt: string; // ISO
  downloadedAt: string | null;
  imageUrl: string | null;
}

export function serializeReceiptDetail(d: ApiReceiptDetail) {
  return {
    id: d.id,
    token: d.token,
    status: d.status,
    store_id: d.storeId,
    device_id: d.deviceId,
    byte_size: d.byteSize,
    created_at: d.createdAt,
    downloaded_at: d.downloadedAt,
    image_url: d.imageUrl,
    image_expires_in: d.imageUrl ? IMAGE_TTL_SECONDS : null,
  };
}

export interface ApiUsage {
  unitPriceCents: number;
  receiptsThisMonth: number;
  currentPeriod: { start: string; end: string; receiptCount: number; amountDueCents: number };
  daily: { date: string; receipts: number }[];
  monthly: { month: string; receipts: number }[];
}

export function serializeUsage(u: ApiUsage) {
  return {
    unit_price_cents: u.unitPriceCents,
    receipts_this_month: u.receiptsThisMonth,
    current_period: {
      start: u.currentPeriod.start,
      end: u.currentPeriod.end,
      receipt_count: u.currentPeriod.receiptCount,
      amount_due_cents: u.currentPeriod.amountDueCents,
    },
    daily: u.daily,
    monthly: u.monthly,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/api/serialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api/respond.ts lib/api/serialize.ts lib/api/serialize.test.ts
git commit -m "feat(api): response helpers + JSON serializers"
```

---

## Task 5: apiKey schema + migration + key data fns

**Files:**
- Modify: `lib/db/schema.ts`
- Generated: `drizzle/0011_*.sql`
- Modify: `lib/data.ts` (add `getApiKeys`)

> **DB note:** Run `npm run db:generate` (writes the migration file locally; no DB contact). Do **NOT** run `npm run db:migrate` — the controller applies it at a gated checkpoint.

- [ ] **Step 1: Add the table to the schema**

In `lib/db/schema.ts`, add after the `deviceCommand` table (uses the same `text`/`timestamp`/`index`/`uniqueIndex` imports already in the file):

```ts
export const apiKey = pgTable(
  "api_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    prefix: text("prefix").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    uniqueIndex("api_key_hash_idx").on(t.keyHash),
    index("api_key_organization_id_idx").on(t.organizationId),
  ],
);
```

Add `apiKey,` to the `schema` export map near the bottom of the file (alongside `deviceCommand`, `auditLog`, `alert`).

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: `drizzle/0011_*.sql` containing `CREATE TABLE "api_key" (...)` with the two indexes. Read the file to confirm.

- [ ] **Step 3: Add `getApiKeys` to the data layer**

In `lib/data.ts`, import `apiKey as apiKeyTable` from the schema (add to the existing schema import), then add:

```ts
export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** Non-secret API key listing for the management UI (never returns keyHash). */
export async function getApiKeys(organizationId: string): Promise<ApiKeyRow[]> {
  const rows = await db
    .select({
      id: apiKeyTable.id,
      name: apiKeyTable.name,
      prefix: apiKeyTable.prefix,
      lastUsedAt: apiKeyTable.lastUsedAt,
      createdAt: apiKeyTable.createdAt,
      revokedAt: apiKeyTable.revokedAt,
    })
    .from(apiKeyTable)
    .where(eq(apiKeyTable.organizationId, organizationId))
    .orderBy(desc(apiKeyTable.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  }));
}
```

(`eq`, `desc`, `db` are already imported in `lib/data.ts`.)

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle lib/data.ts
git commit -m "feat(api): api_key table + getApiKeys data fn"
```

---

## Task 6: API key authentication

**Files:**
- Create: `lib/api-auth.ts`

- [ ] **Step 1: Create the module**

Create `lib/api-auth.ts`:

```ts
// Shared API-key authentication for /api/v1 routes.
// Mirrors lib/device-auth.ts: resolve the org from Authorization: Bearer <key>.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKey as apiKeyTable } from "@/lib/db/schema";
import { hashApiKey } from "@/lib/ids";

export interface ApiKeyAuth {
  organizationId: string;
  keyId: string;
  keyHash: string;
}

/** Resolve a non-revoked API key from the Bearer header, or null. Best-effort
 *  bumps last_used_at (non-blocking). */
export async function authenticateApiKey(req: Request): Promise<ApiKeyAuth | null> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const keyHash = hashApiKey(match[1].trim());

  const [row] = await db
    .select({ id: apiKeyTable.id, organizationId: apiKeyTable.organizationId })
    .from(apiKeyTable)
    .where(and(eq(apiKeyTable.keyHash, keyHash), isNull(apiKeyTable.revokedAt)))
    .limit(1);
  if (!row) return null;

  // Fire-and-forget last-used bump; never block or fail the request on it.
  db.update(apiKeyTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeyTable.id, row.id))
    .catch(() => {});

  return { organizationId: row.organizationId, keyId: row.id, keyHash };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/api-auth.ts
git commit -m "feat(api): API key bearer authentication"
```

---

## Task 7: Data-layer queries (cursor list, usage, receipt detail IDs)

**Files:**
- Modify: `lib/data.ts`

- [ ] **Step 1: Extend `getReceiptDetail` to return store/device IDs**

In `lib/data.ts`, in `getReceiptDetail`, add `storeId` and `deviceId` to BOTH the `.select({...})` and the returned object. In the select add:

```ts
      storeId: receiptTable.storeId,
      deviceId: receiptTable.deviceId,
```

In the returned object (the `return { ... }` at the end of the function) add:

```ts
    storeId: r.storeId,
    deviceId: r.deviceId,
```

(Existing UI consumers ignore the extra fields — additive only.)

- [ ] **Step 2: Add `listReceiptsByCursor`**

In `lib/data.ts`, ensure `gte`, `lte`, `desc`, `sql`, `and`, `eq` are imported from `drizzle-orm` (most already are — add any missing). Then add:

```ts
import type { ApiReceiptRow } from "@/lib/api/serialize";

export interface ApiReceiptFilters {
  organizationId: string;
  storeId?: string;
  deviceId?: string;
  status?: "pending" | "ready" | "downloaded";
  createdAfter?: Date;
  createdBefore?: Date;
  token?: string;
  limit: number;            // pass desired+1 to detect a next page
  cursor?: { t: Date; id: string };
}

/** Keyset (cursor) receipt list for /api/v1, newest first. Org-scoped. */
export async function listReceiptsByCursor(f: ApiReceiptFilters): Promise<ApiReceiptRow[]> {
  const conds = [eq(receiptTable.organizationId, f.organizationId)];
  if (f.storeId) conds.push(eq(receiptTable.storeId, f.storeId));
  if (f.deviceId) conds.push(eq(receiptTable.deviceId, f.deviceId));
  if (f.status) conds.push(eq(receiptTable.status, f.status));
  if (f.createdAfter) conds.push(gte(receiptTable.createdAt, f.createdAfter));
  if (f.createdBefore) conds.push(lte(receiptTable.createdAt, f.createdBefore));
  if (f.token) conds.push(eq(receiptTable.token, f.token));
  if (f.cursor) {
    // Keyset page: rows strictly "after" the cursor in (created_at DESC, id DESC).
    conds.push(sql`(${receiptTable.createdAt}, ${receiptTable.id}) < (${f.cursor.t}, ${f.cursor.id})`);
  }

  const rows = await db
    .select({
      id: receiptTable.id,
      token: receiptTable.token,
      status: receiptTable.status,
      storeId: receiptTable.storeId,
      deviceId: receiptTable.deviceId,
      byteSize: receiptTable.byteSize,
      createdAt: receiptTable.createdAt,
    })
    .from(receiptTable)
    .where(and(...conds))
    .orderBy(desc(receiptTable.createdAt), desc(receiptTable.id))
    .limit(f.limit);

  return rows;
}
```

- [ ] **Step 3: Add `getApiUsage`**

In `lib/data.ts` (it already imports `dayKeys`, `monthKeys`, `count`, `sql`, `gte`, `tenantSettings`), add:

```ts
export interface ApiUsageData {
  unitPriceCents: number;
  receiptsThisMonth: number;
  currentPeriod: { start: string; end: string; receiptCount: number; amountDueCents: number };
  daily: { date: string; receipts: number }[];
  monthly: { month: string; receipts: number }[];
}

/** Machine-keyed usage for /api/v1/usage (integer cents, UTC buckets). */
export async function getApiUsage(organizationId: string): Promise<ApiUsageData> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const since30 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
  const since12mo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

  const dayExpr = sql<string>`to_char(date_trunc('day', ${receiptTable.createdAt}), 'YYYY-MM-DD')`;
  const monthExpr = sql<string>`to_char(date_trunc('month', ${receiptTable.createdAt}), 'YYYY-MM')`;
  const orgScope = (since: Date) => and(eq(receiptTable.organizationId, organizationId), gte(receiptTable.createdAt, since));

  const [settingsRow] = await db
    .select({ price: tenantSettings.perPrintPriceCents })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, organizationId))
    .limit(1);
  const unitPriceCents = settingsRow?.price ?? 4;

  const [dailyRows, monthlyRows, monthCountRows] = await Promise.all([
    db.select({ bucket: dayExpr, count: count() }).from(receiptTable).where(orgScope(since30)).groupBy(dayExpr),
    db.select({ bucket: monthExpr, count: count() }).from(receiptTable).where(orgScope(since12mo)).groupBy(monthExpr),
    db.select({ count: count() }).from(receiptTable).where(orgScope(monthStart)),
  ]);

  const dailyMap = new Map(dailyRows.map((r) => [r.bucket, Number(r.count)]));
  const monthlyMap = new Map(monthlyRows.map((r) => [r.bucket, Number(r.count)]));
  const daily = dayKeys(now, 30).map((k) => ({ date: k.key, receipts: dailyMap.get(k.key) ?? 0 }));
  const monthly = monthKeys(now, 12).map((k) => ({ month: k.key, receipts: monthlyMap.get(k.key) ?? 0 }));
  const receiptsThisMonth = Number(monthCountRows[0]?.count ?? 0);

  return {
    unitPriceCents,
    receiptsThisMonth,
    currentPeriod: {
      start: monthStart.toISOString(),
      end: monthEnd.toISOString(),
      receiptCount: receiptsThisMonth,
      amountDueCents: receiptsThisMonth * unitPriceCents,
    },
    daily,
    monthly,
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: build succeeds. (`ApiReceiptRow`/`ApiUsageData` line up with the serializers from Task 4: `ApiUsageData` is structurally the serializer's `ApiUsage`.)

- [ ] **Step 5: Commit**

```bash
git add lib/data.ts
git commit -m "feat(api): cursor receipt list, usage aggregate, receipt detail IDs"
```

---

## Task 8: v1 route handlers (receipts, receipt detail, usage)

**Files:**
- Create: `app/api/v1/receipts/route.ts`
- Create: `app/api/v1/receipts/[id]/route.ts`
- Create: `app/api/v1/usage/route.ts`

- [ ] **Step 1: Receipts list route**

Create `app/api/v1/receipts/route.ts`:

```ts
import { authenticateApiKey } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSuspended } from "@/lib/billing/billing-status";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { parseListParams } from "@/lib/api/params";
import { decodeCursor, encodeCursor } from "@/lib/api/cursor";
import { serializeReceiptRow } from "@/lib/api/serialize";
import { apiError, apiJson } from "@/lib/api/respond";
import { listReceiptsByCursor } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (!auth) return apiError("unauthorized", "Missing or invalid API key.", 401);

  const rl = checkRateLimit(auth.keyHash, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return apiError("rate_limited", "Too many requests.", 429);

  const [billing] = await db
    .select({ status: tenantSettings.subscriptionStatus })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, auth.organizationId))
    .limit(1);
  if (isSuspended(billing?.status ?? null)) return apiError("subscription_inactive", "Subscription inactive.", 403);

  const url = new URL(req.url);
  const parsed = parseListParams(url.searchParams);
  if (!parsed.ok) return apiError("invalid_param", parsed.error, 400);

  let cursor: { t: Date; id: string } | undefined;
  const cursorParam = url.searchParams.get("cursor");
  if (cursorParam) {
    const c = decodeCursor(cursorParam);
    if (!c) return apiError("invalid_cursor", "Malformed cursor.", 400);
    cursor = { t: new Date(c.t), id: c.id };
  }

  const limit = parsed.value.limit;
  const rows = await listReceiptsByCursor({
    organizationId: auth.organizationId,
    storeId: parsed.value.storeId,
    deviceId: parsed.value.deviceId,
    status: parsed.value.status,
    createdAfter: parsed.value.createdAfter,
    createdBefore: parsed.value.createdBefore,
    token: parsed.value.token,
    limit: limit + 1, // fetch one extra to detect a next page
    cursor,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null;

  return apiJson({ data: page.map(serializeReceiptRow), next_cursor: nextCursor });
}
```

- [ ] **Step 2: Receipt detail route**

Create `app/api/v1/receipts/[id]/route.ts`:

```ts
import { authenticateApiKey } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { serializeReceiptDetail } from "@/lib/api/serialize";
import { apiError, apiJson } from "@/lib/api/respond";
import { getReceiptDetail } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(req);
  if (!auth) return apiError("unauthorized", "Missing or invalid API key.", 401);

  const rl = checkRateLimit(auth.keyHash, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return apiError("rate_limited", "Too many requests.", 429);

  const { id } = await params;
  const detail = await getReceiptDetail(id, { organizationId: auth.organizationId });
  if (!detail) return apiError("not_found", "Receipt not found.", 404);

  return apiJson(serializeReceiptDetail(detail));
}
```

Note: `getReceiptDetail` (extended in Task 7) returns `{ id, token, status, storeId, deviceId, byteSize, createdAt, downloadedAt, imageUrl, storeName, deviceName }`. `serializeReceiptDetail` reads only the API fields and ignores the names — its `ApiReceiptDetail` input type is structurally satisfied.

- [ ] **Step 3: Usage route**

Create `app/api/v1/usage/route.ts`:

```ts
import { authenticateApiKey } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { serializeUsage } from "@/lib/api/serialize";
import { apiError, apiJson } from "@/lib/api/respond";
import { getApiUsage } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (!auth) return apiError("unauthorized", "Missing or invalid API key.", 401);

  const rl = checkRateLimit(auth.keyHash, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return apiError("rate_limited", "Too many requests.", 429);

  const usage = await getApiUsage(auth.organizationId);
  return apiJson(serializeUsage(usage));
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: build succeeds; the three `/api/v1/...` routes appear in the route list.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/receipts app/api/v1/usage
git commit -m "feat(api): v1 receipts list/detail + usage route handlers"
```

---

## Task 9: API key management actions

**Files:**
- Modify: `lib/audit.ts`
- Create: `lib/actions/api-keys.ts`

- [ ] **Step 1: Add audit constants**

In `lib/audit.ts`, in the `AUDIT` object, add after `storeUpdated`:

```ts
  apiKeyCreated: "api_key.created",
  apiKeyRevoked: "api_key.revoked",
```

- [ ] **Step 2: Create the actions**

Create `lib/actions/api-keys.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKey as apiKeyTable } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { id, generateApiKey } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";

function canManage(role: string | undefined): boolean {
  return !!role && ["owner", "admin"].includes(role);
}

export interface CreateApiKeyResult {
  ok: boolean;
  error?: string;
  key?: string; // raw key, returned ONCE
}

export async function createApiKey(formData: FormData): Promise<CreateApiKeyResult> {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!canManage(role)) return { ok: false, error: "You don't have permission to create API keys." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Key name is required." };

  const { key, hash, prefix } = generateApiKey();
  const keyId = id("ak");
  await db.insert(apiKeyTable).values({
    id: keyId,
    organizationId,
    name,
    keyHash: hash,
    prefix,
    createdByUserId: ctx.user.id,
    createdAt: new Date(),
  });

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.apiKeyCreated,
    target: { type: "api_key", id: keyId },
    metadata: { name, prefix },
  });

  revalidatePath("/tenant/api");
  return { ok: true, key };
}

export interface RevokeApiKeyResult {
  ok: boolean;
  error?: string;
}

export async function revokeApiKey(keyId: string): Promise<RevokeApiKeyResult> {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!canManage(role)) return { ok: false, error: "You don't have permission to revoke API keys." };

  const [existing] = await db
    .select({ id: apiKeyTable.id })
    .from(apiKeyTable)
    .where(and(eq(apiKeyTable.id, keyId), eq(apiKeyTable.organizationId, organizationId)))
    .limit(1);
  if (!existing) return { ok: false, error: "Key not found." };

  await db
    .update(apiKeyTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeyTable.id, keyId), eq(apiKeyTable.organizationId, organizationId)));

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.apiKeyRevoked,
    target: { type: "api_key", id: keyId },
  });

  revalidatePath("/tenant/api");
  return { ok: true };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/audit.ts lib/actions/api-keys.ts
git commit -m "feat(api): create/revoke API key actions + audit"
```

---

## Task 10: Key-management UI + nav

**Files:**
- Modify: `lib/nav.ts`
- Create: `components/api-key-create-dialog.tsx`
- Create: `components/api-key-row-actions.tsx`
- Create: `app/(tenant)/tenant/api/page.tsx`

- [ ] **Step 1: Add the nav entry**

In `lib/nav.ts`, add `KeyRound` to the lucide import, and add this item to `TENANT_NAV` after the Billing entry:

```ts
  { label: "API", href: "/tenant/api", icon: KeyRound },
```

- [ ] **Step 2: Create the create-key dialog**

Create `components/api-key-create-dialog.tsx`:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createApiKey } from "@/lib/actions/api-keys";

export function ApiKeyCreateDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [createdKey, setCreatedKey] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  function reset() {
    setCreatedKey(null);
    setCopied(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    const res = await createApiKey(fd);
    setPending(false);
    if (!res.ok || !res.key) {
      toast.error("Couldn't create key", { description: res.error });
      return;
    }
    setCreatedKey(res.key);
    router.refresh();
  }

  async function copy() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    toast.success("Copied to clipboard");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Create API key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {createdKey ? (
          <>
            <DialogHeader>
              <DialogTitle>API key created</DialogTitle>
              <DialogDescription>
                Copy it now — you won&apos;t be able to see it again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 py-4">
              <code className="flex-1 truncate rounded bg-muted px-3 py-2 font-mono text-xs">
                {createdKey}
              </code>
              <Button type="button" variant="outline" size="icon" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                A read-only key scoped to this organization.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" name="name" placeholder="e.g. Analytics export" required />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {pending ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create the revoke row-action**

Create `components/api-key-row-actions.tsx`:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { revokeApiKey } from "@/lib/actions/api-keys";

export function ApiKeyRowActions({ keyId, name }: { keyId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function handleRevoke() {
    setPending(true);
    const res = await revokeApiKey(keyId);
    setPending(false);
    if (!res.ok) {
      toast.error("Couldn't revoke key", { description: res.error });
      return;
    }
    setOpen(false);
    toast.success("Key revoked");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive">
          <Trash2 className="size-4" />
          <span className="sr-only">Revoke {name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Revoke API key</DialogTitle>
          <DialogDescription>
            “{name}” will stop working immediately. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" variant="destructive" onClick={handleRevoke} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {pending ? "Revoking…" : "Revoke"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Create the page**

Create `app/(tenant)/tenant/api/page.tsx`:

```tsx
import { PageHeader } from "@/components/page-header";
import { ApiKeyCreateDialog } from "@/components/api-key-create-dialog";
import { ApiKeyRowActions } from "@/components/api-key-row-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getApiKeys } from "@/lib/data";
import { requireTenant } from "@/lib/session";

export default async function ApiKeysPage() {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  const canManage = !!role && ["owner", "admin"].includes(role);
  const keys = await getApiKeys(organizationId);
  const active = keys.filter((k) => !k.revokedAt);

  return (
    <>
      <PageHeader
        title="API keys"
        description="Read-only keys for the Maratus public API."
      >
        {canManage && <ApiKeyCreateDialog />}
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Using the API</CardTitle>
          <CardDescription>
            Base URL <code className="font-mono">/api/v1</code> · authenticate with{" "}
            <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>. Endpoints:{" "}
            <code className="font-mono">GET /receipts</code>, <code className="font-mono">GET /receipts/&#123;id&#125;</code>,{" "}
            <code className="font-mono">GET /usage</code>. Full schema:{" "}
            <a className="underline" href="/api/v1/openapi.json">/api/v1/openapi.json</a>.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 5 : 4} className="py-10 text-center text-sm text-muted-foreground">
                  No API keys yet.
                </TableCell>
              </TableRow>
            ) : (
              active.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell>
                    <code className="font-mono text-xs text-muted-foreground">{k.prefix}…</code>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "Never"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <ApiKeyRowActions keyId={k.id} name={k.name} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: build succeeds; `/tenant/api` appears in the route list.

- [ ] **Step 6: Commit**

```bash
git add lib/nav.ts components/api-key-create-dialog.tsx components/api-key-row-actions.tsx "app/(tenant)/tenant/api/page.tsx"
git commit -m "feat(api): API key management page + nav entry"
```

---

## Task 11: OpenAPI document + served route + guard test

**Files:**
- Create: `openapi.json` (repo root)
- Create: `app/api/v1/openapi.json/route.ts`
- Test: `lib/api/openapi.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/api/openapi.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import openapi from "../../openapi.json";

describe("openapi.json", () => {
  it("is an OpenAPI 3.1 document", () => {
    expect((openapi as { openapi: string }).openapi).toMatch(/^3\.1/);
  });
  it("declares exactly the three implemented paths", () => {
    expect(Object.keys((openapi as { paths: Record<string, unknown> }).paths).sort()).toEqual(
      ["/receipts", "/receipts/{id}", "/usage"],
    );
  });
  it("defines a bearerAuth security scheme and applies it globally", () => {
    const doc = openapi as {
      components: { securitySchemes: Record<string, { type: string; scheme?: string }> };
      security: Array<Record<string, unknown>>;
    };
    expect(doc.components.securitySchemes.bearerAuth).toEqual({ type: "http", scheme: "bearer" });
    expect(doc.security).toContainEqual({ bearerAuth: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/api/openapi.test.ts`
Expected: FAIL — `openapi.json` not found.

- [ ] **Step 3: Create `openapi.json`** (repo root)

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "Maratus Public API",
    "version": "1.0.0",
    "description": "Read-only, tenant-scoped access to receipts and usage. Authenticate with an API key created in the Maratus dashboard (Authorization: Bearer <key>)."
  },
  "servers": [{ "url": "/api/v1" }],
  "security": [{ "bearerAuth": [] }],
  "paths": {
    "/receipts": {
      "get": {
        "summary": "List receipts",
        "parameters": [
          { "name": "store_id", "in": "query", "schema": { "type": "string" } },
          { "name": "device_id", "in": "query", "schema": { "type": "string" } },
          { "name": "status", "in": "query", "schema": { "type": "string", "enum": ["pending", "ready", "downloaded"] } },
          { "name": "created_after", "in": "query", "schema": { "type": "string", "format": "date-time" } },
          { "name": "created_before", "in": "query", "schema": { "type": "string", "format": "date-time" } },
          { "name": "token", "in": "query", "schema": { "type": "string" } },
          { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 50, "maximum": 100, "minimum": 1 } },
          { "name": "cursor", "in": "query", "schema": { "type": "string" }, "description": "Opaque cursor from a previous next_cursor." }
        ],
        "responses": {
          "200": { "description": "A page of receipts", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ReceiptList" } } } },
          "400": { "$ref": "#/components/responses/Error" },
          "401": { "$ref": "#/components/responses/Error" },
          "403": { "$ref": "#/components/responses/Error" },
          "429": { "$ref": "#/components/responses/Error" }
        }
      }
    },
    "/receipts/{id}": {
      "get": {
        "summary": "Get a receipt",
        "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }],
        "responses": {
          "200": { "description": "Receipt with a short-lived image URL", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ReceiptDetail" } } } },
          "401": { "$ref": "#/components/responses/Error" },
          "403": { "$ref": "#/components/responses/Error" },
          "404": { "$ref": "#/components/responses/Error" },
          "429": { "$ref": "#/components/responses/Error" }
        }
      }
    },
    "/usage": {
      "get": {
        "summary": "Usage totals",
        "responses": {
          "200": { "description": "Usage for the org", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Usage" } } } },
          "401": { "$ref": "#/components/responses/Error" },
          "403": { "$ref": "#/components/responses/Error" },
          "429": { "$ref": "#/components/responses/Error" }
        }
      }
    }
  },
  "components": {
    "securitySchemes": { "bearerAuth": { "type": "http", "scheme": "bearer" } },
    "responses": {
      "Error": { "description": "Error", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
    },
    "schemas": {
      "Error": {
        "type": "object",
        "properties": { "error": { "type": "object", "properties": { "code": { "type": "string" }, "message": { "type": "string" } }, "required": ["code", "message"] } },
        "required": ["error"]
      },
      "Receipt": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "token": { "type": "string" },
          "status": { "type": "string", "enum": ["pending", "ready", "downloaded"] },
          "store_id": { "type": ["string", "null"] },
          "device_id": { "type": "string" },
          "byte_size": { "type": "integer" },
          "created_at": { "type": "string", "format": "date-time" }
        }
      },
      "ReceiptList": {
        "type": "object",
        "properties": {
          "data": { "type": "array", "items": { "$ref": "#/components/schemas/Receipt" } },
          "next_cursor": { "type": ["string", "null"] }
        }
      },
      "ReceiptDetail": {
        "allOf": [
          { "$ref": "#/components/schemas/Receipt" },
          {
            "type": "object",
            "properties": {
              "downloaded_at": { "type": ["string", "null"], "format": "date-time" },
              "image_url": { "type": ["string", "null"] },
              "image_expires_in": { "type": ["integer", "null"] }
            }
          }
        ]
      },
      "Usage": {
        "type": "object",
        "properties": {
          "unit_price_cents": { "type": "integer" },
          "receipts_this_month": { "type": "integer" },
          "current_period": {
            "type": "object",
            "properties": {
              "start": { "type": "string", "format": "date-time" },
              "end": { "type": "string", "format": "date-time" },
              "receipt_count": { "type": "integer" },
              "amount_due_cents": { "type": "integer" }
            }
          },
          "daily": { "type": "array", "items": { "type": "object", "properties": { "date": { "type": "string" }, "receipts": { "type": "integer" } } } },
          "monthly": { "type": "array", "items": { "type": "object", "properties": { "month": { "type": "string" }, "receipts": { "type": "integer" } } } }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/api/openapi.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the served route**

Create `app/api/v1/openapi.json/route.ts`:

```ts
import { NextResponse } from "next/server";
import openapi from "@/openapi.json";

export const runtime = "nodejs";

// Public (unauthenticated) — the schema contains no secrets and is needed by
// API consumers to import the spec into tooling / generate clients.
export async function GET() {
  return NextResponse.json(openapi);
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: build succeeds; `/api/v1/openapi.json` appears in the route list.

- [ ] **Step 7: Commit**

```bash
git add openapi.json app/api/v1/openapi.json lib/api/openapi.test.ts
git commit -m "feat(api): OpenAPI 3.1 document + served /api/v1/openapi.json"
```

---

## Task 12: Full verification (tests, build, migration, manual curl)

**Files:** none (verification only)

> The earlier tasks committed schema + migration but intentionally did NOT run `db:migrate`. This task applies it (gated on the live Neon DB) and verifies end-to-end.

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all tests pass (including `ids`, `cursor`, `params`, `serialize`, `openapi`).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: success; `/api/v1/receipts`, `/api/v1/receipts/[id]`, `/api/v1/usage`, `/api/v1/openapi.json`, and `/tenant/api` all listed.

- [ ] **Step 3: Apply the migration (live Neon — controller-gated)**

Run: `npm run db:migrate`
Expected: migration `0011` (api_key) applies cleanly.

- [ ] **Step 4: Manual end-to-end with a real key**

Start `npm run dev`, sign in as a tenant owner (`dana@roastwell.co` locally), open **/tenant/api**, create a key, copy it, then:

```bash
KEY=dk_live_...   # the copied key
BASE=http://localhost:3000/api/v1
curl -s -H "Authorization: Bearer $KEY" "$BASE/receipts?limit=2" | jq
curl -s -H "Authorization: Bearer $KEY" "$BASE/usage" | jq
# paginate: take next_cursor from the first call
curl -s -H "Authorization: Bearer $KEY" "$BASE/receipts?limit=2&cursor=<next_cursor>" | jq
# detail (use an id from the list): confirm image_url present AND status NOT flipped to downloaded
ID=rcp_...; curl -s -H "Authorization: Bearer $KEY" "$BASE/receipts/$ID" | jq
curl -s -H "Authorization: Bearer $KEY" "$BASE/receipts/$ID" | jq '.status'   # still "ready", not "downloaded"
# auth + cursor errors
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/receipts"                      # 401
curl -s -H "Authorization: Bearer $KEY" "$BASE/receipts?cursor=garbage" | jq   # invalid_cursor 400
curl -s "$BASE/openapi.json" | jq '.openapi'                                    # "3.1.0"
# revoke the key in the UI, then:
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $KEY" "$BASE/receipts"  # 401 (revoked)
```

Expected: list paginates through the full set with stable ordering; `/receipts/{id}` returns an `image_url` and **does NOT** change the receipt's status; bad/missing key → 401; bad cursor → 400; revoked key → 401.

- [ ] **Step 5: Commit any fixups**

```bash
git add -A && git commit -m "chore(api): v1 verification fixups" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** keys (T5/T6/T9), auth + rate-limit + suspension (T6/T8), receipts list cursor (T2/T3/T7/T8), receipt detail read-only + presigned image (T7/T8 reuse `getReceiptDetail`), usage integer-cents machine-keyed (T4/T7/T8), `/tenant/api` UI + nav (T10), OpenAPI 3.1 committed + served + guard test (T11), integer-cents convention (T4 serializers), `/api/v1` versioning (T8/T11), migration gated (T5/T12).
- **Non-goals respected:** no write endpoints, no stores/devices/members resources, no per-key scopes, no Swagger UI/SDKs (only the served JSON doc), no webhooks.
- **Type consistency:** `ApiReceiptRow` defined in `lib/api/serialize.ts` (T4) and returned by `listReceiptsByCursor` (T7), consumed by the list route (T8). `ApiUsageData` (T7) is structurally the serializer's `ApiUsage` (T4). `getReceiptDetail` extended (T7) satisfies `serializeReceiptDetail`'s `ApiReceiptDetail` input (T4/T8). `generateApiKey`/`hashApiKey` (T1) used by `api-auth` (T6) and the create action (T9).
- **Security:** every data path is org-scoped via the key's `organizationId`; `revokeApiKey` re-checks org ownership; the served OpenAPI doc is deliberately public and secret-free.
