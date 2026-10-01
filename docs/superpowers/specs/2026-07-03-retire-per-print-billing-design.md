# Retire per-print billing — credits as the sole payment path

**Date:** 2026-07-03
**Status:** Draft — awaiting user review
**Context:** Deferred follow-up #2 from the trigger-only teardown (see [[trigger-only-device-teardown]]). Follows the metric repoint ([[metrics-repoint-to-triggers]], deployed 2026-07-03), which already moved dashboards onto trigger activity and left billing as the last document-coupled subsystem.

## Problem

Maratus bills two ways today, but only one is real:

- **Per-print / postpaid (vestigial):** a monthly cron counts `document` rows × `perPrintPriceCents`, generates `invoice` rows, pushes them to Stripe (invoices + a metered subscription + a usage meter), duns overdue accounts, and a `isOrgPaymentBlocked` gate 402/403s a tenant whose invoices are overdue. Since the pivot, **nothing writes `document` rows**, so this whole machine meters $0, generates empty invoices, and the enforcement gate is permanently no-op.
- **Prepaid credits (real):** every device trigger reserves→settles a credit (`creditLedger`); tenants buy credit packs via Stripe Checkout. This is the actual, working payment path and is **inherently self-enforcing** — no credits → the trigger endpoint already returns `402 insufficient_credits`.

This project **removes the entire per-print subsystem** and makes prepaid credits the sole payment path, then **drops the now-dead `document`, `usageEvent`, and `invoice` tables** and per-print columns.

## Decisions (locked)

1. **Delete the payment-enforcement gate.** Remove `isOrgPaymentBlocked` + `lib/billing/enforcement.ts`, the `402 payment_past_due` / `403 subscription_inactive` gate in `lib/api/guard.ts`, and the tenant-layout redirect/banner. "Past due" is a postpaid concept with no meaning under prepaid; credits are the gate.
2. **Grant starter credits on org creation.** New tenants get **50 credits** (`kind='grant'`, idempotent by org id) so onboarding + the first trigger work without buying first. Hook: `lib/actions/register.ts:registerCompany` (after `createOrganization`) and `lib/db/seed.ts`. *(ASSUMPTION — 50 is a flagged default; adjust in review.)*
3. **Repoint `/api/v1/usage` to credits.** No more `document`-based fields. New response reports credit balance (available/held), credits consumed this month, and activation counts. Breaking schema change (API is prototype-stage); update `lib/api/serialize.ts` + `openapi.json`.
4. **Rework the admin Billing page to a lean credits view** — credits sold, credits consumed, outstanding credit liability (Σ balances), per-tenant balance + consumption. Replaces the invoice-based earnings/MRR/outstanding KPIs. *(ASSUMPTION — "rework, lean" chosen over "remove"; adjust in review.)*
5. **Remove synthetic "revenue" tiles.** The `revenue` estimate (`activations × perPrintPriceCents`) across the tenant dashboard, analytics, reports, and admin overview was always a fake estimate; with `perPrintPriceCents` gone it has no basis. Remove `TimePoint.revenue`, `RevenueLineChart`, and the revenue KPIs/columns. Real money lives on the credits/admin-billing view.

## Scope — what is REMOVED

### Per-print engine, cron, Stripe postpaid infra
- Delete: `lib/billing-engine.ts`, `lib/billing/billing-cron.ts`, `lib/billing/invoice-collect.ts`, `lib/billing/invoice-sync.ts`, `lib/billing/invoice-emails.ts`, `lib/billing/dunning.ts`, `lib/billing/usage-metering.ts`, `lib/billing/usage-status.ts`, `lib/billing/enforcement.ts`, and the per-print mappers in `lib/billing/billing-status.ts` (`statusForStripeInvoice`, `meterEventPayload`, `invoiceRowFromStripe`, `isSuspended`).
- `lib/billing/stripe-billing.ts`: remove `activateBilling` (subscription Checkout), `reportDocumentUsage` (meter), `sendInvoiceToStripe` (invoices). **Keep** `ensureStripeCustomer`, `createCreditCheckout`.
- Cron routes: delete `app/api/cron/billing/route.ts` and `app/api/cron/usage/route.ts`. **Keep** `app/api/cron/credit-holds/route.ts`.
- `lib/actions/billing.ts`: remove `generateInvoices`, `advanceInvoice`, `setInvoiceStatus`, `voidInvoice`.
- Delete `scripts/stripe-setup.ts` (provisions the per-print Product/Meter/Price).
- Stripe webhook (`app/api/stripe/webhook/route.ts`): remove `invoice.*`, `customer.subscription.*`, `setup_intent.succeeded`, `payment_method.attached` handlers. **Keep** `checkout.session.completed` (credit purchase → `grantCredits(kind:'purchase')`).
- Delete per-print tests: `lib/billing/dunning.test.ts`, `invoice-collect.test.ts`, `invoice-emails.test.ts`, `invoice-sync.test.ts`, `usage-metering.test.ts`, and the per-print cases in `stripe-billing.test.ts`.

### Enforcement + UI
- `lib/api/guard.ts`: remove the `isOrgPaymentBlocked` call + 402/403 branches.
- `app/(tenant)/layout.tsx`: remove the payment-blocked redirect + overdue banner.
- `app/(tenant)/tenant/billing/page.tsx`: remove the Invoices table, subscription status header, and `PaymentMethodForm` ("Activate billing"). **Keep** balance, `BuyCreditsSection`, and the credit-usage-by-device table. Remove `components/billing/payment-method-form.tsx`.
- `app/(admin)/admin/billing/page.tsx`: rework to the credits view (Decision 4). Remove `GenerateInvoicesButton`, `InvoiceRowActions`, invoice table.
- Remove revenue tiles (Decision 5): `RevenueLineChart` from `components/charts.tsx`, revenue KPIs/columns in `app/(admin)/admin/page.tsx` + `app/(admin)/admin/customers/page.tsx` + `[tenantId]/page.tsx` + tenant `analytics`/`reports`/`stores/[storeId]` pages; `TimePoint.revenue` from `lib/types.ts`; `revenue`/`revenueThisMonth` from `lib/analytics.ts` (`bucketsToSeries`, `toComparisonRows`, `StoreAnalytics`, `StoreComparisonRow`) + its tests; the per-print "revenue" derivations in `lib/data.ts`.

