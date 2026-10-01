# Phase 1C — Invoice Transition Emails — Design

**Date:** 2026-06-28
**Repo:** `maratus-admin`
**Status:** Approved design, pre-implementation
**Phase:** 1 ("close the billing loop"), sub-project **1C** (final). Builds on **1A** (invoice collection) + **1B** (dunning & enforcement), both merged.

## Problem

The billing loop now generates, sends, collects, and enforces invoices — but the tenant gets no branded notification from Maratus when money events happen. 1C adds transactional emails for the four invoice transitions, reusing the existing Resend send path and the pure-builder pattern from `lib/alerts.ts`.

## Decisions (locked via brainstorming)

1. **Four emails:** invoice sent, payment failed, paid receipt, overdue reminder.
2. **Invoice-sent fires only on the `send_invoice` (pay-link) path** — the only case with a real "please pay" call-to-action. For `charge_automatically` there is nothing to pay, so the paid/failed email covers it. **Known overlap (accepted):** on `send_invoice`, Stripe also emails its own hosted invoice, so the tenant receives two; the user may disable Stripe's hosted-invoice email in the dashboard to avoid the double — no code change.
3. **Shared branded wrapper:** a small `emailLayout()` (Maratus wordmark header + muted footer) reused by all four, rather than the bare `<p>` style of the existing internal alert/verification emails.
4. **Recipient:** the org **owner** (member `role="owner"`, falling back to any member), resolved by a new `getOrgOwnerEmail(orgId)`. Skip the send when null.
5. **Security:** org name (user-controlled) is **HTML-escaped** in every builder.
6. **Never block / never throw:** `sendEmail` already no-ops without `RESEND_API_KEY` and returns `false` on failure (never throws). Webhook-triggered emails run in `after()` so Stripe still gets a fast 200.
7. **Delivery gating is ops, not code:** until the Resend domain is verified, only `erenaltan@gmail.com` actually receives (a Resend policy). The code is correct regardless.

## Architecture

### A) Pure builders + wrapper — `lib/billing/invoice-emails.ts` (new, IO-free)

```ts
export interface InvoiceEmailData {
  orgName: string;
  periodLabel: string;        // e.g. "June 2026" (from invoice.periodStart)
  amountDollars: number;      // amountDueCents / 100
  hostedInvoiceUrl: string | null;  // Stripe pay link
  dueDateLabel?: string;      // e.g. "July 14, 2026" (overdue/sent only)
}

export function emailLayout(bodyHtml: string): string;   // wordmark header + footer wrapper
export function escapeHtml(s: string): string;           // & < > " '

export function invoiceSentEmail(d: InvoiceEmailData): { subject: string; html: string };
export function paymentFailedEmail(d: InvoiceEmailData): { subject: string; html: string };
export function paidReceiptEmail(d: InvoiceEmailData): { subject: string; html: string };
export function overdueReminderEmail(d: InvoiceEmailData): { subject: string; html: string };
```

