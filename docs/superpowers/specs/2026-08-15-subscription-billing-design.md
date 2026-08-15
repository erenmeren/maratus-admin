# Subscription Billing — Annual Bank Transfer, Pooled Quota, Post-Paid Overage

**Date:** 2026-08-15
**Status:** Approved

## Context & Goal

Stripe came out on 2026-08-05 and credits became the sole payment path, granted
by hand from the admin panel. The operator now wants a real subscription:
customers pay **$15 per device per month, billed annually in advance by bank
transfer**, get a **pooled monthly trigger quota**, and are **invoiced after the
fact** for anything above it.

Turkey has no working PayPal, and the operator chose not to integrate iyzico —
money arrives in the company bank account and a platform admin marks the invoice
paid. There is no payment-provider integration in this design. (An iyzico
adapter can be bolted onto the "mark paid" seam later; it is out of scope.)

Decisions made with the operator:

1. **$15 per device per month**, charged annually in advance
   (`active devices × 15 × 12`).
2. **Bank transfer / EFT only.** Admin marks payment received; that action is
   what activates a subscription or a device.
3. **Anniversary-based periods.** A customer who subscribes on 12 March has
   quota periods 12 Mar–11 Apr, 12 Apr–11 May, … Not calendar months.
4. **1000 triggers included per device per month, pooled at the org.** Two
   devices = 2000 pooled; a single device may consume all of it. This is the
   central change from today's per-device quota.
5. **Overage is $0.02 per trigger**, post-paid. Never blocks a request.
6. **Mid-year device additions are pro-rated.** Remaining months × $15,
   invoiced immediately, device activates on payment, ends on the same
   anniversary as the rest.
7. **Unpaid devices do not count toward quota.** Quota derives from paid
   devices, never from claimed devices — otherwise a customer inflates quota by
   claiming hardware without paying.
8. **Overage is invoiced at each period close, net 14.** Overdue is surfaced in
   the admin panel; there is no automatic cut-off.
9. **Prices are stored in USD cents.** The TRY amount and FX rate are frozen on
   the invoice when payment is marked.
10. **Collapse to a single plan.** `credits` / `flat` / `base_usage` all go away.
11. **50 free triggers per unpaid device** as a trial, so a customer can verify
    their installation before paying.

### Pricing note (deliberate, recorded)

The implied unit price of included quota is $15 ÷ 1000 = **1.5¢**, so overage at
2¢ is *more expensive* than buying another device's quota. This nudges heavy
users toward adding devices. The operator initially preferred 1¢ (explicitly not
wanting to push device sales) and then chose 2¢ with that trade-off stated. Both
prices are far above marginal cost (~0.1¢/trigger), so margin is not the
constraint here; incentive shape is.

## 1. Data model

### `tenantSettings`

| Action | Column |
|---|---|
| Drop | `billingPlan` |
| Add | `subscriptionStartedAt` — `timestamp`, null = not subscribed |
| Add | `subscriptionRenewsAt` — `timestamp`, null until first activation |
| Add | `pricePerDeviceCents` — `integer`, default `1500` |
| Add | `overagePriceCents` — `integer`, default `2` |
| Add | `legacyCreditsRemaining` — `integer`, default `0` (migration only, see §5) |
| Change | `includedTriggersPerDevice` default `2000` → `1000` |

`pricePerDeviceCents` and `overagePriceCents` are per-tenant so a negotiated
discount does not require a code change.

### `device`

| Action | Column |
|---|---|
| Add | `subscriptionPaidAt` — `timestamp`, null = unpaid |

This single column is the source of truth for both the trigger gate and the
quota calculation. Pooled quota = `count(paid, non-archived devices) × 1000`.

### New `invoice` table

```
id                text primary key
organizationId    text not null → organization.id (cascade)
kind              text enum ["subscription", "proration", "overage"] not null
periodStart       timestamp not null
periodEnd         timestamp not null
deviceCount       integer            -- subscription / proration
deviceId          text → device.id   -- proration only (which device it activates)
triggersUsed      integer            -- overage only
triggersIncluded  integer            -- overage only
overageTriggers   integer            -- overage only, after legacy-credit offset
amountUsdCents    integer not null
tryAmountKurus    integer            -- frozen when marked paid
fxRate            integer            -- kuruş per USD, frozen when marked paid
status            text enum ["open", "paid", "void"] not null default "open"
issuedAt          timestamp not null
dueAt             timestamp not null
paidAt            timestamp
markedPaidByUserId text
note              text
createdAt         timestamp not null
```

Indexes:

- `unique (organizationId, kind, periodStart)` — the idempotency guarantee for
  the cron. A second run of the same period conflicts and is a no-op.
- `(organizationId, issuedAt)` — invoice list.
- `(status, dueAt)` — overdue sweep.

