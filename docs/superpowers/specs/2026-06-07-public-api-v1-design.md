# Public REST API v1 (tenant data export) — design

**Date:** 2026-06-07
**Status:** Approved (brainstorm) → ready for implementation plan
**Area:** Phase 3 — platform openness. **Part 1 of 2** (the outbound **webhooks** subsystem is a separate, later spec→plan→build cycle).

## Summary

A read-only, tenant-scoped public REST API so a tenant's own backend/BI can export their
receipt data and usage. Tenants mint API keys from a new in-app page; requests authenticate
with `Authorization: Bearer <key>` and are scoped to the key's organization. v1 exposes three
endpoints under `/api/v1`: list receipts (cursor-paginated, filterable), get one receipt
(metadata + a short-lived presigned image URL), and usage totals.

This builds directly on existing patterns: the device bearer-key model (`lib/device-auth.ts`,
SHA-256 hash lookup), `lib/rate-limit.ts`, `lib/storage.ts` presigned URLs, the read-only
`getReceiptDetail`, and `recordAudit`.

## Motivation

The admin console is feature-complete; opening a programmatic read path lets tenants integrate
Maratus receipt data into their own systems without screen-scraping. Read-only export is the most
common and lowest-risk first API surface, and it reuses the existing read-only data layer almost
directly.

## Non-goals (v1)

- **No write endpoints** (no creating stores/devices/members, no claiming kiosks).
- **No stores/devices/members resources** — receipts + usage only. Consumers resolve store/device
  IDs out-of-band for now.
- **No per-key scopes/permissions** — every key grants full **read** access to its own org.
- **No hosted Swagger UI page and no generated SDKs** — but a machine-readable **OpenAPI 3.1
  document IS in scope** (see "API documentation" below). Rendering it / shipping SDKs is deferred.
- **No webhooks** — that is Part 2 (separate spec).
- **No cross-org/platform-admin API** — keys are strictly single-org.

## Decisions (resolved during brainstorming)

| Decision | Choice |
|---|---|
| Use case | Tenant read-only data export/integration |
| Resources | Receipts (list + get) and Usage only |
| Pagination | **Cursor-based** (keyset) |
| Key model | **Roll our own org-scoped `apiKey` table** (mirror device-key pattern); NOT the user-scoped Better Auth apiKey plugin |
| Money in responses | **Integer cents** (stable API contract), not the UI's dollar conversion |
| Versioned base path | `/api/v1` |
| Key management UI | New tenant page `/tenant/api`, owner/admin only |
| API documentation | **OpenAPI 3.1**, committed `openapi.json`, served at `GET /api/v1/openapi.json` (no hosted Swagger UI in v1) |

## Data model

New table in `lib/db/schema.ts`, migration via `npm run db:generate` (next is `0011_*.sql`):

```ts
export const apiKey = pgTable(
  "api_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // SHA-256 hash of the raw key (raw shown once at creation).
    keyHash: text("key_hash").notNull(),
    // Visible identifier prefix for the UI list, e.g. "dk_live_a1b2c3".
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

Add to the `schema` export map. (Not a Better-Auth table, so no `auth:generate` parity concern.)

## Auth

- **Key format:** `dk_live_<40-char nanoid>`. The raw key is returned **once** at creation; only
  `keyHash` (SHA-256 hex) is persisted. `prefix` stores the leading `dk_live_` + first 6 chars of
  the random part for human identification in the list.
- `lib/ids.ts`: add `generateApiKey(): { key, hash, prefix }` and `hashApiKey(key)` (SHA-256 hex;
  same algorithm as `hashDeviceKey`).
- `lib/api-auth.ts`: `authenticateApiKey(req): Promise<{ organizationId: string; keyId: string } | null>`
  — parse `Authorization: Bearer <key>`, hash, look up a row where `keyHash` matches AND
  `revokedAt IS NULL`. On hit, best-effort (non-blocking) bump `lastUsedAt`; return org + key id.
  Return null on missing/garbage/revoked.
- **Rate limit:** reuse `checkRateLimit(keyHash, { limit: 120, windowMs: 60_000 })` per key
  (generous for export polling; 429 on exceed with a `Retry-After`-style message).
- **Suspension:** if the org is `isSuspended(...)` (terminally unpaid, per `lib/billing/billing-status.ts`),
  return 403 — consistent with `/api/ingest`.

## Endpoints (`/api/v1`, all `Authorization: Bearer`, `application/json`)

Each route file lives under `app/api/v1/...`, `runtime = "nodejs"`, and shares a thin auth+error
wrapper. Standard error body: `{ "error": { "code": string, "message": string } }`.

### `GET /api/v1/receipts`
Cursor-paginated, filterable list, newest first.

Query params (all optional): `store_id`, `device_id`, `status` (`pending|ready|downloaded`),
`created_after` / `created_before` (ISO-8601), `token` (exact), `limit` (default 50, max 100),
`cursor` (opaque, from a previous `next_cursor`).

Response:
```json
{
  "data": [
    { "id": "rcp_…", "token": "…", "status": "ready",
      "store_id": "str_…", "device_id": "dev_…",
      "byte_size": 20480, "created_at": "2026-06-07T12:00:00.000Z" }
  ],
  "next_cursor": "eyJ0IjoiMjAyNi0wNi0wN1QxMjowMDowMC4wMDBaIiwiaWQiOiJyY3Bf…"
}
```
`next_cursor` is null when there are no more rows. (Includes `store_id`/`device_id` raw IDs so
consumers can group; names are intentionally omitted — catalog resources are a non-goal.)

### `GET /api/v1/receipts/{id}`
Single receipt: metadata + a fresh short-lived presigned R2 image URL (5-min TTL).
**Read-only — MUST NOT flip `ready → downloaded`.** Reuses `getReceiptDetail(id, { organizationId })`
(already read-only). 404 if the receipt isn't in the key's org.

Response:
```json
{ "id": "rcp_…", "token": "…", "status": "ready",
  "store_id": "str_…", "device_id": "dev_…", "byte_size": 20480,
  "created_at": "…", "downloaded_at": null,
  "image_url": "https://…r2…?X-Amz-Expires=300", "image_expires_in": 300 }
