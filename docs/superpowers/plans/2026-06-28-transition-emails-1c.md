# Phase 1C — Invoice Transition Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email the tenant owner a branded notification on the four invoice transitions — sent, payment failed, paid, overdue — reusing the existing Resend `sendEmail` path.

**Architecture:** Pure `{subject, html}` builders + a shared layout wrapper in `lib/billing/invoice-emails.ts` (mirroring `lib/alerts.ts`), one IO recipient helper `getOrgEmailContext`, and four call sites: invoice-sent inside `sendInvoiceToStripe` (send_invoice path only), payment-failed/paid in the Stripe webhook via `after()`, and overdue in the 1B cron sweep.

**Tech Stack:** Next.js 16 (`after()` for async sends), Drizzle/Neon, Resend via `lib/email.ts` (no SDK — raw fetch, never throws, no-ops without `RESEND_API_KEY`), Vitest (pure builders only).

## Global Constraints

- **Four emails:** invoice sent, payment failed, paid receipt, overdue reminder. Invoice-sent fires **only on the `send_invoice` collection path** (charge_automatically has no "please pay" moment).
- **Recipient = org owner** (member `role="owner"`, else any member); skip when none.
- **Security:** org name (user-controlled) is HTML-escaped in every builder. No other user-controlled string is interpolated unescaped.
- **Never block / never throw:** `sendEmail` no-ops without `RESEND_API_KEY` and returns `false` on failure (never throws). Webhook emails run in `after()` so Stripe gets a fast 200.
- **Pay link:** builders receive a final `payUrl: string` (the call site resolves `hostedInvoiceUrl ?? \`${BETTER_AUTH_URL}/tenant/billing\``) — builders stay pure (no env read). Paid-receipt has no pay button.
- **Money is dollars in the email** (`amountDueCents / 100`, formatted `$X.XX`).
- Reuse `invoicePeriodLabel(periodStart)` from `lib/billing/invoice-collect.ts` for the period label.
- Verification per task: `npm run test` (currently 270, stays green), `npm run build`, `npx tsc --noEmit`. Dev server on **:3001**.
- **Deferred to user:** Resend domain verification (until then only `erenaltan@gmail.com` receives — a Resend policy, not a code gate); optionally disabling Stripe's own hosted-invoice email to avoid the `send_invoice` double-send.

## File Map

| File | Responsibility | Task |
|---|---|---|
| `lib/billing/invoice-emails.ts` (new) + `.test.ts` | pure: escapeHtml, formatDueDate, emailLayout, 4 builders | 1 |
| `lib/billing/invoice-emails.ts` (extend) | IO: `getOrgEmailContext` | 2 |
| `lib/billing/stripe-billing.ts` (modify) | invoice-sent email (send_invoice path) | 2 |
| `lib/billing/billing-cron.ts` (modify) | overdue-reminder email in the sweep | 2 |
| `app/api/stripe/webhook/route.ts` (modify) | payment-failed + paid emails via `after()` | 3 |

---

### Task 1: Pure email builders + layout

**Files:**
- Create: `lib/billing/invoice-emails.ts`
- Test: `lib/billing/invoice-emails.test.ts`

**Interfaces:**
- Produces:
  - `interface InvoiceEmailData { orgName: string; periodLabel: string; amountDollars: number; payUrl: string; dueDateLabel?: string }`
  - `escapeHtml(s: string): string`
  - `formatDueDate(d: Date): string`  → e.g. `"July 14, 2026"` (UTC)
  - `emailLayout(bodyHtml: string): string`
  - `invoiceSentEmail(d) / paymentFailedEmail(d) / paidReceiptEmail(d) / overdueReminderEmail(d): { subject: string; html: string }`

- [ ] **Step 1: Write the failing test**