**Overdue is not a status.** It is derived: `status = "open" AND dueAt < now`.
Keeping the state machine at three values avoids a background job whose only
purpose is flipping a flag.

### Dropped tables

`creditBalance`, `creditLedger`, `deviceUsageMonth`.

### No usage counter table

The current design bumps a per-device monthly counter on every trigger because
the quota had to be enforced synchronously (reject the 1001st request). With
post-paid overage **the quota rejects nothing**; it is a display value and an
invoice input. Both read fine from `device_command`:

```sql
count(*) from device_command
where organization_id = ? and type = 'trigger' and status = 'acked'
  and created_at >= ? and created_at < ?
```

`device_command_org_type_status_created_idx` covers this exactly. So
`deviceUsageMonth` is dropped and nothing replaces it — the trigger path loses
2–3 writes per request and the entire compensating-unbump logic disappears.

Two deliberate choices in that query:

- **`acked`, not attempted.** A trigger that never reached the screen is not
  billed. This also matches how the dashboards already count activations.
- **`createdAt`, not `ackedAt`.** The index is on `createdAt`; the two differ by
  seconds, so at most a negligible number of commands land in the adjacent
  period.

## 2. Billing period arithmetic — `lib/billing-period.ts`

Pure, no DB, fully unit-tested. Everything UTC.

- `periodStartFor(subscriptionStartedAt, now)` → start of the current period
- `periodEndFor(start)` → next start (exclusive upper bound)
- `renewalDueAt(subscriptionStartedAt)` → start + 12 months

**Month-end anchoring is the subtle part.** A subscription starting 31 January
clamps to 28/29 February, then returns to 31 March. The anchor is the original
day-of-month, never the clamped value — otherwise every February permanently
walks the billing date backwards.

## 3. Trigger path — `lib/subscription-gate.ts`

Replaces `lib/trigger-billing.ts` (and with it `lib/billing-plan.ts`,
`lib/device-usage.ts`).

```
1. device.subscriptionPaidAt is not null  → allow
2. else count acked triggers for this device (all time)
     < 50   → allow (trial)
     >= 50  → 403 device_not_subscribed
```

The trial count runs only on the unpaid branch, so a paying customer's request
does zero extra queries. `device_command_device_status_idx` covers it. No reset
is needed on payment — the branch is skipped once `subscriptionPaidAt` is set.

Existing archived-org and paused-org guards are unchanged and run first.

**Fair-use valve — enforced by the cron, not the hot path.** The `flat` plan's
300K/device/month ceiling carries over as an abuse guard, but it cannot live in
the request path: without a counter table, checking it would mean a `COUNT` on
every trigger. Instead the daily billing cron sweeps for devices past the
ceiling and raises an `alert`; the operator suspends the device from the admin
panel. A runaway integration is caught within a day, which is what an abuse
valve needs — nothing about it is latency-sensitive.

Removed from the hot path: `bumpDeviceUsage` / `unbumpDeviceUsage`,
`reserveCredit` / `releaseHold` / `settleHold`, `triggerBillingDecision`,
`cancelTriggerReservation`'s credit branch, and the `deviceCommand.billing`
column. `lib/trigger-ack.ts` no longer settles anything; it only records the ack.

## 4. Invoicing — `lib/invoicing.ts` and `/api/cron/billing`

`lib/invoicing.ts` keeps pure amount computation separate from persistence:

- `subscriptionAmount(deviceCount, pricePerDeviceCents)` = `count × price × 12`
- `prorationAmount(pricePerDeviceCents, monthsRemaining)`
- `overageAmount(used, included, overagePriceCents, legacyCredits)` →
  `{ overageTriggers, amountUsdCents, creditsConsumed }`

`/api/cron/billing` takes the slot freed by `/api/cron/credit-holds` (Vercel
Hobby allows two crons), daily at 09:00 UTC. Three jobs:

1. **Period close** — for each org whose period ended, count acked triggers,
   compute overage, and issue an `overage` invoice (net 14) if it is non-zero.
2. **Renewal** — for each org within 30 days of `subscriptionRenewsAt`, issue the
   next `subscription` invoice, giving the customer time to transfer.
3. **Overdue** — write an `alert` row for each open, past-due invoice.

### Email is inert today

Resend has no verified domain, so mail reaches only the account owner — a
customer-facing invoice email would silently fail to deliver. The invoice list in
the tenant panel is therefore the real delivery channel, and the operator
notifies customers out of band. Verifying the Resend domain is tracked as
separate work, not a dependency of this design.

## 5. Migration

Prod has live data and live devices, so this ships in two migrations with a
backfill and a deploy between them — the same pattern used for 0041.

**0042 (additive):** `invoice` table, `device.subscriptionPaidAt`, the new
`tenantSettings` columns. Nothing is dropped; existing code keeps working.

