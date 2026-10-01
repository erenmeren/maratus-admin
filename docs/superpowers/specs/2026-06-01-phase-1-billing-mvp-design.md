# Phase 1 — Billing MVP (Metered Subscriptions) Design

_Last updated: 2026-06-01_

## Context

Maratus bills tenants **usage-based postpaid**: `lib/billing-engine.ts` meters
receipts and generates an idempotent monthly **draft** invoice per org
(`unitPriceCents` default $0.04/receipt). Today a platform admin manually
advances `draft → sent → paid` — **no money actually moves**. There is no
tenant-facing billing page and no Stripe integration.

This spec is the **first slice of Phase 1**: a complete, shippable vertical where
tenants subscribe to a metered Stripe plan, receipt usage is reported to Stripe,
and **Stripe generates and charges invoices on its own cycle**. Our DB mirrors
Stripe via webhooks. Dunning, suspension, `void`/`uncollectible` handling, and
audit logs are explicitly **deferred to Spec 2**.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Collection model | **Stripe metered Subscriptions** — Stripe owns the billing clock; our DB mirrors |
| Scope | **Payment-collection MVP** (this spec) |
| Card capture | **Stripe Checkout Sessions** (`ui_mode: "elements"`, subscription mode) with the embedded Payment Element — Stripe's recommended path for starting subscriptions (revised from the original manual SetupIntent approach) |
| Scheduler | **Stripe** (no cron on our side) |

## Goals

1. One-time Stripe setup creates the Product + Meter + metered Price.
2. A tenant can activate billing: we create a Customer + Subscription and capture
   a card in-app via Elements.
3. Each ingested receipt reports a metered usage event to Stripe (non-blocking).
4. Stripe generates + charges monthly invoices; webhooks mirror status into our DB.
5. A tenant billing page shows subscription status, saved card, mirrored
   invoices, and a live current-period usage estimate.
6. Everything builds and pure-unit-tests pass **without** Stripe keys (graceful degrade).

## Non-Goals (Spec 2)

`void`/`uncollectible` handling, dunning grace periods, account **suspension**
(blocking `/api/ingest` for past-due/canceled subscriptions), retry policy,
payment-receipt emails, and the **audit log** seed.

---

## The flows

### One-time setup (`scripts/stripe-setup.ts`, run once per Stripe account)

1. Create a **Product** ("Maratus digital receipts").
2. Create a **Meter**: `stripe.billing.meters.create({ display_name: 'Receipts',
   event_name: 'receipts', default_aggregation: { formula: 'sum' } })`.
3. Create a metered **Price**: `unit_amount: 4`, `currency: 'usd'`,
   `recurring: { interval: 'month', usage_type: 'metered', meter: <meterId> }`,
   `product: <productId>`.
4. Print the resulting `STRIPE_PRICE_ID` and confirm `STRIPE_METER_EVENT_NAME=receipts`
   for `.env.local`.

### A. Activate billing (Checkout Session, subscription mode, embedded Elements)

1. Tenant opens `/tenant/billing`, clicks **Activate billing**.
2. Server action `activateBilling(orgId)`:
   - `ensureStripeCustomer(orgId)` → find-or-create Customer; store
     `tenantSettings.stripeCustomerId`.
   - Create a **Checkout Session**: `mode: 'subscription'`, `ui_mode: 'elements'`,
     `customer`, `line_items: [{ price: STRIPE_PRICE_ID }]`, `return_url`. Return
     the session's `client_secret`. Stripe creates the subscription on confirm
     (metered first invoice is $0, so no immediate charge — the card is saved for
     off-session use).
3. Client wraps the form in `<CheckoutElementsProvider stripe options={{ clientSecret }}>`
   (from `@stripe/react-stripe-js/checkout`), mounts the Checkout `<PaymentElement>`,
   and calls `checkout.confirm({ redirect: 'if_required' })` via `useCheckoutElements()`.
4. On success the subscription is created; its `stripeSubscriptionId` +
   `subscriptionStatus` and `cardBrand`/`cardLast4` are persisted via the
   `customer.subscription.*` / `payment_method.attached` webhooks.

### B. Report usage (on ingest, non-blocking)

In `POST /api/ingest`, **after** the receipt row is inserted and the device
heartbeat is bumped:

```
const customerId = <tenantSettings.stripeCustomerId for device.organizationId>
if (stripe && customerId) {
  // fire-and-forget: never fail ingestion on a metering error
  reportReceiptUsage(customerId).catch((e) => console.error('meter event failed', e))
}
```

`reportReceiptUsage(customerId)` → `stripe.billing.meterEvents.create({
event_name: STRIPE_METER_EVENT_NAME, payload: { stripe_customer_id: customerId,
value: '1' } })`. Orgs with no Customer (billing not activated) are skipped
(Spec 2 enforcement).

### C. Reconcile (webhook)

`POST /api/stripe/webhook` verifies the signature with `STRIPE_WEBHOOK_SECRET`,
then:

| Stripe event | Action |
|---|---|
| `invoice.created` / `invoice.finalized` | upsert our `invoice` row from the Stripe invoice (period, amount, `hostedInvoiceUrl`, status via `statusForStripeInvoice`) |
| `invoice.paid` | upsert → `status = 'paid'` |
| `invoice.payment_failed` | upsert → leave `status = 'sent'` (Spec 2 → dunning) |
| `customer.subscription.created/updated/deleted` | update `tenantSettings.subscriptionStatus` (+ cached card) |
| `setup_intent.succeeded` / `payment_method.attached` | cache `cardBrand`/`cardLast4` |