Create `lib/billing/invoice-emails.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  formatDueDate,
  emailLayout,
  invoiceSentEmail,
  paymentFailedEmail,
  paidReceiptEmail,
  overdueReminderEmail,
  type InvoiceEmailData,
} from "./invoice-emails";

const base: InvoiceEmailData = {
  orgName: "Roastwell Coffee",
  periodLabel: "Jun 2026",
  amountDollars: 49.6,
  payUrl: "https://pay.stripe.com/abc",
  dueDateLabel: "July 14, 2026",
};

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("formatDueDate", () => {
  it("formats as 'Month D, YYYY' in UTC", () => {
    expect(formatDueDate(new Date("2026-07-14T00:00:00Z"))).toBe("July 14, 2026");
  });
});

describe("emailLayout", () => {
  it("wraps the body with the Maratus wordmark", () => {
    const html = emailLayout("<p>hi</p>");
    expect(html).toContain("Maratus");
    expect(html).toContain("<p>hi</p>");
  });
});

describe("invoice email builders", () => {
  it("invoiceSentEmail: subject names the period, body has amount + pay link", () => {
    const { subject, html } = invoiceSentEmail(base);
    expect(subject).toBe("Your Maratus invoice for Jun 2026");
    expect(html).toContain("$49.60");
    expect(html).toContain("https://pay.stripe.com/abc");
  });

  it("paymentFailedEmail: subject signals failure, body has the update-payment link", () => {
    const { subject, html } = paymentFailedEmail(base);
    expect(subject).toBe("Payment failed for your Maratus invoice");
    expect(html).toContain("https://pay.stripe.com/abc");
    expect(html).toContain("$49.60");
  });

  it("paidReceiptEmail: confirmation with amount and NO pay link", () => {
    const { subject, html } = paidReceiptEmail(base);
    expect(subject).toBe("Payment received — Jun 2026");
    expect(html).toContain("$49.60");
    expect(html).not.toContain("https://pay.stripe.com/abc");
  });

  it("overdueReminderEmail: subject signals overdue, body has the pay link", () => {
    const { subject, html } = overdueReminderEmail(base);
    expect(subject).toBe("Your Maratus invoice is overdue");
    expect(html).toContain("https://pay.stripe.com/abc");
  });

  it("escapes a malicious org name in every builder", () => {
    const evil = { ...base, orgName: `<script>alert(1)</script>` };
    for (const build of [invoiceSentEmail, paymentFailedEmail, paidReceiptEmail, overdueReminderEmail]) {
      const { html } = build(evil);
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/billing/invoice-emails.test.ts`
Expected: FAIL — `Cannot find module './invoice-emails'`.

- [ ] **Step 3: Write the implementation**

Create `lib/billing/invoice-emails.ts`:

```ts
// lib/billing/invoice-emails.ts
// Phase 1C — invoice transition emails. The four builders are PURE (data in →
// {subject, html} out), mirroring lib/alerts.ts so they unit-test without IO.
// The one IO helper (getOrgEmailContext) is added in a later task. Org names are
// user-controlled, so escapeHtml() guards every interpolation of them.

export interface InvoiceEmailData {
  orgName: string;
  periodLabel: string;       // e.g. "Jun 2026" (from invoicePeriodLabel)
  amountDollars: number;     // amountDueCents / 100
  payUrl: string;            // hostedInvoiceUrl, or a billing-page fallback (caller resolves)
  dueDateLabel?: string;     // e.g. "July 14, 2026"
}

const BRAND = "Maratus";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDueDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function money(d: number): string {
  return `$${d.toFixed(2)}`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${url}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${label}</a></p>`;
}

/** Wrap a body fragment in the shared branded shell. */
export function emailLayout(bodyHtml: string): string {
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#111">` +
    `<div style="font-weight:700;font-size:18px;margin-bottom:20px">${BRAND}</div>` +
    bodyHtml +
    `<hr style="border:none;border-top:1px solid #eee;margin:28px 0"/>` +
    `<p style="color:#888;font-size:12px">${BRAND} — paperless documents. Manage billing in your dashboard.</p>` +
    `</div>`
  );
}

export function invoiceSentEmail(d: InvoiceEmailData): { subject: string; html: string } {
  const due = d.dueDateLabel ? `, due ${escapeHtml(d.dueDateLabel)}` : "";
  const body =
    `<p>Hi ${escapeHtml(d.orgName)},</p>` +
    `<p>Your invoice for <strong>${escapeHtml(d.periodLabel)}</strong> is ready: <strong>${money(d.amountDollars)}</strong>${due}.</p>` +
    button(d.payUrl, "Pay invoice");
  return { subject: `Your ${BRAND} invoice for ${d.periodLabel}`, html: emailLayout(body) };
}

export function paymentFailedEmail(d: InvoiceEmailData): { subject: string; html: string } {
  const body =
    `<p>Hi ${escapeHtml(d.orgName)},</p>` +
    `<p>We couldn't process payment for your <strong>${escapeHtml(d.periodLabel)}</strong> invoice (${money(d.amountDollars)}). Please update your payment method to avoid interruption.</p>` +
    button(d.payUrl, "Update payment");
  return { subject: `Payment failed for your ${BRAND} invoice`, html: emailLayout(body) };
}

