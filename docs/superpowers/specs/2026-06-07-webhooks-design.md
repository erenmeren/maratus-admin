# Outbound Webhooks — design

**Date:** 2026-06-07
**Status:** Approved (brainstorm) → ready for implementation plan
**Area:** Phase 3 — platform openness. **Part 2 of 2** (Part 1 = the read REST API, shipped `57fd60f`).

## Summary

Let tenants subscribe to receipt-lifecycle events by registering HTTPS endpoints; Maratus POSTs
signed JSON events to them. v1 emits `receipt.created` and `receipt.downloaded`. Delivery is
**near-real-time and non-blocking** (fired with Next's `after()` so it never delays the kiosk's
ingest response or the public receipt page), persisted to a delivery log, with a daily cron
**retry sweep** for failures. Reuses the existing key/secret one-time-reveal UX, the Stripe-style
HMAC signing scheme (inverted: we sign), and the `recordAudit` + management-page patterns.

## Motivation

The read API (Part 1) lets tenants pull data; webhooks let their systems react in real time
(loyalty triggers, analytics pipelines, "receipt viewed" notifications) without polling. Receipt
events are the two discrete DB state transitions already in the codebase, so emission is cheap.

## Non-goals (v1)

- **No device or billing events** — device status is derived from `lastSeenAt` (no discrete
  transition), and billing events already flow via Stripe. Only `receipt.created` / `receipt.downloaded`.
- **No signing-secret rotation UI** — to change a secret, delete the endpoint and recreate it.
- **No arbitrary historical event replay** — only automatic retries of failed deliveries.
- **No payload filtering beyond event type.**
- **No durable external queue** — delivery is inline `after()` + a daily retry sweep (see Delivery).

## Decisions (resolved during brainstorming)

| Decision | Choice |
|---|---|
| Delivery mechanism | **Inline via `after()`** (non-blocking, near-real-time) + **daily cron retry sweep** |
| Events (v1) | `receipt.created`, `receipt.downloaded` |
| Signing | Stripe-style HMAC-SHA256: `X-Maratus-Signature: t=<unix>,v1=<hex>` over `"t.payload"` |
| Secret storage | `whsec_<nanoid>` stored (needed to sign), shown **once** at creation (delete+recreate to roll) |
| SSRF protection | **Required** — https-only + block private/loopback/link-local ranges, checked at create AND pre-delivery |
| Auto-disable | After **15** consecutive failures |
| Test-event button | **In v1** (eases setup/troubleshooting) |

## Data model (migration `0012`)

```ts
export const webhookEndpoint = pgTable("webhook_endpoint", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),                         // whsec_… used to sign; shown once in UI
  events: text("events").array().notNull(),                 // subscribed types, e.g. {receipt.created}
  enabled: boolean("enabled").notNull().default(true),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  disabledReason: text("disabled_reason"),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
  lastDeliveryAt: timestamp("last_delivery_at"),
}, (t) => [index("webhook_endpoint_org_idx").on(t.organizationId)]);

export const webhookDelivery = pgTable("webhook_delivery", {
  id: text("id").primaryKey(),
  endpointId: text("endpoint_id").notNull().references(() => webhookEndpoint.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull(),                      // evt_… (idempotency key for subscribers)
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status", { enum: ["pending", "success", "failed"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  responseStatus: integer("response_status"),
  nextRetryAt: timestamp("next_retry_at"),                  // set when failed + retryable
  lastAttemptAt: timestamp("last_attempt_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
}, (t) => [
  index("webhook_delivery_endpoint_idx").on(t.endpointId),
  index("webhook_delivery_retry_idx").on(t.status, t.nextRetryAt),
]);
```
Add both to the `schema` export map. (`boolean`, `jsonb`, `integer`, `.array()` are Drizzle pg-core imports — add any missing to `schema.ts`.)

## Pure modules (`lib/webhooks/`, IO-free, unit-tested)

