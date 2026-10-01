# Phase 1A — Invoice Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a locally-generated invoice collectible by pushing it to Stripe (hybrid collection, Net 14) when it is sent, reusing the existing webhook to reconcile `paid`/`payment_failed`/`voided` back to the local row.

**Architecture:** A pure, unit-tested param-builder (`lib/billing/invoice-collect.ts`) maps a local invoice row → Stripe invoice-create params; an IO orchestrator (`sendInvoiceToStripe` in `lib/billing/stripe-billing.ts`) creates+finalizes the Stripe invoice and persists `stripeInvoiceId`/`hostedInvoiceUrl`/`status`; the platform-admin action layer (`lib/actions/billing.ts`) repurposes the draft→sent transition to call it, adds a `voidInvoice` action, and audits; the admin row-actions UI gains a Void item and the tenant billing page relabels its existing link to "Pay".

**Tech Stack:** Next.js 16 server actions, Drizzle over Neon, `stripe` Node SDK (test mode), Vitest (pure functions only — no DB harness in this repo).

## Global Constraints

- **Billing model = Model 1.** Local monthly invoices are the source of truth; "send" pushes them to Stripe. Credits stay orthogonal — do not touch credit code.
- **Collection = hybrid.** Card on file (`tenantSettings.cardLast4` non-null) → `charge_automatically`; otherwise → `send_invoice` with `days_until_due: 14`.
- **Currency `usd`, no tax** (YAGNI).
- **Idempotent send:** if `invoice.stripeInvoiceId` is already set, never create a second Stripe invoice.
- **$0 invoices cannot be sent** — return a typed error, leave the row `draft`.
- **Graceful Stripe-absent:** when `stripe` is `null` (no `STRIPE_SECRET_KEY`), the send path returns a typed `stripe_disabled` error and never throws to the UI.
- **Money is integer cents** end-to-end; the UI divides by 100.
- Existing webhook (`app/api/stripe/webhook/route.ts`) and `upsertInvoiceFromStripe` are **unchanged** — they already handle `invoice.finalized/paid/payment_failed/voided`.
- Verification: `npm run test` (currently 254, stays green), `npm run build`, `npx tsc --noEmit` all clean per task. The local dev server runs on **:3001** (not :3000).

## File Map

| File | Responsibility | Task |
|---|---|---|
| `lib/billing/invoice-collect.ts` (new) | Pure: `stripeInvoiceParamsFor` + `invoicePeriodLabel` | 1 |
| `lib/billing/invoice-collect.test.ts` (new) | Unit tests for the pure builder | 1 |
| `lib/billing/stripe-billing.ts` (modify) | New IO `sendInvoiceToStripe` | 2 |
| `lib/audit.ts` (modify) | Add `AUDIT.invoiceSent` | 3 |
| `lib/actions/billing.ts` (modify) | Repurpose `advanceInvoice` draft path; new `voidInvoice`; audit | 3 |
| `components/invoice-row-actions.tsx` (modify) | Add Void; draft "Mark as sent" now does the real send | 4 |
| `app/(tenant)/tenant/billing/page.tsx` (modify) | Relabel the invoice link to "Pay"/"View" by status | 4 |

---

### Task 1: Pure Stripe-invoice param builder

**Files:**
- Create: `lib/billing/invoice-collect.ts`
- Test: `lib/billing/invoice-collect.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `invoicePeriodLabel(periodStart: Date): string` → e.g. `"Jun 2026"`.
  - `interface StripeInvoiceParams { collectionMethod: "charge_automatically" | "send_invoice"; daysUntilDue: number | null; item: { amountCents: number; currency: "usd"; description: string } }`
  - `stripeInvoiceParamsFor(invoice: { amountDueCents: number; documentCount: number; unitPriceCents: number; periodStart: Date }, opts: { hasCard: boolean }): StripeInvoiceParams`

- [ ] **Step 1: Write the failing test**

Create `lib/billing/invoice-collect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { stripeInvoiceParamsFor, invoicePeriodLabel } from "./invoice-collect";

const base = {
  amountDueCents: 4960,
  documentCount: 1240,
  unitPriceCents: 4,
  periodStart: new Date("2026-06-01T00:00:00.000Z"),
};

describe("invoicePeriodLabel", () => {
  it("formats the period as 'Mon YYYY' in UTC", () => {
    expect(invoicePeriodLabel(new Date("2026-06-01T00:00:00.000Z"))).toBe("Jun 2026");
    expect(invoicePeriodLabel(new Date("2026-12-31T23:59:59.999Z"))).toBe("Dec 2026");
  });
});