- Subjects (indicative): `"Your Maratus invoice for June 2026"`, `"Payment failed for your Maratus invoice"`, `"Payment received — June 2026"`, `"Your Maratus invoice is overdue"`.
- Each body shows the period + amount (`$X.XX`) and, where a pay link exists, a "Pay invoice" / "Update payment" button linking to `hostedInvoiceUrl` (fallback to `${BETTER_AUTH_URL}/tenant/billing` when null). `orgName` is escaped via `escapeHtml`.
- `paidReceiptEmail` has no pay link (it's a confirmation).
- Pure → unit-tested like `alertEmail` in `lib/alerts.test.ts`.

### B) Recipient resolution — `getOrgOwnerEmail` (in `lib/billing/invoice-emails.ts` or a small `lib/billing/recipients.ts`)

```ts
export async function getOrgOwnerEmail(organizationId: string): Promise<string | null>;
```

Query `member ⋈ user` for `role="owner"` (limit 1); fall back to any member's email; return `null` if none. This is the first standalone owner-email helper (today the logic is embedded in `loadOrg`).

### C) A single send helper — `sendInvoiceEmail` (in the same module)

```ts
// Resolves the owner, builds nothing itself — takes a prebuilt {subject, html}.
export async function sendInvoiceEmail(
  organizationId: string,
  mail: { subject: string; html: string },
): Promise<void>;
```

Looks up `getOrgOwnerEmail`; if present, `await sendEmail(to, mail.subject, mail.html)` (which never throws). No-op + return when no recipient. This keeps each call site to two lines (build data → `sendInvoiceEmail`).

### D) Call sites

1. **Invoice sent** — `lib/billing/stripe-billing.ts`, inside `sendInvoiceToStripe`, after the DB persist, **only when `params.collectionMethod === "send_invoice"`**. Builds `invoiceSentEmail` from the invoice row + `getOrgOwnerEmail` and awaits `sendInvoiceEmail(inv.organizationId, mail)`. (Inline await is fine — `sendInvoiceToStripe` is already a multi-call Stripe operation and `sendEmail` is non-throwing.)
2. **Payment failed** — `app/api/stripe/webhook/route.ts`, in the `invoice.payment_failed` handler (after the status/audit writes). Load the local invoice by `stripeInvoiceId` for period/amount/hostedInvoiceUrl, then `after(() => sendInvoiceEmail(row.org, paymentFailedEmail(data)))`.
3. **Paid receipt** — same file, `invoice.paid` handler, `after(() => sendInvoiceEmail(row.org, paidReceiptEmail(data)))`.
4. **Overdue reminder** — `lib/billing/billing-cron.ts`, inside the sweep loop, per invoice flipped to `overdue`: build `overdueReminderEmail` and `await sendInvoiceEmail(row.organizationId, mail)` (cron is not latency-sensitive; awaited inline alongside the existing audit call).

A small shared mapper turns an invoice row into `InvoiceEmailData` (period label via the existing `invoicePeriodLabel` from `lib/billing/invoice-collect.ts`; `amountDollars = amountDueCents / 100`; `dueDateLabel` formatted from `dueDate`). Org name comes from the `organization` table (one read) or is passed through where already in scope.

## Data flow

```
sendInvoiceToStripe (send_invoice path only)
  → invoiceSentEmail → sendInvoiceEmail(orgId) → getOrgOwnerEmail → sendEmail

Stripe webhook invoice.payment_failed → after(sendInvoiceEmail(paymentFailedEmail))
Stripe webhook invoice.paid           → after(sendInvoiceEmail(paidReceiptEmail))

billing cron sweep (sent→overdue, per row) → sendInvoiceEmail(overdueReminderEmail)
```

## Error handling / edge cases

- **No recipient:** `getOrgOwnerEmail` → null → `sendInvoiceEmail` no-ops. No error.
- **Resend unconfigured / send failure:** `sendEmail` logs + `reportError` + returns `false`; callers ignore the boolean. Nothing throws into a webhook, the cron, or the admin action.
- **Webhook latency:** payment-failed/paid emails run in `after()` so Stripe's 200 isn't delayed.
- **HTML injection:** org name escaped; no other user-controlled string is interpolated unescaped (period/amount/url are server-derived).
- **Duplicate sends:** the cron sweep only flips `sent → overdue` once (the row is no longer `sent` afterward), so the overdue email fires once per invoice. Webhook idempotency is Stripe's at-least-once → a rare duplicate paid/failed email is acceptable (no money effect).

## Testing

- **Pure unit tests** (`lib/billing/invoice-emails.test.ts`): each builder's subject + body (period, `$X.XX` amount, pay-link presence/href, button copy); `escapeHtml` on `&<>"'`; an org name like `<script>alert(1)</script>` appears escaped in the HTML; `emailLayout` wraps with the wordmark/footer; `paidReceiptEmail` has no pay link.
- **Existing suite green** (`npm run test`, 270 → grows) + `npm run build` + `npx tsc --noEmit`.
- **No live email smoke required** (delivery gated on the unverified domain). Optional manual check: trigger one path with `RESEND_API_KEY` set and confirm an email lands at `erenaltan@gmail.com`.

## Out of scope

- Resend **domain verification** (ops; unblocks delivery to real tenants) — user step.
- A "blocked/suspended" notice email (the hard-block at 7-day grace) — the overdue reminder already warns; a separate suspension email is deferrable.
- Disabling Stripe's own hosted-invoice email to avoid the `send_invoice` double-send — a Stripe dashboard setting (user's choice), noted in decision 2.
- Richer HTML templating (React Email, etc.) — the string-builder + wrapper matches the existing codebase pattern (YAGNI).

**Phase 1 completes with 1C:** 1A invoice collection ✅, 1B dunning & enforcement ✅, 1C transition emails (this). After 1C → Phase 2.