Idempotent: invoice upserts are keyed on `stripeInvoiceId`; replaying an event
is a no-op.

---

## Data model (additive — one migration, no enum change)

`tenantSettings` (PK = `organizationId`):
- `stripeCustomerId text` (nullable)
- `stripeSubscriptionId text` (nullable)
- `subscriptionStatus text` (nullable) — mirrors Stripe (`active`, `past_due`, …)
- `cardBrand text` (nullable)
- `cardLast4 text` (nullable)

`invoice`:
- `stripeInvoiceId text` (nullable, unique-ish) — links our row ↔ the Stripe invoice
- `hostedInvoiceUrl text` (nullable) — Stripe's hosted invoice page

Status enum stays `draft | sent | paid`. `statusForStripeInvoice` maps Stripe
(`draft→draft`, `open→sent`, `paid→paid`, others→`sent`). `void`/`uncollectible`
nuance arrives in Spec 2.

`lib/billing-engine.ts` is demoted: its receipt-count logic is kept as a
read-only **current-period usage estimate** for the UI; it no longer creates
billing invoice rows (Stripe + webhooks own those now). The platform-admin
manual `advanceInvoice`/`setInvoiceStatus`/`generateInvoices` actions are
retired or gated behind a comment as legacy (out of the primary flow).

---

## File structure

| File | Responsibility | New? |
|---|---|---|
| `lib/stripe.ts` | Server Stripe client; `null` when `STRIPE_SECRET_KEY` unset | Create |
| `scripts/stripe-setup.ts` | One-time Product + Meter + Price creation | Create |
| `lib/billing/stripe-billing.ts` | `ensureStripeCustomer`, `activateBilling`, `reportReceiptUsage` + pure `statusForStripeInvoice` | Create |
| `lib/billing/stripe-billing.test.ts` | Unit tests for `statusForStripeInvoice` (+ payload builder) | Create |
| `lib/billing/invoice-sync.ts` | `upsertInvoiceFromStripe(stripeInvoice)` used by the webhook | Create |
| `app/api/stripe/webhook/route.ts` | Signature-verified event handler | Create |
| `app/api/ingest/route.ts` | Fire non-blocking meter event after receipt insert | Modify |
| `app/(tenant)/tenant/billing/page.tsx` | Tenant billing page | Create |
| `app/(tenant)/tenant/billing/actions.ts` | `activateBilling` server action | Create |
| `components/billing/payment-method-form.tsx` | Client Elements form | Create |
| `lib/data.ts` | `getTenantBilling(orgId)` view-model (sub status, card, invoices, usage estimate) | Modify |
| `lib/db/schema.ts` | Add the columns above | Modify |
| `lib/env.ts` | Add Stripe env (all optional) | Modify |
| `.env.example` | Document the new vars | Modify |

---

## Error handling

- **Stripe not configured:** `lib/stripe.ts` exports `null`; the billing page
  renders "Billing isn't configured yet"; webhook route returns 503; ingest
  metering is skipped. App still builds and boots.
- **Meter event fails:** caught and logged; **ingestion still succeeds** (usage
  reporting is fire-and-forget).
- **Subscription create fails:** server action returns a typed error; the page
  shows it; no partial state persisted beyond a created Customer (safe to reuse).
- **Webhook:** bad signature → 400; unhandled event type → 200 (ignored);
  invoice for an unknown org → log + 200.

## Testing

- **Pure unit (TDD, no Stripe needed, run green in CI):**
  - `statusForStripeInvoice(stripeStatus)` — `draft→draft`, `open→sent`,
    `paid→paid`, `uncollectible→sent`, unknown→`sent`.
  - meter-event payload builder — shape `{ event_name, payload: {
    stripe_customer_id, value: '1' } }`.
- **Mocked integration:** webhook route with a hand-built event (mock
  `stripe.webhooks.constructEvent`); `upsertInvoiceFromStripe` writes the right row.
- **Manual e2e (Stripe test mode):** run `scripts/stripe-setup.ts`; `stripe
  listen --forward-to localhost:3000/api/stripe/webhook`; activate billing with
  card `4242 4242 4242 4242`; ingest receipts and watch meter events; use
  `stripe trigger invoice.paid` (or advance a test clock) to see the mirror update.

## Environment

| Var | Purpose | Required? |
|---|---|---|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client Elements | optional* |
| `STRIPE_SECRET_KEY` | Server Stripe client | optional* |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification | optional* |
| `STRIPE_PRICE_ID` | The metered price tenants subscribe to | optional* |
| `STRIPE_METER_EVENT_NAME` | Meter event name (`receipts`) | optional* (default `receipts`) |

*Optional in the zod schema so the app builds without them; billing features are
inert until present. Test secret/publishable keys are already in `.env.local`;
`STRIPE_WEBHOOK_SECRET` is filled from `stripe listen` and `STRIPE_PRICE_ID` from
`scripts/stripe-setup.ts` at execution time.

## Sequencing

1. Schema + migration (additive columns).
2. `lib/stripe.ts` + env (guarded client).
3. `scripts/stripe-setup.ts` → obtain `STRIPE_PRICE_ID`.
4. Pure helpers + tests (TDD).
5. `stripe-billing.ts` (customer/subscription/usage) + `invoice-sync.ts`.
6. Webhook route.
7. Ingest meter-event hook (non-blocking).
8. Tenant billing page + Elements form + view-model.
9. Manual e2e in Stripe test mode.
