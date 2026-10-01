# Phase 1A — Invoice Collection (local invoices → Stripe) — Design

**Date:** 2026-06-27
**Repo:** `maratus-admin`
**Status:** Approved design, pre-implementation
**Phase:** 1 ("close the billing loop"), sub-project **1A**. Follow-ups: **1B** dunning & enforcement, **1C** transition emails.

## Problem

Locally-generated invoices are a parallel, Stripe-disconnected path. `runInvoiceGeneration` counts `document` rows × `tenantSettings.perPrintPriceCents` into a local `draft` invoice, but the draft→sent transition (`advanceInvoice` / `setInvoiceStatus` in `lib/actions/billing.ts`) is a pure DB flip — it never creates a Stripe invoice, so `hostedInvoiceUrl` stays null and there is nothing for a tenant to pay. **1A closes that gap:** sending a local invoice creates a real, payable Stripe invoice; the existing webhook reconciles `paid`/`payment_failed`/`voided` back to the local row.

## Decisions (locked via brainstorming)

1. **Billing model = Model 1.** Local monthly invoices remain the source of truth; "send" pushes them to Stripe for collection. (Prepaid credits stay orthogonal — they monetize device *triggers*; monthly invoices monetize document *volume* for tenants who are NOT on credits. The two are alternative plans and do not double-bill.)
2. **Collection method = hybrid.** If the tenant has a card on file (`tenantSettings.cardLast4` set) → `charge_automatically` (Stripe charges on finalize). Otherwise → `send_invoice` with **Net 14** (`days_until_due: 14`), and Stripe emails the hosted invoice page.
3. **Repurpose the draft→sent transition** to do the real Stripe push — do NOT add a second, parallel "send" action.
4. **Zero-amount invoices** (`amountDueCents === 0`) cannot be sent — `sendInvoice` returns a "nothing to collect" error and leaves the invoice `draft` (admin may void it manually).
5. **Manual "Mark as paid" override stays** (platform-admin, for out-of-band payments); the real path is webhook-driven.
6. **No tax, currency `usd`** (YAGNI).

## Architecture

Three units, following the existing `lib/billing/` structure:

### A) Pure param-builder — `lib/billing/invoice-collect.ts` (new)

```ts
export interface StripeInvoiceParams {
  collectionMethod: "charge_automatically" | "send_invoice";
  daysUntilDue: number | null;      // null for charge_automatically; 14 for send_invoice
  item: { amountCents: number; currency: "usd"; description: string };
}

// Pure. No IO. Unit-tested.
export function stripeInvoiceParamsFor(
  invoice: { amountDueCents: number; documentCount: number; unitPriceCents: number; periodStart: Date },
  opts: { hasCard: boolean },
): StripeInvoiceParams;
```

- `collectionMethod` = `charge_automatically` when `opts.hasCard`, else `send_invoice`.
- `daysUntilDue` = `null` for `charge_automatically`, `14` for `send_invoice`.
- `item.description` = `"Documents — {Mon YYYY}: {documentCount.toLocaleString()} × ${(unitPriceCents/100).toFixed(2)}"` where `{Mon YYYY}` is derived from `periodStart` (e.g. `"Jun 2026"`). Helper `invoicePeriodLabel(periodStart: Date): string` lives in this module and is unit-tested.
- `item.amountCents` = `invoice.amountDueCents`.

### B) IO orchestration — `sendInvoiceToStripe` in `lib/billing/stripe-billing.ts` (extend existing)

```ts
export async function sendInvoiceToStripe(invoiceId: string): Promise<
  | { ok: true; stripeInvoiceId: string; hostedInvoiceUrl: string | null; collectionMethod: string }
  | { ok: false; reason: "no_amount" | "already_sent" | "stripe_disabled" | "not_found" }
>;
```

Steps:
1. Load the local invoice row; `not_found` if missing.
2. If `stripeInvoiceId` already set → `already_sent` (idempotent no-op — never double-create; backed by the unique `invoice_stripe_invoice_id_idx`).
3. If `amountDueCents === 0` → `no_amount`.
4. If `!stripe` → `stripe_disabled`.
5. `customerId = await ensureStripeCustomer(invoice.organizationId)` (exists).
6. Determine `hasCard` from `tenantSettings.cardLast4 != null` for the org.
7. `params = stripeInvoiceParamsFor(invoice, { hasCard })`.
8. `stripe.invoiceItems.create({ customer, amount: params.item.amountCents, currency: "usd", description: params.item.description })`.
9. `inv = stripe.invoices.create({ customer, collection_method, days_until_due?, auto_advance: true, pending_invoice_items_behavior: "include", metadata: { organizationId, localInvoiceId } })`.
10. `final = stripe.invoices.finalizeInvoice(inv.id)`.
11. Persist to the local row: `stripeInvoiceId = final.id`, `hostedInvoiceUrl = final.hosted_invoice_url ?? null`, `status = "sent"`.
12. `recordAudit({ action: AUDIT.invoiceSent, target: { type: "invoice", id: invoiceId }, metadata: { stripeInvoiceId, collectionMethod, amountDueCents } })`.

Notes:
- Finalize, not just create, so `charge_automatically` attempts the charge now and `send_invoice` emails the hosted page now. The resulting `invoice.paid` / `invoice.payment_failed` / `invoice.finalized` webhooks are already handled by `app/api/stripe/webhook/route.ts` + `upsertInvoiceFromStripe`; **no webhook changes needed**.
- `metadata.localInvoiceId` lets the webhook reconcile even though `upsertInvoiceFromStripe` already resolves the org by `stripeCustomerId`; it is belt-and-suspenders and useful for audit.