```
`image_url` is null when status is `pending` or presigning fails.

### `GET /api/v1/usage`
Aggregate usage for the org.

Response:
```json
{
  "unit_price_cents": 4,
  "receipts_this_month": 1234,
  "current_period": { "start": "2026-06-01T00:00:00.000Z", "end": "…", "receipt_count": 1234, "amount_due_cents": 4936 },
  "daily": [ { "date": "2026-06-01", "receipts": 40 } ],
  "monthly": [ { "month": "2026-06", "receipts": 1234 } ]
}
```
Money is **integer cents**. Sourced from a dedicated `getApiUsage(organizationId)` data-layer
function (see Internals) that returns **machine-keyed** buckets (`date`=`YYYY-MM-DD`,
`month`=`YYYY-MM`) and raw integer counts/cents — NOT the UI's `tenantDaily`/`tenantMonthly`
view-models (which emit display labels like "Jun 1" and dollar revenue). It reuses the existing
`dayKeys`/`monthKeys` bucket helpers for the keys.

## Cursor design

- Opaque cursor = base64url of `{ "t": "<createdAt ISO>", "id": "<receipt id>" }`.
- Query: `ORDER BY created_at DESC, id DESC`, and when a cursor is present add the keyset predicate
  `(created_at, id) < (cursorCreatedAt, cursorId)` (Postgres row-value comparison via a Drizzle
  `sql` fragment). Fetch `limit + 1` rows to determine whether a `next_cursor` exists; return the
  last returned row's keyset as the next cursor.
- Decoding validates shape and date parseability; a malformed cursor → 400 `invalid_cursor`.

## API documentation (OpenAPI 3.1)

- **Source artifact:** a committed `openapi.json` (repo root) — an OpenAPI **3.1** document, the
  single source of truth, hand-authored. JSON (not YAML) so it imports directly and is served with
  zero new dependencies (the codebase avoids extra bundled packages — see CLAUDE.md). It covers:
  - `info` (title "Maratus Public API", version `1.0.0`), `servers` (`{BETTER_AUTH_URL}/api/v1`).
  - `securitySchemes`: `bearerAuth` (HTTP bearer) applied globally.
  - All three paths with parameters, and reusable `components.schemas`: `Receipt`, `ReceiptDetail`,
    `Usage`, `ReceiptList` (data + `next_cursor`), and `Error` (`{ error: { code, message } }`).
  - The documented query params (filters, `limit`, `cursor`) and the standard error responses
    (400/401/403/404/429).
- **Served at:** `GET /api/v1/openapi.json` (`app/api/v1/openapi.json/route.ts`) — **unauthenticated**
  (the schema is public, contains no secrets), returns the imported document with
  `Content-Type: application/json`. Lets consumers import the API by URL into Postman/Insomnia/Swagger
  UI or run an SDK generator against it.
- **Discoverability:** the `/tenant/api` page's "Using the API" blurb links to `GET /api/v1/openapi.json`.
- **Kept honest:** a unit test (see Testing) asserts the document declares exactly the three implemented
  paths and the `bearerAuth` scheme, so a drift between routes and spec fails CI. (Full request/response
  conformance testing is deferred; the test is a structural guard, not a contract validator.)

## Internals

- `lib/api/` — pure, IO-free, unit-tested helpers:
  - `cursor.ts`: `encodeCursor({t,id})` / `decodeCursor(str)` (round-trips, rejects garbage).
  - `serialize.ts`: view-model → API JSON serializers (snake_case, cents) for receipt list rows,
    receipt detail, and usage.
  - `params.ts`: parse/validate query params (limit clamp, status enum, ISO date parse) → typed filters.
  - `respond.ts`: `apiError(code, message, status)` + `apiJson(data)` helpers for consistent shapes.
- `lib/data.ts`: add `listReceiptsByCursor(filters)` (keyset query; the offset-based `searchReceipts`
  stays for the UI). Add `getApiUsage(organizationId)` returning the machine-keyed, integer-cents
  usage shape documented above (built from the receipt table + `tenantSettings.perPrintPriceCents`
  via the existing `dayKeys`/`monthKeys` bucket helpers). Reuse `getReceiptDetail` for the detail endpoint.
- `lib/actions/api-keys.ts`: `createApiKey(formData)` (owner/admin; returns the raw key once) and
  `revokeApiKey(keyId)` (owner/admin; org-scoped; sets `revokedAt`). Both `recordAudit`
  (`apiKey.created` / `apiKey.revoked` — new `AUDIT` constants).
- `lib/ids.ts`: `generateApiKey`, `hashApiKey` (see Auth).

## Key management UI

- New page `app/(tenant)/tenant/api/page.tsx`, owner/admin only (members: hidden/empty state).
  Add `{ label: "API", href: "/tenant/api", icon: KeyRound }` to `TENANT_NAV` in `lib/nav.ts`.
- Create-key dialog: name input → on success shows the **raw key once** in a copyable field with a
  "you won't be able to see this again" warning. List table: name, `prefix`, last-used, created,
  revoke action (confirm). Mirrors existing dialog/table/`toast`/`router.refresh()` patterns.
- A short "Using the API" blurb on the page (base URL, `Authorization: Bearer` header, link to the
  three endpoints) — plain copy, not generated docs.

## Authorization

- API requests: key must be non-revoked; all data access is filtered by the key's `organizationId`
  (a key can never read another org's receipts; `getReceiptDetail` is called with that org id).
- Key management actions (`createApiKey`/`revokeApiKey`): `requireTenant()` + owner/admin role check,
  and `revokeApiKey` verifies the key belongs to the active org before mutating (mirrors `updateStore`).

## Error handling

- 400 `invalid_cursor` / `invalid_param`; 401 `unauthorized` (missing/bad key); 403 `revoked` or
  `subscription_inactive`; 404 `not_found`; 429 `rate_limited`. Always the `{ error: {code,message} }`
  shape. Presign failures degrade to `image_url: null`, not a 500.

## Testing

- `lib/api/cursor.test.ts`: encode/decode round-trip; rejects malformed/garbage; stable ordering.
- `lib/api/params.test.ts`: limit clamp (default/max), status enum validation, ISO date parsing, bad input.
- `lib/api/serialize.test.ts`: receipt-list / detail / usage serializers produce the documented
  snake_case + integer-cents shapes.
- `lib/ids` (extend existing if present): `generateApiKey` format + `hashApiKey` determinism.
- Auth/route guards verified by inspection (matches the device-auth precedent; the codebase does not
  DB-mock routes).
- `openapi.test.ts`: the `openapi.json` document parses as OpenAPI 3.1, declares exactly the three
  implemented paths (`/receipts`, `/receipts/{id}`, `/usage`) and a `bearerAuth` security scheme
  (structural drift guard between routes and spec).
- Manual: create a key in `/tenant/api`, `curl` all three endpoints against seeded data, confirm
  cursor paging walks the full set, a revoked key returns 403, and `/receipts/{id}` does NOT change
  receipt status.

## Rollout

1. Schema + migration `0011` (`apiKey`), regenerate types, `db:migrate` (gated — live Neon).
2. `lib/ids` key helpers + `lib/api-auth.ts` (+ unit tests for helpers).
3. Pure `lib/api/` helpers (cursor/params/serialize/respond) — TDD.
4. Data layer `listReceiptsByCursor`.
5. Routes: `/api/v1/receipts`, `/api/v1/receipts/[id]`, `/api/v1/usage`.
6. `lib/actions/api-keys.ts` + `AUDIT` constants.
7. `/tenant/api` page + dialog + nav entry.
8. `openapi.json` document + `GET /api/v1/openapi.json` route + structural test; link it from `/tenant/api`.
9. Tests + build; manual `curl` verification against seeded data (incl. importing `openapi.json` into a tool).

No external accounts/keys required — fully account-free (reuses R2/Neon already configured).
Webhooks (Part 2) will reuse this key/auth model and the resource shapes defined here.