**Backfill (the dangerous step).** A device with a null `subscriptionPaidAt`
returns 403. If the backfill is skipped, the entire fleet goes silent the moment
the new code deploys. Policy:

- Every non-archived org: `subscriptionStartedAt` = migration date,
  `subscriptionRenewsAt` = migration date + 12 months.
- Every claimed, non-archived device: `subscriptionPaidAt` = migration date.
- Every org: `legacyCreditsRemaining` = its `creditBalance.available`.

Everyone starts as paid; the operator corrects real dates from the admin panel
afterwards. Failing safe in that direction is the whole point.

**Deploy:** new gate, cron, and UI.

**0043 (destructive), only after the deploy is verified:** drop
`creditBalance`, `creditLedger`, `deviceUsageMonth`, `tenantSettings.billingPlan`,
`deviceCommand.billing`.

### Legacy credits

Existing credit balances move to `tenantSettings.legacyCreditsRemaining` and are
offset against **the first overage invoice only**: `billable = max(0, overage −
legacyCreditsRemaining)`, and `legacyCreditsRemaining` is then set to zero
regardless of how much was consumed. This matches the operator's instruction to
count existing credits toward the final period. (The alternative — carrying the
balance until exhausted — was raised and not chosen.)

## 6. Code inventory

**Deleted:** `lib/credits.ts`, `lib/credit-holds.ts`, `lib/credits-overview.ts`,
`lib/billing-plan.ts`, `lib/trigger-billing.ts`, `lib/device-usage.ts`,
`app/api/cron/credit-holds/`, the admin credit add/deduct form, and the
corresponding tests (`credits.starter.test.ts`, `credits-overview.test.ts`,
`billing-plan.test.ts`, `device-commands` credit assertions).

**Retargeted:** `lib/credit-usage.ts` — the per-device usage rollup currently
reads `creditLedger.settle` rows; it must read `device_command` (`type='trigger'`,
`status='acked'`) instead, since the ledger is going away.

**Added:** `lib/billing-period.ts`, `lib/subscription-gate.ts`,
`lib/invoicing.ts`, `lib/bank-details.ts`, `app/api/cron/billing/route.ts`.

## 7. Interfaces

### Admin — `/admin/customers/[tenantId]`

A **Subscription** card: status, start date, renewal date, paid device count,
annual amount. Actions:

- **Start subscription** — issues a `subscription` invoice.
- **Invoice list** — kind, period, amount, status, due date, overdue badge.
- **Mark paid** — dialog capturing the TRY amount and FX rate, which are frozen
  onto the invoice. Side effects by kind:
  - `subscription` — on first activation, sets `subscriptionStartedAt` = paid
    date and `subscriptionRenewsAt` = +12 months; on renewal, advances
    `subscriptionRenewsAt` by 12 months and leaves the start date alone. Then
    marks exactly `invoice.deviceCount` devices paid, choosing the **oldest
    unpaid claimed devices first**. Devices claimed after the invoice was issued
    stay unpaid and get their own proration invoice — otherwise a customer could
    claim extra hardware between issue and payment and ride in for free.
  - `proration` — sets `subscriptionPaidAt` on `invoice.deviceId`.
  - `overage` — settles only itself.

Claiming a device on an active subscription auto-issues a `proration` invoice.

### Tenant — `/tenant/billing`

Replaces the post-Stripe "contact us" note with: subscription status, current
period usage (`1,240 / 2,000`), running overage estimate (`240 × 2¢ = $4.80`),
invoice list, and bank transfer details. Transfer details are platform-wide
constants in `lib/bank-details.ts` — they do not vary per tenant, so they do not
belong in the database.

Tenants have no write actions here; marking payment is platform-admin only.
Viewing follows existing tenant read permissions.

## 8. Testing

Weight sits on the pure functions, which is where the risk is.

- **`billing-period`** — month-end anchoring (31 Jan → 28 Feb → 31 Mar), leap
  years, period boundary inclusivity, UTC correctness.
- **`invoicing`** — proration (device added in month 5 → 7 × $15), overage
  amount, legacy-credit offset, zero-overage produces no invoice.
- **`subscription-gate`** — paid device passes; unpaid passes below 50; unpaid
  rejects at 50; archived org rejects first.
- **Cron idempotency** — two runs over the same period produce one invoice.

## Open items (not blocking)

- Resend domain verification, without which no invoice email reaches customers.
- iyzico adapter on the "mark paid" seam, if manual transfers become a burden.
- Invoice PDF / e-arşiv integration — out of scope; the operator issues legal
  invoices outside the system.
- VAT (KDV) handling. Amounts here are exclusive of tax; the operator adds it on
  the legal invoice. If VAT must appear in-system, it is a follow-up.