### C) Server action + UI wiring

- `lib/actions/billing.ts`: the draft→sent path now calls `sendInvoiceToStripe`. Concretely, `advanceInvoice(invoiceId)`:
  - for a `draft` invoice → call `sendInvoiceToStripe`; on `{ ok:false }` return a typed error the UI surfaces (e.g. `no_amount` → "Nothing to collect — $0 invoice"); on success the row is already `sent`.
  - for a `sent` invoice → keep the existing manual `sent → paid` override flip (out-of-band).
- New `voidInvoice(invoiceId)` action (platform-admin): if `stripeInvoiceId` set → `stripe.invoices.voidInvoice(stripeInvoiceId)` (the `invoice.voided` webhook reconciles the local row to `void`); else flip local → `void` directly + audit `AUDIT.invoiceVoid`.
- `components/invoice-row-actions.tsx`: keep "Mark as sent" (now triggers the real Stripe send) and "Mark as paid" (manual override); **add "Void"** (draft or sent). Surface `sendInvoiceToStripe` failure reasons as toast/inline errors.
- **Tenant pay UX** (`app/(tenant)/tenant/billing/page.tsx` + its invoice table component): relabel the existing `hostedInvoiceUrl` link to **"Pay"** when the row status is `sent` or `overdue`, and **"View"** when `paid`/`void`. No new tenant flow — the link goes to Stripe's hosted page. (Rows with a null `hostedInvoiceUrl` — i.e. never sent — render no link, as today.)

### Audit constant

- Add `AUDIT.invoiceSent = "invoice.sent"` to `lib/audit.ts`. Reuse existing `AUDIT.invoiceVoid`, `AUDIT.invoicePaid`, `AUDIT.invoicePaymentFailed`.

## Data flow

```
Platform admin clicks "Mark as sent" on a draft
  → advanceInvoice(id) → sendInvoiceToStripe(id)
     → ensureStripeCustomer → invoiceItems.create → invoices.create(hybrid) → finalizeInvoice
     → local row: stripeInvoiceId + hostedInvoiceUrl + status="sent" + audit invoice.sent
  → (charge_automatically) Stripe charges saved card now
     OR (send_invoice) Stripe emails tenant the hosted invoice (Net 14)
  → Stripe webhook: invoice.paid → local "paid" (+audit) | invoice.payment_failed → local "overdue" (+audit)
Tenant sees "Pay" link (hostedInvoiceUrl) on /tenant/billing → pays on Stripe hosted page → same webhooks
Admin "Void" → stripe.invoices.voidInvoice → webhook invoice.voided → local "void"
```

## Error handling / edge cases

- **Stripe disabled** (`!stripe`, e.g. local dev without keys): `sendInvoiceToStripe` returns `stripe_disabled`; the action surfaces "Billing not configured". No crash.
- **Re-send / double-click:** `already_sent` no-op (guard on `stripeInvoiceId`).
- **$0 invoice:** `no_amount`; stays draft.
- **Partial failure** (item created but `invoices.create`/finalize throws): the local row is unchanged (still `draft`), and the dangling Stripe invoice item is harmless (it attaches to the next invoice for that customer, or admin retries — retry reuses pending items via `pending_invoice_items_behavior: "include"`). We do NOT wrap multiple Stripe calls in a local transaction; on throw, the action returns an error and the admin retries. (Stripe object creation is not idempotency-keyed here — acceptable for a platform-admin-initiated, low-frequency action in test mode; a Stripe idempotency key can be added in 1B if needed.)
- **Mid-period send:** generation only updates `draft` rows, so once sent the amount is frozen — sending is expected after period end. Not enforced in 1A; documented.

## Testing

- **Pure unit tests** (`lib/billing/invoice-collect.test.ts`): `stripeInvoiceParamsFor` — card → `charge_automatically` + `daysUntilDue: null`; no-card → `send_invoice` + `daysUntilDue: 14`; amount passthrough; description formatting incl. thousands separator and price; `invoicePeriodLabel` for a known date.
- **Existing suite stays green** (`npm run test`, currently 254) + `npm run build` + `npx tsc --noEmit`.
- **Live smoke (Stripe test mode):**
  1. Tenant WITHOUT card: generate → "Mark as sent" → row gets `hostedInvoiceUrl`, status `sent`; open the hosted page; pay with `4242…`; webhook flips local → `paid`.
  2. Tenant WITH card on file: "Mark as sent" → `charge_automatically` → `invoice.paid` webhook → local `paid` without visiting a hosted page.
  3. Void a sent invoice → Stripe voided → local `void`.
  4. Re-send a sent invoice → no-op (`already_sent`).
  5. $0 invoice → "Mark as sent" → "nothing to collect", stays draft.
  6. Tenant billing page shows a working "Pay" link for the sent invoice.

## Out of scope (later sub-projects)

- **1B:** monthly generation cron, overdue sweep/escalation, and suspending/throttling ingest for unpaid/suspended orgs (`isSuspended` exists but is not enforced at ingest yet). Stripe idempotency keys on invoice creation if needed.
- **1C:** our own Resend transition emails (invoice sent / payment failed / paid receipt) — in 1A, Stripe's own hosted-invoice email covers the `send_invoice` case.
- Subscription/metered-billing path (`activateBilling`, Billing Meters) — unchanged by 1A.
