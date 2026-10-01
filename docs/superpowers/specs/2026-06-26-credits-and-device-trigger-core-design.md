# Credits + Device-Trigger Core (Spec A) — Design

**Date:** 2026-06-26
**Repo:** `maratus-admin` (cloud only — firmware is Spec B)
**Status:** Approved architecture, design pre-implementation
**Part of:** "Public device-trigger API" feature. This is **Spec A**, with one firmware follow-up:
- **A (this doc):** credits balance + ledger + reserve/settle/release, API-key scopes, the trigger endpoint, device-command payload + ack + TTL cron, admin grant, **self-serve Stripe credit-pack purchase**, and analytics. Cloud-only; testable with a simulated device ack.
- **B (follow-up):** firmware executes `show_qr` (renders a QR of the URL) and acks the command. Separate repo + HIL.

**Stripe is already integrated** (corrected 2026-06-26): the webhook handler `app/api/stripe/webhook/route.ts` (signature-verified via `STRIPE_WEBHOOK_SECRET`) and Checkout (`activateBilling` in `lib/billing/stripe-billing.ts`, `ui_mode:"elements"`) exist and are extensible. Credit purchase therefore folds into Spec A (it was previously split out only on the now-corrected assumption that the webhook was unwired). Live use still needs the prod Stripe webhook endpoint + credit-pack price IDs configured (ops, not code).

## Problem

A tenant's external systems should be able to **trigger one of that tenant's devices** by calling a public endpoint (e.g. show a QR of a given URL on the device screen). Each trigger must **deduct credits** and be **recorded for per-company and per-device billing/reporting**. Triggering spends money and controls hardware, so it needs a tighter security envelope than the existing read-only public API.

## Decisions (locked via brainstorming)

1. **Generic action+payload envelope.** Body: `{ action, payload }`. First action: `show_qr` with `payload:{ url }`. Extensible to future actions.
2. **Prepaid credit balance + append-only ledger.** The ledger is the source of truth AND the analytics source (per-company / per-device / per-time).
3. **Reserve → settle → release.** At request time: reject offline/unknown device (no charge), reject insufficient balance (no charge), else HOLD 1 credit and return `202`. Device ack settles the hold to a debit; TTL expiry releases (refunds) the hold.
4. **Scoped API keys.** Triggering requires a key with the `devices:trigger` scope. Existing keys are backfilled with read scopes only — never auto-granted `devices:trigger`.
5. **Both top-up paths in Spec A:** admin grant AND self-serve Stripe credit-pack purchase (Stripe is already wired — see header).

## Defaults (set here; adjustable)

- **Cost:** `CREDITS_PER_TRIGGER = 1`. Cost is resolved per-action (a small registry) so future actions can cost differently; `show_qr` = 1.
- **Command TTL:** 60s. Devices poll every ~12s, so 60s comfortably covers poll + execute + ack before a hold is released.
- **Idempotency:** the trigger POST **requires** an `Idempotency-Key` header. A replay with the same (org, key) returns the original response and does NOT reserve again.
- **Device eligibility:** trigger is accepted only when the device is `online` (not `offline`/`paused`) per `effectiveDeviceStatus` → else `409`, no charge.
- **No receipt row.** A trigger is its own concept (a `deviceCommand` + ledger rows); it does not create a `receipt`.

## Architecture

### Data model (new — one Drizzle migration)

**`credit_balance`** (one row per org; the fast, transactionally-maintained cache):
- `organizationId` (PK, FK → organization)
- `available` integer not null default 0
- `held` integer not null default 0
- `updatedAt`

**`credit_ledger`** (append-only; source of truth + analytics):
- `id` (text PK, `id("cl")`)
- `organizationId` (FK, indexed)
- `deviceId` (text FK, nullable — null for grants/purchases)
- `kind` enum: `grant | purchase | hold | settle | release`
- `credits` integer (signed: grant/purchase/release > 0 to available; hold moves available→held; settle finalizes; see semantics below)
- `action` text nullable (e.g. `show_qr`)
- `commandId` text nullable (FK → deviceCommand, for hold/settle/release)
- `idempotencyKey` text nullable
- `balanceAfterAvailable` integer (snapshot for audit)
- `note` text nullable (e.g. grant reason)
- `createdByUserId` text nullable (for grants)
- `createdAt` (indexed; analytics keyset)
- Indexes: `(organizationId, createdAt)`, `(deviceId, createdAt)`, `(commandId)`, and a **unique** `(kind, idempotencyKey)` (partial, where `idempotencyKey is not null`) so a replayed Stripe purchase webhook can't double-grant.

**`apiKey.scopes`** text[] not null default `{}`. Known scopes (a const union): `receipts:read`, `usage:read`, `devices:trigger`. **Migration backfills all existing keys** to `["receipts:read","usage:read"]` (their implicit current ability) — never `devices:trigger`.

**`deviceCommand`** gains: `action` text nullable, `payload` jsonb nullable, `expiresAt` timestamp nullable. Add `"trigger"` to `COMMAND_TYPES`.

