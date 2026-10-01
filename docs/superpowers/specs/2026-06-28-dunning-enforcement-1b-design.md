# Phase 1B — Dunning & Enforcement — Design

**Date:** 2026-06-28
**Repo:** `maratus-admin`
**Status:** Approved design, pre-implementation
**Phase:** 1 ("close the billing loop"), sub-project **1B**. Builds on **1A** (invoice collection, merged). Sibling: **1C** transition emails.

## Problem

After 1A, invoices can be *sent* and collected through Stripe, but everything is still manual and unenforced:
- `runInvoiceGeneration` only runs on a platform-admin button, and it bills the *current* month-to-date — there is no automated monthly close.
- Locally-sent (`send_invoice` / hosted-link) invoices that sit unpaid never flip to `overdue` — only an auto-charge failure does (via the `invoice.payment_failed` webhook). There is no `dueDate` and no sweep.
- Delinquency is unenforced: ingest + `/api/v1` block only on `isSuspended(subscriptionStatus)` (the terminal subscription set `canceled|unpaid|incomplete_expired`). An org sitting on an unpaid invoice is never cut off.

1B automates the delinquency lifecycle: **generate → auto-send (card tenants) → overdue sweep → enforce**, with a grace window before hard-blocking.

## Decisions (locked via brainstorming)

1. **Auto-send only auto-charge (card) tenants.** The monthly cron pushes invoices for tenants WITH a saved card (`tenantSettings.cardLast4` → `charge_automatically`). No-card tenants are left as drafts for a platform-admin to review and send (the 1A manual flow). Reuses 1A's `sendInvoiceToStripe` unchanged.
2. **Grace-window-then-block.** When an invoice goes `overdue` (its `dueDate` passed unpaid) the tenant sees a past-due banner immediately, but service keeps running for **GRACE_DAYS = 7**. After grace, ingest + `/api/v1` are hard-blocked until paid.
3. **`past_due` block = HTTP 402; suspended block = HTTP 403** (the existing 403 path is unchanged).
4. **The billing cron self-heals daily** — it always targets the *previous calendar month* and is fully idempotent, so a missed cron day catches up on the next run (no reliance on firing exactly on the 1st). This fits Vercel Hobby's daily-only cron constraint.
5. **One new column** (`invoice.dueDate`), populated from Stripe's finalized `due_date` at send time. No `overdueSince` column — the grace timer is computed from `dueDate`.

## Architecture

### A) Data model — `invoice.dueDate` (`lib/db/schema.ts` + migration)

Add `dueDate: timestamp("due_date")` (nullable) to the `invoice` table. Additive, non-breaking. Generate the migration with `npm run db:generate`, then `npm run db:migrate`.

Populate it in 1A's `sendInvoiceToStripe` (`lib/billing/stripe-billing.ts`): when persisting the sent invoice, also set
`dueDate: finalized.due_date != null ? new Date(finalized.due_date * 1000) : null`.
(`send_invoice` invoices carry a `due_date` = sent + 14d; `charge_automatically` invoices have none → `null`, and their failure path stays the `invoice.payment_failed` webhook.)

### B) Pure decision helpers — `lib/billing/dunning.ts` (new, IO-free, unit-tested)

```ts
export const GRACE_DAYS = 7;

// The calendar-month date to bill: a stable mid-day in the previous month of `now`.
export function previousMonthMarker(now: Date): Date;        // e.g. now=2026-07-03 → 2026-06-15T12:00:00Z

// True when a sent invoice should flip to overdue.
export function isOverdue(inv: { status: string; dueDate: Date | null }, now: Date): boolean;
//   = inv.status === "sent" && inv.dueDate != null && inv.dueDate < now

// True when an overdue invoice is past the grace window (→ hard block).
export function isPastGrace(inv: { status: string; dueDate: Date | null }, now: Date): boolean;
//   = inv.status === "overdue" && inv.dueDate != null && inv.dueDate.getTime() + GRACE_DAYS*86400000 < now.getTime()

// Combine subscription + invoice state into one verdict.
export function paymentBlockVerdict(input: {
  subscriptionStatus: string | null;
  hasPastGraceOverdue: boolean;
}): { blocked: boolean; reason: "suspended" | "past_due" | null };
//   isSuspended(subscriptionStatus) → { blocked:true, reason:"suspended" }
//   else hasPastGraceOverdue       → { blocked:true, reason:"past_due" }
//   else                            → { blocked:false, reason:null }
```

`paymentBlockVerdict` imports `isSuspended` from `billing-status.ts` (still pure). These functions hold all the date/grace logic so it is testable without a DB.

### C) Enforcement IO — `lib/billing/enforcement.ts` (new)

```ts
// One DB read; used by ingest + the /api/v1 guard.
export async function isOrgPaymentBlocked(organizationId: string): Promise<{
  blocked: boolean;
  reason: "suspended" | "past_due" | null;
}>;
```

Implementation: select `tenantSettings.subscriptionStatus`; select whether any `overdue` invoice for the org has `dueDate < now − GRACE_DAYS` (a single `exists`-style query); feed both into `paymentBlockVerdict`. Fail-safe: on DB error, return `{ blocked:false }` and `reportError` (mirrors the current ingest fail-open behavior — never block a paying customer because of an infra blip).

**Wiring (refactor the existing inline checks):**
- `app/api/ingest/route.ts`: replace the current inline `isSuspended` select+check with `const block = await isOrgPaymentBlocked(device.organizationId)`. `reason === "suspended"` → `bad(403, "Subscription inactive")` (unchanged); `reason === "past_due"` → `bad(402, "Account past due")`.
- `lib/api/guard.ts`: same replacement — `suspended` → `apiError("subscription_inactive", …, 403)` (unchanged); `past_due` → `apiError("payment_past_due", "Account past due.", 402)`.