### Data-layer view models
- `lib/data.ts`: remove `getBillingOverview` (rework into the new admin-credits fn), the invoice portions of `getTenantBilling` (keep its balance/usage parts or fold into credits fns), and rewrite `getApiUsage` (Decision 3). Remove `perPrintPriceCents` reads (`summarize`/`buildTenant` `perPrintPrice`/`revenueThisMonth`, store analytics revenue).

### Schema drop (final tasks — after all readers are gone)
- Drop tables: `document`, `usageEvent`, `invoice`.
- Drop `tenantSettings` columns: `perPrintPriceCents`, `stripeSubscriptionId`, `subscriptionStatus`, `cardBrand`, `cardLast4`. **Keep `stripeCustomerId`** (still needed for credit-pack Checkout).
- Update `lib/db/schema.ts` (+ `schema` export map), `lib/db/relations.ts` (`documentRelations` + inbound refs), `lib/db/seed.ts` (remove document seeding block + `documentToken`), `scripts/verify.ts` (remove `count(document)`). Remove the now-orphaned `documents:read` scope in `lib/api-scopes.ts`.
- Generate ONE Drizzle migration for the drops (strip any spurious drift per [[drizzle-snapshot-drift]]).

## Scope — what is KEPT (the credits path)
`lib/credits.ts`, `lib/credit-holds.ts`, `lib/credit-usage.ts`, `creditLedger` + `creditBalance` tables, the trigger endpoint + ack flow, `lib/billing/credit-packs.ts`, `createCreditCheckout` + `startCreditCheckout` + `BuyCreditsSection`, the admin grant-credits form, `ensureStripeCustomer`, `tenantSettings.stripeCustomerId`, and the `checkout.session.completed` webhook branch.

## Env changes
Remove `STRIPE_PRICE_ID`, `STRIPE_METER_EVENT_NAME` from `lib/env.ts` + `.env.example`. Keep `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_CREDIT_PACK_PRICE_IDS`.

## New `/api/v1/usage` response (Decision 3)
```jsonc
{
  "credits": { "available": 120, "held": 2 },
  "creditsConsumedThisMonth": 48,      // Σ ledger settle rows this month
  "activationsThisMonth": 48,          // acked triggers this month (== consumed; 1 credit/activation today)
  "period": { "start": "2026-07-01", "end": "2026-07-31" }
}
```
`serializeUsage` + the `openapi.json` `/usage` schema updated to match; the old `documents_this_month` / `current_period.document_count` / `amount_due_cents` / `daily`/`monthly` document arrays are removed.

## Admin credits view (Decision 4)
New data fn (e.g. `getCreditsOverview`) sourced from `creditLedger` + `creditBalance`: platform totals (credits granted / purchased / consumed), outstanding liability (Σ available balances), and a per-tenant table (balance, consumed-this-month, lifetime-purchased). No new columns required — all derivable from the ledger. *(Dollar revenue would require capturing Stripe `amount_total` per purchase; deferred — this view is credit-denominated, which is the honest prepaid metric.)*

## Coupling handled (from the subsystem map)
- Enforcement gate → deleted (Decision 1); trigger endpoint still gated by `reserveCredit`'s `402 insufficient_credits`.
- `/v1/usage` breaking change → Decision 3 (documented, prototype API).
- Audit codes (`invoicePaid`, `subscriptionStatusChanged`, etc.) → leave the enum entries + labels as historical (harmless); their call sites are removed with the code.
- `perPrintPriceCents` referenced in ~6 places → all removed with the revenue tiles (Decision 5) + engine.
- Starter-grant launch blocker → Decision 2.

## Testing
- Keep + extend credits tests (`lib/credit-usage.test.ts`, credits primitives). Add a test for the new `getApiUsage`/`serializeUsage` shape and the starter-grant idempotency.
- Delete per-print test files with their subjects.
- `.env.local` is PROD → verification is READ-ONLY (no DB writes); the schema-drop migration is verified against prod like migration 0028 (confirm the target tables/columns exist, then confirm dropped). Note: `invoice`/`document`/`usageEvent` may hold seed/test rows — confirm no real data before the CASCADE drop, same as the teardown.
- Whole suite green + `npm run build` per task.

## Rollout
- **Deploy order mirrors the teardown:** ship the code that stops reading the tables FIRST, then apply the drop migration (prod currently still runs code that reads `invoice`/`document`). Standard `vercel --prod --yes` then `npm run db:migrate`.
- Post-deploy: confirm a new signup receives 50 credits and can trigger; confirm `/v1/usage` returns the credit shape; confirm the tenant + admin billing pages render.

## Non-goals
- No change to the frozen trigger API contract or the credit reserve/settle/release mechanics.
- No dollar-denominated admin revenue (credit-denominated only; capturing Stripe amounts is a later enhancement).
- Firmware repo untouched (that's follow-up #4).

## Decomposition note
This is one cohesive removal but a large plan (~8–10 tasks, like the teardown). Behavior/code removal + reworks first; the schema-drop migration is the final task(s), once every reader is gone.