**`apiIdempotency`** (replay store):
- `key` text + `organizationId` → composite PK
- `responseStatus` integer, `responseBody` jsonb, `commandId` text nullable, `createdAt`
- Retention: rows older than 24h are eligible for cleanup (folded into the holds cron).

### Credit primitives (`lib/credits.ts` — pure-ish data layer, single-statement atomic guards)

All guards are **single SQL statements** (Neon `neon-http` has no interactive transactions). Each guard returns the new state or "no row" (failure), and the caller then appends the matching ledger row.

- `reserveCredit(orgId, deviceId, action, commandId, idemKey, cost) → { ok, balanceAfter } | { ok:false, reason:"insufficient" }`
  - `UPDATE credit_balance SET available = available - $cost, held = held + $cost, updatedAt = now() WHERE organizationId = $org AND available >= $cost RETURNING available` → if no row, insufficient. On success, insert a `hold` ledger row.
- `settleHold(orgId, commandId, cost)` — `UPDATE credit_balance SET held = held - $cost WHERE organizationId=$org AND held >= $cost RETURNING held`; insert `settle` ledger row. (The credit is now truly spent: available already decremented at reserve; settle just clears the hold bucket.)
- `releaseHold(orgId, commandId, cost)` — `UPDATE credit_balance SET available = available + $cost, held = held - $cost WHERE organizationId=$org AND held >= $cost RETURNING available`; insert `release` ledger row.
- `grantCredits(orgId, credits, { kind:"grant"|"purchase", note?, byUserId?, idempotencyKey? })` — for `purchase`, FIRST `INSERT INTO credit_ledger ... ON CONFLICT (kind, idempotencyKey) DO NOTHING RETURNING id`; only if a row was written do the balance upsert (`INSERT ... ON CONFLICT (organizationId) DO UPDATE SET available = credit_balance.available + $credits`). For `grant` (no idempotencyKey), upsert balance then insert the ledger row. (Creates the balance row if absent.) This ordering makes a replayed Stripe webhook a no-op.
- `getBalance(orgId) → { available, held }`.

Idempotency for settle/release: a `settle`/`release` is only applied if the command hasn't already been settled/released (guard on `deviceCommand.status` transition + the `held >= cost` check), so a double-ack or a race between ack and the TTL cron cannot double-move credits. The command status transition (`delivered → acked` / `delivered → expired`) is the lock: whichever single-statement `UPDATE deviceCommand SET status=... WHERE id=? AND status='delivered' RETURNING id` wins performs the credit move; the loser gets no row and does nothing.

### Trigger endpoint — `POST /api/v1/devices/[deviceId]/trigger`

1. `guardApiRequest(req)` (existing: auth key → org, rate-limit 120/min, subscription not suspended).
2. **Scope check:** key must include `devices:trigger` → else `403 { error:"insufficient_scope" }`.
3. **Idempotency:** require `Idempotency-Key` header (→ `400` if missing). If `(org,key)` already in `apiIdempotency`, return the stored response verbatim.
4. **Parse + validate body:** `action` ∈ known actions; `show_qr` requires `payload.url` to be a string, `https?://`, length ≤ 2048. Invalid → `422`.
5. **Device lookup + ownership:** load device by `deviceId`; if missing or `device.organizationId !== auth.organizationId` → `404` (do not leak existence).
6. **Eligibility:** `effectiveDeviceStatus(device)` must be `online` → else `409 { error:"device_offline" }`, no charge.
7. **Reserve:** `reserveCredit(...)` with the action's cost → if insufficient, `402 { error:"insufficient_credits" }`, no command.
8. **Enqueue:** insert `deviceCommand{ type:"trigger", action, payload, status:"pending", expiresAt: now+TTL, organizationId, deviceId }`. Link `commandId` into the hold ledger row.
9. Persist the idempotency record and return `202 { id: commandId, status:"queued" }`.

If step 8 fails after step 7 reserved, immediately `releaseHold` (best-effort) and return `500`.

### Device command delivery + ack

- `GET /api/device/commands` (existing) already flips `pending → delivered`; extend its response to include `action` + `payload` for `trigger` commands so the device knows what to render.
- **New `POST /api/device/commands/ack`** (device-key auth): body `{ commandId, ok, result? }`. Transition `delivered → acked` (or `failed`) via the single-statement guarded UPDATE; on the winning transition for a `trigger` command, call `settleHold` (ok) — on `failed`, `releaseHold`. (If an ack endpoint already exists, extend it instead of adding one.)

### Reconciliation cron — `GET /api/cron/credit-holds` (CRON_SECRET)

- Find `trigger` commands with `status ∈ (pending,delivered)` and `expiresAt < now()`; for each, guarded transition to `expired` and `releaseHold`. (One statement per command picks the winner vs. a late ack.)
- Also delete `apiIdempotency` rows older than 24h.

### Admin surface (Spec A — minimal but real)