- `events.ts`: `buildEvent(type, receipt) → { id: "evt_"+nanoid, type, created: ISO, data }` where
  `data` is the API's snake_case receipt shape (reuse `serializeReceiptRow`). Defines the
  `WEBHOOK_EVENT_TYPES = ["receipt.created","receipt.downloaded"]` constant + a validator.
- `sign.ts`: `signPayload(payload: string, secret: string, timestampSec: number) → "t=<ts>,v1=<hmac>"`
  (HMAC-SHA256 hex of `"${ts}.${payload}"`). `generateWebhookSecret()` (`whsec_<nanoid>`) in `lib/ids.ts`.
- `url-guard.ts`: `isAllowedWebhookUrl(url: string): { ok: true } | { ok: false; reason: string }` —
  require `https:`; reject hostnames that are `localhost`, IP literals in private/loopback/
  link-local ranges (127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, `::1`, fc00::/7),
  and `.local`. (Pure string/IP checks; DNS-resolution SSRF is mitigated by re-checking at
  delivery time and is acceptable for v1.)
- `retry.ts`: `nextBackoff(attempts: number): number | null` — ms until next retry (e.g. 1m, 5m,
  30m, 2h, 6h…), `null` once the max-attempts cap is hit.

## Delivery (`lib/webhooks/deliver.ts`, IO)

`deliverEvent(organizationId, type, receiptData)`:
1. Select **enabled** endpoints for the org whose `events` array contains `type`.
2. For each: build the event (shared `eventId` per endpoint), insert a `webhook_delivery` (pending),
   then `attemptDelivery(deliveryRow, endpoint)`.

`attemptDelivery(delivery, endpoint)`:
- Re-check `isAllowedWebhookUrl(endpoint.url)` (DNS may have changed) → if blocked, mark failed,
  no retry.
- `fetch(url, { method: POST, headers: {content-type, X-Maratus-Event-Id, X-Maratus-Event-Type,
  X-Maratus-Signature}, body, signal: AbortSignal.timeout(5000) })`.
- 2xx → `status=success`, bump `attempts`, set `responseStatus`, **reset** `endpoint.consecutiveFailures=0`,
  stamp `lastDeliveryAt`.
- non-2xx / network / timeout → `status=failed`, bump `attempts`, set `nextRetryAt = now + nextBackoff(attempts)`
  (or null if capped), increment `endpoint.consecutiveFailures`; if it reaches **15** →
  `enabled=false, disabledReason="too_many_failures"` + `recordAudit(webhookEndpointDisabled)`.

**Emission sites (non-blocking via `after` from `next/server`):**
- `receipt.created`: in `POST /api/ingest`, after the receipt-row insert — `after(() => deliverEvent(device.organizationId, "receipt.created", receiptData))`. Must not affect the `{token,url}` response or its latency; wrap so a webhook error never surfaces to the device.
- `receipt.downloaded`: in `lib/receipts.ts` `getReceiptByToken`, **inside** the `if (r.status === "ready")` flip block (fires exactly once, on transition) — `after(() => deliverEvent(r.organizationId, "receipt.downloaded", receiptData))`.

