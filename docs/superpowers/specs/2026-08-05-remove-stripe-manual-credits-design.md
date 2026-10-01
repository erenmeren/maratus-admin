# Remove Stripe — Manual Invoicing & Admin-Managed Credits

**Date:** 2026-08-05
**Status:** Approved

## Context & Goal

Stripe never went live (keys are `sk_test`; no live smoke was ever run). The
operator has decided to invoice customers **outside the system** and manage
credits by hand from the super-admin panel. Stripe therefore comes out of the
codebase entirely.

Decisions made with the operator:

1. **Billing plans stay** (`credits` / `flat` / `base_usage`). The system keeps
   metering triggers (`deviceCommand.billing`: `included` vs `credits`) exactly
   as today; only the Stripe device-quantity sync and payment flows are removed.
   Flat/base customers get invoiced manually using whatever the operator reads
   off the admin panel.
2. **Tenant billing page loses the buy flow.** Tenants see balance + ledger
   history + a short "contact us to add credits" note. No request/approval
   workflow (YAGNI).
3. **Admin credit management gains deduction.** The existing per-tenant grant
   form (already live on `/admin/customers/[tenantId]`) grows an add/deduct
   direction so over-grants and unpaid invoices can be corrected without
   touching the DB by hand.

## 1. Stripe code removal

Delete outright:

- `lib/stripe.ts` (client singleton)
- `lib/billing/stripe-billing.ts` (credit-pack checkout)
- `lib/billing/device-subscription.ts` (per-device quantity sync)
- `app/api/stripe/webhook/route.ts`
- `components/billing/buy-credits-form.tsx`
- `app/(tenant)/tenant/billing/actions.ts` checkout action (file goes if
  nothing else remains)

Call-site cleanup — remove the `syncDeviceSubscription` best-effort blocks
(try/catch + console.error) in:

- `lib/device-claim.ts` (2 sites)
- `app/api/device/claim/route.ts` (auto-claim)
- `lib/actions/devices.ts` (device delete)
- `lib/actions/offboarding.ts` (offboard + restore)
- `lib/actions/billing-plan.ts` (plan change)
- `app/api/cron/health/route.ts` (`syncAllDeviceSubscriptions`)

Plan-change, claim, offboard etc. keep all their non-Stripe behavior.

Other surfaces:

- `lib/integration-status.ts`: drop `stripeMode` + its type; update
  `lib/integration-status.test.ts`. `components/admin/integration-health-card.tsx`
  loses the Stripe row (Resend row stays).
- `lib/env.ts` + `.env.example`: remove all six `STRIPE_*` /
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` vars.
- `package.json`: remove `stripe`, `@stripe/stripe-js`,
  `@stripe/react-stripe-js`.
- `lib/audit.ts`: the `{ type: "stripe" }` actor variant **stays** — historical
  audit rows reference it; no new writers remain.
- `creditLedger.kind` keeps `"purchase"` for historical rows; nothing writes it
  anymore.

## 2. Schema

One migration dropping three dead columns from `tenant_settings`:

- `stripe_customer_id`
- `stripe_subscription_id`
- `stripe_subscription_item_id`

Per the known drizzle snapshot-drift hazard, strip the generated SQL down to
just these three `ALTER TABLE ... DROP COLUMN` statements before committing.

`billingPlan`, quota fields, and all metering logic are untouched.

`creditLedger.kind` gains `"adjust"` in the Drizzle text-enum. Drizzle text
enums emit no DB constraint, so this is code-only — no migration.

## 3. Credit deduction

New primitive in `lib/credits.ts`:

```ts
deductCredits({ organizationId, credits, note?, createdByUserId? })
```

- Writes a `creditLedger` row with `kind: "adjust"` and **negative** `credits`.
- Decrements `creditBalance.available` under an atomic guard
  (`WHERE available >= n`, matching the CAS style of the existing primitives).
  `held` is never touched. Insufficient balance → typed failure, no ledger row.
- Non-idempotent, like admin grants.

Admin UI: `GrantCreditsForm` becomes an add/deduct form (direction toggle +
amount + optional note). Server action validates like `grantCreditsAction`
(integer 1..1,000,000, archived-org guard) and records a new audit action
`creditsDeducted` with `{ credits, note }`.

Ledger rendering: wherever ledger kinds are labeled for the UI (tenant billing
history, admin views), `"adjust"` renders as "Adjustment".

## 4. Tenant billing page

`/tenant/billing` keeps the balance card and ledger history. The buy-credits
section is removed and replaced with a short muted note: credits are managed by
Maratus — contact us to top up (English UI copy, final wording at implementation).

## 5. Docs & ops follow-ups

- Turkish tenant manual + super-admin manual: replace buy-credits/Stripe
  passages with the manual-allocation story (admin grants/deducts; tenant
  contacts operator).
- README / CLAUDE.md: no Stripe references should survive (CLAUDE.md env table
  already has none).
- **Operator task (not code):** delete the `STRIPE_*` env vars from Vercel and
  `.env.local` after deploy.

## Testing

- `deductCredits` is DB-bound like every other primitive in `lib/credits.ts`
  (none have unit tests; there is no DB-mock infrastructure). The tested
  surface is the pure side: `rollupCredits` gets a unit test for `"adjust"`
  rows netting against granted totals.
- `integration-status` tests updated for Stripe removal.
- Full suite + `tsc` + `next build` stay green.

## Out of scope

- Removing billing plans or metering (kept deliberately).
- Credit request/approval workflow for tenants.
- Any invoicing feature inside the app.