describe("stripeInvoiceParamsFor", () => {
  it("uses charge_automatically with no due date when a card is on file", () => {
    const p = stripeInvoiceParamsFor(base, { hasCard: true });
    expect(p.collectionMethod).toBe("charge_automatically");
    expect(p.daysUntilDue).toBeNull();
  });

  it("uses send_invoice with Net 14 when there is no card", () => {
    const p = stripeInvoiceParamsFor(base, { hasCard: false });
    expect(p.collectionMethod).toBe("send_invoice");
    expect(p.daysUntilDue).toBe(14);
  });

  it("passes the amount through and builds a usd line item", () => {
    const p = stripeInvoiceParamsFor(base, { hasCard: false });
    expect(p.item.amountCents).toBe(4960);
    expect(p.item.currency).toBe("usd");
  });

  it("describes the line with period, count (thousands-separated) and unit price", () => {
    const p = stripeInvoiceParamsFor(base, { hasCard: false });
    expect(p.item.description).toBe("Documents — Jun 2026: 1,240 × $0.04");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/billing/invoice-collect.test.ts`
Expected: FAIL — `Cannot find module './invoice-collect'`.

- [ ] **Step 3: Write the implementation**

Create `lib/billing/invoice-collect.ts`:

```ts
// lib/billing/invoice-collect.ts
// Pure, IO-free builder that maps a local invoice row onto the params for a
// Stripe one-off invoice (Phase 1A). No DB/env/Stripe imports — unit-tested in
// isolation; the IO that uses this lives in stripe-billing.ts (sendInvoiceToStripe).

export interface StripeInvoiceParams {
  collectionMethod: "charge_automatically" | "send_invoice";
  // null for charge_automatically; the Net-N day count for send_invoice.
  daysUntilDue: number | null;
  item: { amountCents: number; currency: "usd"; description: string };
}

const SEND_INVOICE_NET_DAYS = 14;

/** Format an invoice period as e.g. "Jun 2026" (UTC, so it matches periodStart). */
export function invoicePeriodLabel(periodStart: Date): string {
  return periodStart.toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function stripeInvoiceParamsFor(
  invoice: {
    amountDueCents: number;
    documentCount: number;
    unitPriceCents: number;
    periodStart: Date;
  },
  opts: { hasCard: boolean },
): StripeInvoiceParams {
  const collectionMethod = opts.hasCard ? "charge_automatically" : "send_invoice";
  const unitPrice = (invoice.unitPriceCents / 100).toFixed(2);
  const description = `Documents — ${invoicePeriodLabel(invoice.periodStart)}: ${invoice.documentCount.toLocaleString("en-US")} × $${unitPrice}`;
  return {
    collectionMethod,
    daysUntilDue: opts.hasCard ? null : SEND_INVOICE_NET_DAYS,
    item: { amountCents: invoice.amountDueCents, currency: "usd", description },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/billing/invoice-collect.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm run test && npx tsc --noEmit`
Expected: all tests pass (258 now), no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/billing/invoice-collect.ts lib/billing/invoice-collect.test.ts
git commit -m "feat(billing): pure Stripe-invoice param builder for invoice collection (1A)"
```

---

### Task 2: `sendInvoiceToStripe` IO orchestration

**Files:**
- Modify: `lib/billing/stripe-billing.ts`

**Interfaces:**
- Consumes: `stripeInvoiceParamsFor` (Task 1); `ensureStripeCustomer` (existing, same file); `stripe` (`lib/stripe.ts`); `invoice`/`tenantSettings` tables (`lib/db/schema.ts`).
- Produces:
  ```ts
  export async function sendInvoiceToStripe(invoiceId: string): Promise<
    | { ok: true; stripeInvoiceId: string; hostedInvoiceUrl: string | null; collectionMethod: "charge_automatically" | "send_invoice" }
    | { ok: false; reason: "not_found" | "already_sent" | "no_amount" | "stripe_disabled" }
  >;
  ```
  (Returns a result object; does **not** throw for the expected failure cases. Records no audit — the action layer does that with the real actor.)

This is IO; the repo has no DB test harness, so it is verified by `tsc`/`build` and the live smoke in Task 4 (matching the existing convention for `ensureStripeCustomer`/`upsertInvoiceFromStripe`, which have no unit tests).

- [ ] **Step 1: Add imports**

In `lib/billing/stripe-billing.ts`, extend the existing imports. The file currently imports `{ tenantSettings }` from schema and `{ eq }` from drizzle — add the `invoice` table and the param builder:

```ts
import { tenantSettings, invoice as invoiceTable } from "@/lib/db/schema";
import { stripeInvoiceParamsFor } from "./invoice-collect";
```

(Keep the existing `import { eq } from "drizzle-orm"` and the other current imports.)

- [ ] **Step 2: Implement `sendInvoiceToStripe`**

Append to `lib/billing/stripe-billing.ts`:

```ts
/**
 * Phase 1A — push a locally-generated invoice to Stripe so it can collect.
 * Hybrid collection: charge_automatically when the org has a saved card, else
 * send_invoice (Net 14, Stripe emails the hosted page). Idempotent: a row that
 * already has a stripeInvoiceId is a no-op. The webhook reconciles paid/failed.
 */
export async function sendInvoiceToStripe(invoiceId: string): Promise<
  | {
      ok: true;
      stripeInvoiceId: string;
      hostedInvoiceUrl: string | null;
      collectionMethod: "charge_automatically" | "send_invoice";
    }
  | { ok: false; reason: "not_found" | "already_sent" | "no_amount" | "stripe_disabled" }
> {
  if (!stripe) return { ok: false, reason: "stripe_disabled" };
  const s = stripe;

  const [inv] = await db
    .select()
    .from(invoiceTable)
    .where(eq(invoiceTable.id, invoiceId))
    .limit(1);
  if (!inv) return { ok: false, reason: "not_found" };
  if (inv.stripeInvoiceId) return { ok: false, reason: "already_sent" };
  if (inv.amountDueCents <= 0) return { ok: false, reason: "no_amount" };

  const customerId = await ensureStripeCustomer(inv.organizationId);

  const [settings] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, inv.organizationId))
    .limit(1);
  const hasCard = settings?.cardLast4 != null;

  const params = stripeInvoiceParamsFor(
    {
      amountDueCents: inv.amountDueCents,
      documentCount: inv.documentCount,
      unitPriceCents: inv.unitPriceCents,
      periodStart: inv.periodStart,
    },
    { hasCard },
  );

  // Create the invoice first so the item can attach to it explicitly.
  const created = await s.invoices.create({
    customer: customerId,
    collection_method: params.collectionMethod,
    ...(params.daysUntilDue != null ? { days_until_due: params.daysUntilDue } : {}),
    auto_advance: false,
    metadata: { organizationId: inv.organizationId, localInvoiceId: inv.id },
  });

  await s.invoiceItems.create({
    customer: customerId,
    invoice: created.id,
    amount: params.item.amountCents,
    currency: params.item.currency,
    description: params.item.description,
  });

  // Finalize: charge_automatically attempts the charge now; either way we get
  // the hosted_invoice_url. For send_invoice, email the hosted page.
  const finalized = await s.invoices.finalizeInvoice(created.id);
  if (params.collectionMethod === "send_invoice") {
    await s.invoices.sendInvoice(finalized.id);
  }

  await db
    .update(invoiceTable)
    .set({
      stripeInvoiceId: finalized.id,
      hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
      status: "sent",
    })
    .where(eq(invoiceTable.id, inv.id));

  return {
    ok: true,
    stripeInvoiceId: finalized.id,
    hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
    collectionMethod: params.collectionMethod,
  };
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds. (If the Stripe SDK's `Invoice.id` is typed `string | undefined`, narrow with a guard: `if (!created.id) throw new Error("Stripe invoice has no id")` right after `invoices.create`, before the item create.)

- [ ] **Step 4: Run the suite**

Run: `npm run test`
Expected: still green (no behavior touched by existing tests).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/stripe-billing.ts
git commit -m "feat(billing): sendInvoiceToStripe — create+finalize a payable Stripe invoice (1A)"
```

---

### Task 3: Action layer — repurpose draft→sent, add `voidInvoice`, audit

**Files:**
- Modify: `lib/audit.ts`
- Modify: `lib/actions/billing.ts`

**Interfaces:**
- Consumes: `sendInvoiceToStripe` (Task 2); `requirePlatformAdmin(): Promise<AppContext>` where `AppContext.user = { id; name; email; role }`; `recordAudit`; `stripe` (`lib/stripe.ts`).
- Produces: `voidInvoice(invoiceId: string): Promise<InvoiceActionResult>`; repurposed `advanceInvoice`; `AUDIT.invoiceSent = "invoice.sent"`.

- [ ] **Step 1: Add the audit constant**

In `lib/audit.ts`, inside the `AUDIT` object (after `invoiceVoid: "invoice.void",`), add:

```ts
  invoiceSent: "invoice.sent",
```

- [ ] **Step 2: Repurpose `advanceInvoice` so the draft→sent step pushes to Stripe**

In `lib/actions/billing.ts`, update the imports at the top to add what the action needs:

```ts
import { sendInvoiceToStripe } from "@/lib/billing/stripe-billing";
import { stripe } from "@/lib/stripe";
import { recordAudit, AUDIT } from "@/lib/audit";
```

Then replace the body of `advanceInvoice` (currently lines 41–64) with:

```ts
/** Advance an invoice. draft → sent now creates a payable Stripe invoice; sent → paid is a manual override. */
export async function advanceInvoice(
  invoiceId: string,
): Promise<InvoiceActionResult> {
  const ctx = await requirePlatformAdmin();

  const [inv] = await db
    .select()
    .from(invoiceTable)
    .where(eq(invoiceTable.id, invoiceId))
    .limit(1);
  if (!inv) return { ok: false, error: "Invoice not found." };

  if (inv.status === "draft") {
    const res = await sendInvoiceToStripe(invoiceId);
    if (!res.ok) {
      const message: Record<typeof res.reason, string> = {
        not_found: "Invoice not found.",
        already_sent: "Invoice was already sent.",
        no_amount: "Nothing to collect — this invoice is $0.",
        stripe_disabled: "Billing is not configured.",
      };
      return { ok: false, error: message[res.reason] };
    }
    await recordAudit({
      organizationId: inv.organizationId,
      actor: { type: "user", id: ctx.user.id, label: ctx.user.name || ctx.user.email },
      action: AUDIT.invoiceSent,
      target: { type: "invoice", id: invoiceId },
      metadata: {
        stripeInvoiceId: res.stripeInvoiceId,
        collectionMethod: res.collectionMethod,
        amountDueCents: inv.amountDueCents,
      },
    });
    revalidatePath("/admin/billing");
    revalidatePath("/admin");
    return { ok: true };
  }

  const next = NEXT_STATUS[inv.status];
  if (!next) return { ok: false, error: "Invoice is already paid." };

  await db
    .update(invoiceTable)
    .set({ status: next })
    .where(eq(invoiceTable.id, invoiceId));

  revalidatePath("/admin/billing");
  revalidatePath("/admin");
  return { ok: true };
}
```

(Leave `NEXT_STATUS`, `generateInvoices`, and `setInvoiceStatus` as they are. `setInvoiceStatus` stays the manual "Mark as paid" override.)

- [ ] **Step 3: Add the `voidInvoice` action**

Append to `lib/actions/billing.ts`:

```ts
/** Void an invoice. If it has a Stripe invoice, void it there too (webhook reconciles); else flip locally. Paid invoices cannot be voided. */
export async function voidInvoice(
  invoiceId: string,
): Promise<InvoiceActionResult> {
  const ctx = await requirePlatformAdmin();

  const [inv] = await db
    .select()
    .from(invoiceTable)
    .where(eq(invoiceTable.id, invoiceId))
    .limit(1);
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status === "void") return { ok: false, error: "Invoice is already void." };
  if (inv.status === "paid") return { ok: false, error: "Cannot void a paid invoice." };

  if (inv.stripeInvoiceId && stripe) {
    try {
      await stripe.invoices.voidInvoice(inv.stripeInvoiceId);
    } catch {
      return { ok: false, error: "Could not void the invoice in Stripe." };
    }
  }

  await db
    .update(invoiceTable)
    .set({ status: "void" })
    .where(eq(invoiceTable.id, invoiceId));

  await recordAudit({
    organizationId: inv.organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.name || ctx.user.email },
    action: AUDIT.invoiceVoid,
    target: { type: "invoice", id: invoiceId },
    metadata: { stripeInvoiceId: inv.stripeInvoiceId ?? null },
  });

  revalidatePath("/admin/billing");
  revalidatePath("/admin");
  return { ok: true };
}
```

- [ ] **Step 4: Typecheck + build + suite**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: no type errors, build OK, tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/audit.ts lib/actions/billing.ts
git commit -m "feat(billing): draft->sent pushes to Stripe + voidInvoice action + audit (1A)"
```

---

### Task 4: UI — admin Void action + tenant "Pay" link

**Files:**
- Modify: `components/invoice-row-actions.tsx`
- Modify: `app/(tenant)/tenant/billing/page.tsx`

**Interfaces:**
- Consumes: `advanceInvoice`, `setInvoiceStatus`, `voidInvoice` (Task 3); `InvoiceLifecycle = "draft" | "sent" | "paid" | "overdue" | "void"`.
- Produces: no new exports.

- [ ] **Step 1: Add a Void action to the admin row menu**

In `components/invoice-row-actions.tsx`:

a) Extend the import on line 14 and the icon import on line 5:

```ts
import { Check, Loader2, MoreHorizontal, Send, Ban } from "lucide-react";
```
```ts
import { advanceInvoice, setInvoiceStatus, voidInvoice } from "@/lib/actions/billing";
```

b) The early `if (lifecycle === "paid")` block stays (paid rows show "Settled", no menu). Add a matching early return for `void` so voided rows don't show actions — insert right after the `paid` block:

```tsx
  if (lifecycle === "void") {
    return <span className="text-xs text-muted-foreground">Void</span>;
  }
```

c) Add a Void menu item inside `<DropdownMenuContent>`, after the "Mark as paid" item:

```tsx
        <DropdownMenuItem
          onClick={() => run(() => voidInvoice(invoiceId), "Invoice voided")}
        >
          <Ban className="size-4" /> Void
        </DropdownMenuItem>
```

(The draft "Mark as sent" item is unchanged — it already calls `advanceInvoice`, which now performs the real Stripe send and surfaces any error via the existing `run()` toast on `!res.ok`.)

- [ ] **Step 2: Relabel the tenant invoice link to "Pay" when payable**

In `app/(tenant)/tenant/billing/page.tsx`, the invoice row currently renders (around lines 106–111):

```tsx
                    {inv.hostedInvoiceUrl ? (
                      <a className="underline" href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                        View
                      </a>
                    ) : null}
```

Replace the link text with a status-aware label (payable statuses say "Pay"):

```tsx
                    {inv.hostedInvoiceUrl ? (
                      <a className="underline" href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                        {inv.status === "sent" || inv.status === "overdue" ? "Pay" : "View"}
                      </a>
                    ) : null}
```

(`inv.status` is the raw DB lifecycle string from `getTenantBilling` — no data-layer change needed.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 4: Live smoke test (Stripe test mode, dev server on :3001)**

Start the dev server (`npm run dev`) and, signed in as the platform admin (`admin@maratus.app`):

1. On `/admin/billing`, generate invoices. Pick a draft with a non-zero amount for an org **without** a saved card → "Mark as sent". Expect success toast; the row becomes `sent`. In Stripe test dashboard the invoice exists with a hosted URL; status `open`; collection `send_invoice`.
2. Open `/tenant/billing` for that org (or check the row): the invoice shows a **"Pay"** link → opens Stripe's hosted page. Pay with `4242 4242 4242 4242`. The `invoice.paid` webhook flips the local row → `paid` (re-check `/admin/billing`).
3. For an org **with** a saved card on file, "Mark as sent" → `charge_automatically`; the `invoice.paid` webhook flips it to `paid` without visiting a hosted page.
4. "Void" a `sent` invoice → toast "Invoice voided"; row becomes `void`; Stripe shows the invoice voided.
5. Re-send (if a draft is somehow re-actioned) is a no-op — `already_sent` surfaces as an error toast; no duplicate Stripe invoice.
6. "Mark as sent" on a **$0** draft → error toast "Nothing to collect — this invoice is $0."; row stays draft.

Record the outcomes in the task report (this is the acceptance evidence for 1A — there is no DB test harness).

- [ ] **Step 5: Commit**

```bash
git add components/invoice-row-actions.tsx "app/(tenant)/tenant/billing/page.tsx"
git commit -m "feat(billing): admin Void action + tenant Pay link for collectible invoices (1A)"
```

---

## Self-Review

**Spec coverage:**
- Pure builder (spec §A) → Task 1. ✅
- `sendInvoiceToStripe` IO incl. hybrid/Net-14/finalize/idempotency/$0/stripe-disabled (spec §B + edge cases) → Task 2. ✅
- Repurpose draft→sent, `voidInvoice`, `AUDIT.invoiceSent`, manual "Mark as paid" kept (spec §C + decisions 3/5) → Task 3. ✅
- Admin Void UI + tenant "Pay" relabel (spec §4) → Task 4. ✅
- Testing: pure unit tests (Task 1) + live smoke covering all six scenarios (Task 4) match spec §Testing. ✅
- Webhook unchanged (spec) — no task touches it. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅

**Type consistency:** `sendInvoiceToStripe` result union (Task 2) matches the `message` map keys and audit usage in Task 3; `stripeInvoiceParamsFor` signature (Task 1) matches its call in Task 2; `collectionMethod` literal union consistent across Tasks 1–3; `inv.status` raw lifecycle used consistently. ✅

**Note for the implementer:** the Stripe SDK types `Invoice.id` / `hosted_invoice_url` as possibly `undefined`/`null` — Task 2 Step 3 calls this out (narrow `created.id` with a guard if `tsc` complains). This is the one spot that may need a one-line adjustment beyond the shown code.