**Retry sweep:** `GET /api/cron/webhooks` (Bearer `CRON_SECRET`, 503 unconfigured / 401 mismatch — mirror `/api/cron/health`). Selects `status='failed' AND nextRetryAt <= now AND attempts < cap`, re-runs `attemptDelivery`. Added to `vercel.json` crons. **Caveat:** Vercel **Hobby** runs crons **daily** and limits the number of cron jobs — retries are daily (hourly on Pro), and if Hobby rejects a 2nd cron at deploy, fold the sweep into the existing `/api/cron/health` route (call both). First-attempt delivery is unaffected (it's inline).

## Signing & idempotency

- Headers: `X-Maratus-Event-Id: evt_…`, `X-Maratus-Event-Type: receipt.created`,
  `X-Maratus-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.<raw-json-body>">`.
- Delivery is **at-least-once**; subscribers dedupe on `X-Maratus-Event-Id`. Payload `{ id, type,
  created, data }`. A short "verifying signatures" note + the scheme is documented on `/tenant/webhooks`.

## Management UI — `/tenant/webhooks` (owner/admin)

- Nav entry `{ label: "Webhooks", href: "/tenant/webhooks", icon: Webhook }` in `TENANT_NAV`.
- **Add-endpoint dialog**: URL input (validated client-side + server-side via `isAllowedWebhookUrl`),
  event-type checkboxes → on success shows the signing **secret once** (copyable, "won't see again").
- **Endpoint list**: url, subscribed events, status (enabled / disabled+reason), last delivery.
  Per-row actions: **Send test event**, disable/enable, delete.
- **Send test event**: server action posts a synthetic `receipt.created` (sample data, a distinct
  `evt_test_…` id) to that endpoint immediately and surfaces the response status — for setup/debug.
- **Recent deliveries**: per-endpoint table of the last ~20 `webhook_delivery` rows (type, status,
  response code, attempts, time). Read-only.

## Server actions (`lib/actions/webhooks.ts`)

`createWebhookEndpoint` (validate URL + events; generate secret; insert; audit `webhookEndpointCreated`;
return secret once), `deleteWebhookEndpoint`, `setWebhookEndpointEnabled` (re-enable resets
`consecutiveFailures`), `sendTestEvent`. All `requireTenant` + owner/admin + org-scoped (mirror the
API-key/store actions). New `AUDIT` constants: `webhookEndpointCreated`, `webhookEndpointDeleted`,
`webhookEndpointDisabled`. Data fns in `lib/data.ts`: `getWebhookEndpoints(orgId)` (no secret in the
list — secret only returned at creation), `getWebhookDeliveries(endpointId, orgId, limit)`.

## Authorization & security

- Management actions: owner/admin, org-scoped (existence check before mutate, like `updateStore`).
- The signing secret is returned only from `createWebhookEndpoint` (and shown once); `getWebhookEndpoints`
  never selects it. The cron sweep route is `CRON_SECRET`-gated.
- SSRF guard enforced at create and pre-delivery; https-only; 5s delivery timeout caps slow-loris.

## Error handling

- A webhook failure must NEVER affect ingest or the public receipt page (emission is `after()` and
  fully wrapped; `deliverEvent` swallows/logs its own errors). Endpoint with no subscribers → no-op.
- Invalid URL/events at create → `{ok:false, error}`. Disabled endpoints are skipped by `deliverEvent`.

## Testing

- `lib/webhooks/sign.test.ts`: HMAC determinism + known-vector; `generateWebhookSecret` format.
- `lib/webhooks/url-guard.test.ts`: accepts public https; rejects http, localhost, each private/
  loopback/link-local range, IPv6 loopback.
- `lib/webhooks/events.test.ts`: `buildEvent` shape (id prefix, type, snake_case data); type validator.
- `lib/webhooks/retry.test.ts`: backoff schedule + null past the cap.
- Action guards by inspection (codebase doesn't DB-mock actions). Manual: register an endpoint
  (e.g. webhook.site), issue a receipt → observe a signed `receipt.created`; view `/r/<token>` →
  `receipt.downloaded`; verify the HMAC; "send test event" returns the response code; point an
  endpoint at a private IP → rejected; force failures → auto-disable at 15; cron sweep retries.

## Rollout

1. Schema + migration `0012` (gated `db:migrate`) + types.
2. Pure modules: `lib/ids` secret, `sign`, `url-guard`, `events`, `retry` (+ tests, TDD).
3. `deliver.ts` (delivery + retry + auto-disable).
4. Emission hooks in `/api/ingest` and `lib/receipts.ts` via `after()`.
5. Cron sweep route + `vercel.json` (verify Hobby cron count at deploy).
6. Actions + audit constants + data fns.
7. `/tenant/webhooks` UI (list, add dialog, deliveries, test/disable/delete) + nav.
8. Tests + build; manual end-to-end against a real receiver.

Account-free: reuses R2 / Neon / `CRON_SECRET` already configured. Delivery needs only outbound
HTTPS, which Vercel functions have — no new third-party account or key.