- **Credit grant:** a platform-admin-only server action `grantCreditsAction(orgId, credits, note)` (gated by `requirePlatformAdmin`) + a small control on the existing admin customer detail page (`app/(admin)/admin/customers/[tenantId]`). Audited via `recordAudit`.
- **Balance + ledger view:** show `available`/`held` and a paginated ledger (kind, credits, device, action, time) on the tenant billing/usage area and/or the admin customer page.
- **API-key scope picker:** at key creation in the existing API-key management UI, choose scopes (checkboxes: `receipts:read`, `usage:read`, `devices:trigger`). Default new keys to `["receipts:read","usage:read"]`.

### Self-serve Stripe credit purchase (in scope — extends existing Stripe code)

- **Credit packs:** a small config of packs `{ id, credits, priceId }`, e.g. `STRIPE_CREDIT_PACK_PRICE_IDS` env (one Stripe one-time Price per pack) → `lib/billing/credit-packs.ts`.
- **Checkout:** `createCreditCheckout(orgId, packId)` in `lib/billing/stripe-billing.ts` — mirrors `activateBilling` but `mode:"payment"` (one-time), `line_items:[{ price: pack.priceId, quantity:1 }]`, `metadata:{ organizationId, packId, credits }`, `return_url → /tenant/billing`. A tenant "Buy credits" control invokes it.
- **Webhook:** add a `case "checkout.session.completed"` to the existing switch in `app/api/stripe/webhook/route.ts`. When `session.mode === "payment"` and `payment_status === "paid"`, read `metadata.organizationId`/`credits` and call `grantCredits(org, credits, "stripe purchase", null)` with `kind:"purchase"`.
- **Idempotency (critical — Stripe retries webhooks):** the `purchase` ledger row carries `idempotencyKey = session.id` under a **unique index** on `(kind, idempotencyKey)`; a replayed event hits the conflict and no-ops (no double-grant). `grantCredits` for purchases uses `INSERT ... ON CONFLICT DO NOTHING` on the ledger and only increments the balance when the ledger insert actually wrote a row.
- Audited via `recordAudit` (actor `stripe`).

### Analytics / reporting (`lib/data.ts`)

Queried entirely from `credit_ledger` (settle rows = realized spend):
- `getCreditUsageByDevice(orgId, range) → { deviceId, name, count, credits }[]` — `GROUP BY deviceId` over `kind='settle'`.
- `getCreditUsageForOrg(orgId, range) → { total, daily[], byAction }` — per-company totals + time series.
- Platform-admin cross-org: `getCreditUsageAllOrgs(range)` for "which company triggered how many".
- Surface via the public API (`GET /api/v1/usage` extended, or a new `GET /api/v1/devices/{id}/usage`) and the admin/tenant UI.

## Error handling

| Condition | Status | Body |
|---|---|---|
| Missing/invalid key, rate-limited, suspended | 401/429/403 | (existing guard) |
| Key lacks `devices:trigger` | 403 | `insufficient_scope` |
| Missing `Idempotency-Key` | 400 | `missing_idempotency_key` |
| Bad action/payload | 422 | `invalid_request` (detail) |
| Device unknown or other org | 404 | `device_not_found` |
| Device offline/paused | 409 | `device_offline` |
| Insufficient credits | 402 | `insufficient_credits` |
| Enqueue failure after reserve | 500 | hold released, `internal_error` |
| Success | 202 | `{ id, status:"queued" }` |

Idempotent replays return the original status+body. Credit moves never double-apply (status-transition guard is the lock).

## Testing

- **Unit (`lib/credits.test.ts`):** reserve gates on `available >= cost`; concurrent reserves can't oversell (simulate by asserting the WHERE-guard semantics); settle/release move the right buckets; double-settle / settle-after-release is a no-op (guard returns no row); grant creates+increments.
- **Idempotency:** two POSTs with the same key reserve once; second returns the stored response.
- **Endpoint integration:** scope enforcement (403), ownership (404), offline (409), insufficient (402), happy path (202 + hold ledger row + queued command). Simulate the device: call the ack endpoint → settle; force `expiresAt` in the past + run the cron → release.
- **Stripe purchase:** `checkout.session.completed` (paid) grants the pack's credits via a `purchase` ledger row; a replayed event with the same `session.id` is a no-op (unique `(kind, idempotencyKey)` conflict → balance unchanged).
- **Analytics:** seed ledger rows → `getCreditUsageByDevice`/`ForOrg` return correct counts/sums.
- **Migration:** existing API keys backfill to read scopes only; `credit_balance`/`credit_ledger`/`apiIdempotency` created; `deviceCommand` columns added.

## Out of scope (Spec A)

- Firmware execution of `show_qr` + the real device ack (Spec B; until then, acks are simulated in tests/QA).
- Per-action pricing UI, credit-expiry, multiple currencies, refunds beyond hold-release.
- Per-device API-key scoping (keys stay org-scoped; scope is by capability, not by device).