### D) Billing cron — `app/api/cron/billing/route.ts` (new) + `lib/billing/billing-cron.ts`

Cron route: GET, `CRON_SECRET` bearer auth + 503-if-unset + 401-on-mismatch (verbatim the `credit-holds` pattern), returns `{ ok:true, generated, autoSent, sweptOverdue }`. Schedule in `vercel.json`: `{ "path": "/api/cron/billing", "schedule": "0 9 * * *" }`.

`runBillingCron(now: Date)` in `lib/billing/billing-cron.ts` does three idempotent steps:
1. **Generate** — `runInvoiceGeneration(previousMonthMarker(now))` (bills the closed previous month; only touches draft rows).
2. **Auto-send card tenants** — select draft invoices for that period whose org has `cardLast4` set; for each, call `sendInvoiceToStripe(invoiceId)` (which picks `charge_automatically`). Count successes; `already_sent`/`no_amount`/`stripe_disabled` are skipped, not errors.
3. **Overdue sweep** — `UPDATE invoice SET status='overdue' WHERE status='sent' AND due_date IS NOT NULL AND due_date < now`; for each flipped row, `recordAudit(AUDIT.invoiceOverdue, actor system, target invoice, metadata { dueDate })`.

Add `AUDIT.invoiceOverdue = "invoice.overdue"` to `lib/audit.ts`.

### E) Tenant UX — `app/(tenant)/layout.tsx`

The layout already (i) redirects suspended orgs to `/tenant/billing` and (ii) shows a `past_due` subscription banner. Extend it:
- Compute the org's payment state once (reuse `isOrgPaymentBlocked` + a lighter "has any overdue invoice" read, or extend the helper to also return `hasOverdue`).
- **Overdue (within grace):** show a past-due banner ("Your account has an unpaid invoice. Pay on the Billing page to avoid interruption.") alongside the existing subscription banner logic.
- **Blocked (past grace OR suspended):** the existing redirect-to-billing behavior applies (so a hard-blocked tenant lands on Billing, where they can pay).

## Data flow

```
Daily /api/cron/billing (CRON_SECRET):
  runBillingCron(now):
    1. generate  → runInvoiceGeneration(previousMonthMarker(now))   [drafts for last month]
    2. auto-send → for draft invoices w/ org cardLast4: sendInvoiceToStripe  [charge_automatically]
    3. sweep     → sent invoices w/ dueDate < now → overdue (+audit invoice.overdue)

Ingest / /api/v1 request:
  isOrgPaymentBlocked(orgId):
    suspended subscription          → blocked, reason "suspended"  → 403
    overdue invoice, dueDate+7d<now → blocked, reason "past_due"   → 402
    else                            → allowed

Tenant visits any page:
  overdue (in grace) → past-due banner; blocked → redirect to /tenant/billing → pay → webhook → paid
```

## Error handling / edge cases

- **Enforcement fail-open:** `isOrgPaymentBlocked` returns `{ blocked:false }` on DB error (+`reportError`). Never cut off service due to an infra fault — matches the current ingest behavior.
- **Cron idempotency:** generation only updates drafts; auto-send guards on `already_sent`; the sweep only moves `sent → overdue`. Re-running the cron (same day or a missed day) is safe and self-healing.
- **Auto-charge failure:** for card tenants, a failed charge fires `invoice.payment_failed` → existing webhook sets the invoice `overdue` immediately (no `dueDate` needed); enforcement then applies the same 7-day grace from the (null) dueDate? — NOTE: charge_automatically invoices have `dueDate = null`, so `isPastGrace` is false and they are NOT hard-blocked by the sweep path. They are surfaced as overdue (banner) but blocking for failed auto-charges is governed by Stripe's subscription dunning, out of 1B scope. 1B's hard-block targets unpaid `send_invoice` (manual-pay) invoices, which have a real `dueDate`.
- **Paid before block:** once Stripe fires `invoice.paid`, the webhook flips the row to `paid`; the org immediately drops out of the blocked set on the next request (no extra reconciliation needed).
- **No double-billing with credits:** the cron touches only `invoice`/`tenantSettings`; credits untouched.

## Testing

- **Pure unit tests** (`lib/billing/dunning.test.ts`): `previousMonthMarker` (incl. Jan→Dec year rollover); `isOverdue` (sent+past due true, draft/paid/no-dueDate false); `isPastGrace` (overdue + dueDate+7d in past true, within grace false, charge_automatically null-dueDate false); `paymentBlockVerdict` (suspended → suspended; past-grace overdue → past_due; clean → not blocked; suspended takes precedence).
- **Existing suite green** (`npm run test`, 259 → grows) + `npm run build` + `npx tsc --noEmit`.
- **Scripted local IO check** (no DB harness): with `CRON_SECRET` set, hit `/api/cron/billing` and assert the `{ ok, generated, autoSent, sweptOverdue }` shape; seed/force an org into past-grace-overdue and confirm ingest returns **402** and `/api/v1` returns the `payment_past_due` 402; confirm a clean org still returns 201/200.

## Out of scope

- **1C:** Resend transition emails (invoice sent / payment failed / paid receipt). In 1B, Stripe's own hosted-invoice email covers the no-card send path; no custom email here.
- Admin "delinquent orgs" dashboard view (Phase 2).
- Throttling (reduced rate limit) as a softer enforcement tier — 1B is binary allow/hard-block after grace.
- Stripe-managed subscription dunning for failed auto-charges (Stripe handles its own retries; 1B does not re-implement it).