export function paidReceiptEmail(d: InvoiceEmailData): { subject: string; html: string } {
  const body =
    `<p>Hi ${escapeHtml(d.orgName)},</p>` +
    `<p>We received your payment of <strong>${money(d.amountDollars)}</strong> for <strong>${escapeHtml(d.periodLabel)}</strong>. Thank you!</p>`;
  return { subject: `Payment received — ${d.periodLabel}`, html: emailLayout(body) };
}

export function overdueReminderEmail(d: InvoiceEmailData): { subject: string; html: string } {
  const was = d.dueDateLabel ? ` (was due ${escapeHtml(d.dueDateLabel)})` : "";
  const body =
    `<p>Hi ${escapeHtml(d.orgName)},</p>` +
    `<p>Your <strong>${escapeHtml(d.periodLabel)}</strong> invoice (${money(d.amountDollars)}) is past due${was}. Please pay now to avoid interruption of service.</p>` +
    button(d.payUrl, "Pay now");
  return { subject: `Your ${BRAND} invoice is overdue`, html: emailLayout(body) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/billing/invoice-emails.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm run test && npx tsc --noEmit`
Expected: all green (270 + new), no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/billing/invoice-emails.ts lib/billing/invoice-emails.test.ts
git commit -m "feat(billing): pure invoice transition email builders (1C)"
```

---

### Task 2: Recipient helper + invoice-sent & overdue call sites

**Files:**
- Modify: `lib/billing/invoice-emails.ts` (add `getOrgEmailContext`)
- Modify: `lib/billing/stripe-billing.ts` (invoice-sent on send_invoice path)
- Modify: `lib/billing/billing-cron.ts` (overdue reminder in the sweep)

**Interfaces:**
- Consumes: the four builders + `formatDueDate` (Task 1); `invoicePeriodLabel` (`lib/billing/invoice-collect.ts`); `sendEmail` (`lib/email`); `getEnv` (`lib/env`).
- Produces: `getOrgEmailContext(organizationId: string): Promise<{ ownerEmail: string | null; orgName: string }>` (consumed by Task 3 too).

- [ ] **Step 1: Add `getOrgEmailContext` to `lib/billing/invoice-emails.ts`**

Append (this is the module's only IO — the builders above stay pure):

```ts
import { db } from "@/lib/db";
import { member, user, organization } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** Resolve the org owner's email (fallback: any member) + the org name, for
 * addressing/personalising a transition email. ownerEmail is null when the org
 * has no members. */
export async function getOrgEmailContext(
  organizationId: string,
): Promise<{ ownerEmail: string | null; orgName: string }> {
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  const rows = await db
    .select({ email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, organizationId));

  const owner = rows.find((r) => r.role === "owner") ?? rows[0] ?? null;
  return { ownerEmail: owner?.email ?? null, orgName: org?.name ?? "your organization" };
}
```

(Put the `import` lines at the TOP of the file with the others — shown here inline for clarity.)

- [ ] **Step 2: Send the invoice-sent email in `sendInvoiceToStripe`**

In `lib/billing/stripe-billing.ts`, add imports at the top:

```ts
import { invoicePeriodLabel } from "./invoice-collect";
import { getOrgEmailContext, invoiceSentEmail, formatDueDate } from "./invoice-emails";
import { sendEmail } from "@/lib/email";
import { getEnv } from "@/lib/env";
```

Then, immediately AFTER the `.update(invoiceTable).set({...status:"sent"...})` persist block and BEFORE the `return { ok:true, ... }`, insert:

```ts
  // 1C: notify the tenant owner only on the send_invoice (pay-link) path. For
  // charge_automatically there's nothing to pay; paid/failed emails cover it.
  if (params.collectionMethod === "send_invoice") {
    const { ownerEmail, orgName } = await getOrgEmailContext(inv.organizationId);
    if (ownerEmail) {
      const mail = invoiceSentEmail({
        orgName,
        periodLabel: invoicePeriodLabel(inv.periodStart),
        amountDollars: inv.amountDueCents / 100,
        payUrl: finalized.hosted_invoice_url ?? `${getEnv().BETTER_AUTH_URL}/tenant/billing`,
        dueDateLabel:
          finalized.due_date != null ? formatDueDate(new Date(finalized.due_date * 1000)) : undefined,
      });
      await sendEmail(ownerEmail, mail.subject, mail.html);
    }
  }
```

(`inv` is the full invoice row already in scope; `finalized` is the Stripe invoice already in scope. `sendEmail` never throws, so this can't break the send flow.)

- [ ] **Step 3: Send the overdue reminder in the cron sweep**

In `lib/billing/billing-cron.ts`, first widen the sweep `.returning(...)` so the email has the fields it needs. The current returning is:

```ts
    .returning({
      id: invoiceTable.id,
      organizationId: invoiceTable.organizationId,
      dueDate: invoiceTable.dueDate,
    });
```

Change it to:

```ts
    .returning({
      id: invoiceTable.id,
      organizationId: invoiceTable.organizationId,
      dueDate: invoiceTable.dueDate,
      periodStart: invoiceTable.periodStart,
      amountDueCents: invoiceTable.amountDueCents,
      hostedInvoiceUrl: invoiceTable.hostedInvoiceUrl,
    });
```

Add imports at the top of `billing-cron.ts`:

```ts
import { invoicePeriodLabel } from "./invoice-collect";
import { getOrgEmailContext, overdueReminderEmail, formatDueDate } from "./invoice-emails";
import { sendEmail } from "@/lib/email";
import { getEnv } from "@/lib/env";
```

Then in the `for (const row of swept) { ... }` loop, after the existing `recordAudit(...)` call, add:

```ts
    const { ownerEmail, orgName } = await getOrgEmailContext(row.organizationId);
    if (ownerEmail) {
      const mail = overdueReminderEmail({
        orgName,
        periodLabel: invoicePeriodLabel(row.periodStart),
        amountDollars: row.amountDueCents / 100,
        payUrl: row.hostedInvoiceUrl ?? `${getEnv().BETTER_AUTH_URL}/tenant/billing`,
        dueDateLabel: row.dueDate ? formatDueDate(row.dueDate) : undefined,
      });
      await sendEmail(ownerEmail, mail.subject, mail.html);
    }
```

- [ ] **Step 4: Typecheck + build + suite**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: no type errors; build OK; tests green (no existing test exercises these IO paths).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/invoice-emails.ts lib/billing/stripe-billing.ts lib/billing/billing-cron.ts
git commit -m "feat(billing): invoice-sent + overdue-reminder emails + getOrgEmailContext (1C)"
```

---

### Task 3: Payment-failed + paid emails in the Stripe webhook

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`

**Interfaces:**
- Consumes: `getOrgEmailContext`, `paymentFailedEmail`, `paidReceiptEmail` (Tasks 1–2); `invoicePeriodLabel` (`lib/billing/invoice-collect.ts`); `sendEmail` (`lib/email`); `getEnv` (already imported in this file).

- [ ] **Step 1: Add imports**

In `app/api/stripe/webhook/route.ts`, add to the imports:

```ts
import { after } from "next/server";
import { invoicePeriodLabel } from "@/lib/billing/invoice-collect";
import { getOrgEmailContext, paymentFailedEmail, paidReceiptEmail } from "@/lib/billing/invoice-emails";
import { sendEmail } from "@/lib/email";
```

(`NextResponse`, `db`, `invoiceTable`, `eq`, `getEnv`, `recordAudit`, `AUDIT` are already imported.)

- [ ] **Step 2: Send the payment-failed email**

In the `invoice.payment_failed` branch, the current code is:

```ts
          if (event.type === "invoice.payment_failed") {
            await db.update(invoiceTable).set({ status: "overdue" }).where(eq(invoiceTable.stripeInvoiceId, si.id));
            await recordAudit({ organizationId: row.org, actor: { type: "stripe" }, action: AUDIT.invoicePaymentFailed, target: { type: "invoice", id: si.id }, metadata: { amountDueCents: si.amount_due } });
          } else if (event.type === "invoice.paid") {
```

Insert an `after(...)` email send right after the `recordAudit` for payment_failed (still inside that `if` block):

```ts
          if (event.type === "invoice.payment_failed") {
            await db.update(invoiceTable).set({ status: "overdue" }).where(eq(invoiceTable.stripeInvoiceId, si.id));
            await recordAudit({ organizationId: row.org, actor: { type: "stripe" }, action: AUDIT.invoicePaymentFailed, target: { type: "invoice", id: si.id }, metadata: { amountDueCents: si.amount_due } });
            const orgId = row.org;
            const stripeInvoiceId = si.id;
            after(async () => {
              const [invRow] = await db.select().from(invoiceTable).where(eq(invoiceTable.stripeInvoiceId, stripeInvoiceId)).limit(1);
              if (!invRow) return;
              const { ownerEmail, orgName } = await getOrgEmailContext(orgId);
              if (!ownerEmail) return;
              const mail = paymentFailedEmail({
                orgName,
                periodLabel: invoicePeriodLabel(invRow.periodStart),
                amountDollars: invRow.amountDueCents / 100,
                payUrl: invRow.hostedInvoiceUrl ?? `${getEnv().BETTER_AUTH_URL}/tenant/billing`,
              });
              await sendEmail(ownerEmail, mail.subject, mail.html);
            });
          } else if (event.type === "invoice.paid") {
```

- [ ] **Step 3: Send the paid-receipt email**

In the `invoice.paid` branch, the current code is:

```ts
          } else if (event.type === "invoice.paid") {
            await recordAudit({ organizationId: row.org, actor: { type: "stripe" }, action: AUDIT.invoicePaid, target: { type: "invoice", id: si.id }, metadata: { amountDueCents: si.amount_due } });
          } else if (event.type === "invoice.voided") {
```

Add an `after(...)` send after that `recordAudit`:

```ts
          } else if (event.type === "invoice.paid") {
            await recordAudit({ organizationId: row.org, actor: { type: "stripe" }, action: AUDIT.invoicePaid, target: { type: "invoice", id: si.id }, metadata: { amountDueCents: si.amount_due } });
            const orgId = row.org;
            const stripeInvoiceId = si.id;
            after(async () => {
              const [invRow] = await db.select().from(invoiceTable).where(eq(invoiceTable.stripeInvoiceId, stripeInvoiceId)).limit(1);
              if (!invRow) return;
              const { ownerEmail, orgName } = await getOrgEmailContext(orgId);
              if (!ownerEmail) return;
              const mail = paidReceiptEmail({
                orgName,
                periodLabel: invoicePeriodLabel(invRow.periodStart),
                amountDollars: invRow.amountDueCents / 100,
                payUrl: invRow.hostedInvoiceUrl ?? `${getEnv().BETTER_AUTH_URL}/tenant/billing`,
              });
              await sendEmail(ownerEmail, mail.subject, mail.html);
            });
          } else if (event.type === "invoice.voided") {
```

(`payUrl` is required by `InvoiceEmailData` but `paidReceiptEmail` ignores it — passing it keeps the shape uniform.)

- [ ] **Step 4: Typecheck + build + suite**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: no type errors; build OK (the webhook route still compiles with the new `after()` blocks); 270+ green.

- [ ] **Step 5: Commit**

```bash
git add app/api/stripe/webhook/route.ts
git commit -m "feat(billing): payment-failed + paid receipt emails via after() in the Stripe webhook (1C)"
```

---

## Deferred acceptance (user — needs RESEND_API_KEY + delivery)

- Optional live check: with `RESEND_API_KEY` set, trigger one path (e.g. mark a draft sent on the send_invoice path, or pay/fail a test invoice) and confirm an email lands at `erenaltan@gmail.com`.
- **Resend domain verification** — unblocks delivery to real tenant addresses (otherwise only `erenaltan@gmail.com` receives).
- Optional: disable Stripe's own hosted-invoice email in the Stripe dashboard to avoid the `send_invoice` double-send.

---

## Self-Review

**Spec coverage:**
- Four pure builders + escapeHtml + shared `emailLayout` (spec §A) → Task 1. ✅
- `getOrgEmailContext` recipient resolution (spec §B) → Task 2. ✅
- Invoice-sent on send_invoice path + overdue in cron (spec §D items 1 & 4) → Task 2. ✅
- Payment-failed + paid via `after()` in the webhook (spec §D items 2 & 3) → Task 3. ✅
- HTML-escaping of org name, never-throw/no-op send, pay-link fallback (spec decisions 5/6 + §error-handling) → Tasks 1–3. ✅
- Testing: pure builder unit tests incl. injection (spec §Testing) → Task 1; IO paths verified by build/tsc. ✅

**Placeholder scan:** None — every step shows complete code. ✅

**Type consistency:** `InvoiceEmailData` shape (Task 1) is consumed identically in Tasks 2 & 3 (always passing `payUrl`; `dueDateLabel` only where relevant); `getOrgEmailContext` return `{ ownerEmail, orgName }` matches all call sites; `invoicePeriodLabel(periodStart: Date)` reused consistently; `formatDueDate(Date)` used for `dueDateLabel`. ✅

**Note for implementers:** `sendEmail` returns a boolean that all call sites intentionally ignore (fire-and-forget; it never throws). The webhook `after()` callbacks re-read the invoice row by `stripeInvoiceId` because the upsert at the top of the case has already persisted it before `after()` runs.
