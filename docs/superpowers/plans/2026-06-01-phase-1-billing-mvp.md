# Phase 1 — Billing MVP (Metered Subscriptions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let tenants subscribe to a metered Stripe plan, report receipt usage to Stripe, and mirror Stripe's generated/charged invoices back into Maratus via webhooks — with an in-app Elements card form and a tenant billing page.

**Architecture:** Stripe owns the billing clock (metered Subscriptions + Billing Meters). Our DB mirrors Stripe through a signed webhook. `lib/stripe.ts` exports a `null`-when-unconfigured client so the app builds and pure tests pass without keys. Pure mapping logic (`statusForStripeInvoice`) is isolated and TDD'd; IO/UI is verified manually in Stripe test mode.

**Tech Stack:** Next.js 16 App Router, Drizzle/Neon, **stripe** (server SDK), **@stripe/stripe-js** + **@stripe/react-stripe-js** (client Elements), vitest.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `lib/stripe.ts` | Guarded server Stripe client (`null` if unconfigured) | Create |
| `lib/billing/stripe-billing.ts` | `ensureStripeCustomer`, `activateBilling`, `reportReceiptUsage`, pure `statusForStripeInvoice` + `meterEventPayload` | Create |
| `lib/billing/stripe-billing.test.ts` | Unit tests for the two pure helpers | Create |
| `lib/billing/invoice-sync.ts` | `upsertInvoiceFromStripe` | Create |
| `scripts/stripe-setup.ts` | One-time Product + Meter + Price creation | Create |
| `app/api/stripe/webhook/route.ts` | Signature-verified event handler | Create |
| `app/api/ingest/route.ts` | Non-blocking meter event after receipt insert | Modify |
| `app/(tenant)/tenant/billing/page.tsx` | Tenant billing page | Create |
| `app/(tenant)/tenant/billing/actions.ts` | `activateBilling` server action | Create |
| `components/billing/payment-method-form.tsx` | Client Elements form | Create |
| `lib/data.ts` | `getTenantBilling(orgId)` view-model | Modify |
| `lib/db/schema.ts` | Add Stripe columns to `tenantSettings` + `invoice` | Modify |
| `lib/env.ts` | Add optional Stripe env | Modify |
| `.env.example` | Document new vars | Modify |

---

## Task 1: Stripe SDK + guarded client + env

**Files:**
- Modify: `package.json` (deps), `lib/env.ts`
- Create: `lib/stripe.ts`

- [ ] **Step 1: Install the SDKs**

```bash
npm install stripe @stripe/stripe-js @stripe/react-stripe-js
```

- [ ] **Step 2: Add optional env** — in `lib/env.ts`, inside `envSchema` after `RESEND_API_KEY`:

```ts
  // Stripe billing. All optional: absent → billing features are inert.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  STRIPE_METER_EVENT_NAME: z.string().default("receipts"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
```

- [ ] **Step 3: Create the guarded client**

```ts
// lib/stripe.ts
// Server-only Stripe client. Exports `null` when STRIPE_SECRET_KEY is unset so
// the app builds and billing features degrade gracefully.

import Stripe from "stripe";
import { getEnv } from "./env";

function build(): Stripe | null {
  const key = getEnv().STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { typescript: true });
}

export const stripe = build();
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/env.ts lib/stripe.ts
git commit -m "feat: add guarded Stripe client and billing env"
```

---

## Task 2: Schema columns + migration

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Add columns to `tenantSettings`** — insert before the `status` line in the `tenantSettings` table:

```ts
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  cardBrand: text("card_brand"),
  cardLast4: text("card_last4"),
```

- [ ] **Step 2: Add columns to `invoice`** — inside the `invoice` table, after the `status` field:

```ts
    stripeInvoiceId: text("stripe_invoice_id"),
    hostedInvoiceUrl: text("hosted_invoice_url"),
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new SQL file under `drizzle/` adding 7 nullable columns. Inspect it — it must be `ALTER TABLE ... ADD COLUMN`, no drops.

- [ ] **Step 4: Apply it** (needs `DATABASE_URL` in `.env.local`)

Run: `npm run db:migrate`
Expected: applies cleanly.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat: add Stripe mirror columns to tenantSettings and invoice"
```

---

## Task 3: Pure helpers (TDD)

**Files:**
- Create: `lib/billing/stripe-billing.test.ts`
- Create: `lib/billing/stripe-billing.ts` (helpers only this task)

- [ ] **Step 1: Write the failing test**

```ts
// lib/billing/stripe-billing.test.ts
import { describe, it, expect } from "vitest";
import { statusForStripeInvoice, meterEventPayload } from "./stripe-billing";

describe("statusForStripeInvoice", () => {
  it("maps draft → draft", () => expect(statusForStripeInvoice("draft")).toBe("draft"));
  it("maps open → sent", () => expect(statusForStripeInvoice("open")).toBe("sent"));
  it("maps paid → paid", () => expect(statusForStripeInvoice("paid")).toBe("paid"));
  it("maps uncollectible → sent", () => expect(statusForStripeInvoice("uncollectible")).toBe("sent"));
  it("maps void → sent", () => expect(statusForStripeInvoice("void")).toBe("sent"));
  it("falls back unknown → sent", () => expect(statusForStripeInvoice("weird")).toBe("sent"));
});

describe("meterEventPayload", () => {
  it("builds a single-unit receipt event", () => {
    expect(meterEventPayload("cus_123", "receipts")).toEqual({
      event_name: "receipts",
      payload: { stripe_customer_id: "cus_123", value: "1" },
    });
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npm test -- lib/billing/stripe-billing.test.ts`
Expected: FAIL ("Cannot find module './stripe-billing'").

- [ ] **Step 3: Implement the helpers**

```ts
// lib/billing/stripe-billing.ts
// Stripe billing: pure mappers (this section) + IO functions (added in Task 5).

type InvoiceStatus = "draft" | "sent" | "paid";

/** Map a Stripe invoice status onto our 3-state enum. */
export function statusForStripeInvoice(stripeStatus: string): InvoiceStatus {
  switch (stripeStatus) {
    case "draft":
      return "draft";
    case "paid":
      return "paid";
    default:
      // open / uncollectible / void → treated as unpaid-but-issued for the MVP.
      return "sent";
  }
}

/** Shape a Billing Meter event reporting one receipt for a customer. */
export function meterEventPayload(stripeCustomerId: string, eventName: string) {
  return {
    event_name: eventName,
    payload: { stripe_customer_id: stripeCustomerId, value: "1" },
  };
}
```

- [ ] **Step 4: Run it — expect pass**

Run: `npm test -- lib/billing/stripe-billing.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/stripe-billing.ts lib/billing/stripe-billing.test.ts
git commit -m "feat: add pure Stripe status + meter-event helpers"
```

---

## Task 4: One-time Stripe setup script

**Files:**
- Create: `scripts/stripe-setup.ts`

- [ ] **Step 1: Write the script**

```ts
// scripts/stripe-setup.ts
// One-time: create the Product, Meter, and metered Price tenants subscribe to.
// Run once per Stripe account: `npx tsx scripts/stripe-setup.ts`
// Copy the printed STRIPE_PRICE_ID into .env.local.

import "@/lib/db/load-env";
import Stripe from "stripe";
import { getEnv } from "@/lib/env";

async function main() {
  const key = getEnv().STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is required to run setup");
  const stripe = new Stripe(key, { typescript: true });
  const eventName = getEnv().STRIPE_METER_EVENT_NAME;

  const product = await stripe.products.create({ name: "Maratus digital receipts" });

  const meter = await stripe.billing.meters.create({
    display_name: "Receipts",
    event_name: eventName,
    default_aggregation: { formula: "sum" },
  });

  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: 4, // $0.04 per receipt
    recurring: { interval: "month", usage_type: "metered", meter: meter.id },
  });

  console.log("Stripe setup complete:");
  console.log(`  product:  ${product.id}`);
  console.log(`  meter:    ${meter.id} (event_name=${eventName})`);
  console.log(`  price:    ${price.id}`);
  console.log(`\nAdd to .env.local:\n  STRIPE_PRICE_ID="${price.id}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run it (needs `STRIPE_SECRET_KEY`)** — captures the price id

Run: `npx tsx scripts/stripe-setup.ts`
Expected: prints product/meter/price ids. Paste `STRIPE_PRICE_ID="price_..."` into `.env.local`.

- [ ] **Step 4: Commit**

```bash
git add scripts/stripe-setup.ts
git commit -m "feat: add one-time Stripe product/meter/price setup script"
```

---

## Task 5: Stripe IO functions (customer, subscription, usage)

**Files:**
- Modify: `lib/billing/stripe-billing.ts`

- [ ] **Step 1: Append the IO functions** to `lib/billing/stripe-billing.ts`:

```ts
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { eq } from "drizzle-orm";

function requireStripe() {
  if (!stripe) throw new Error("Stripe is not configured");
  return stripe;
}

/** Find-or-create the Stripe Customer for an org; persists the id. */
export async function ensureStripeCustomer(organizationId: string): Promise<string> {
  const s = requireStripe();
  const [settings] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, organizationId))
    .limit(1);
  if (settings?.stripeCustomerId) return settings.stripeCustomerId;

  const customer = await s.customers.create({ metadata: { organizationId } });
  await db
    .update(tenantSettings)
    .set({ stripeCustomerId: customer.id })
    .where(eq(tenantSettings.organizationId, organizationId));
  return customer.id;
}

/**
 * Create a metered subscription in `default_incomplete` mode and return the
 * setup-intent client secret (metered first invoice is $0, so Stripe attaches a
 * pending_setup_intent to collect the card).
 */
export async function activateBilling(organizationId: string): Promise<{ clientSecret: string }> {
  const s = requireStripe();
  const priceId = getEnv().STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not configured");

  const customerId = await ensureStripeCustomer(organizationId);
  const sub = await s.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    expand: ["pending_setup_intent"],
  });

  await db
    .update(tenantSettings)
    .set({ stripeSubscriptionId: sub.id, subscriptionStatus: sub.status })
    .where(eq(tenantSettings.organizationId, organizationId));

  const intent = sub.pending_setup_intent;
  if (!intent || typeof intent === "string" || !intent.client_secret) {
    throw new Error("No setup intent returned for subscription");
  }
  return { clientSecret: intent.client_secret };
}

/** Fire one metered usage event for a customer. Caller handles errors. */
export async function reportReceiptUsage(stripeCustomerId: string): Promise<void> {
  const s = requireStripe();
  const { event_name, payload } = meterEventPayload(
    stripeCustomerId,
    getEnv().STRIPE_METER_EVENT_NAME,
  );
  await s.billing.meterEvents.create({ event_name, payload });
}
```

- [ ] **Step 2: Verify type-check + existing tests still pass**

Run: `npx tsc --noEmit && npm test -- lib/billing/stripe-billing.test.ts`
Expected: no type errors; 7 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add lib/billing/stripe-billing.ts
git commit -m "feat: add Stripe customer, subscription, and usage IO"
```

---

## Task 6: Invoice mirror (`upsertInvoiceFromStripe`) — TDD with a mock invoice

**Files:**
- Create: `lib/billing/invoice-sync.ts`
- Create: `lib/billing/invoice-sync.test.ts`

- [ ] **Step 1: Write the failing test** (tests the pure row-mapping, not the DB write)

```ts
// lib/billing/invoice-sync.test.ts
import { describe, it, expect } from "vitest";
import { invoiceRowFromStripe } from "./invoice-sync";

const fakeInvoice = {
  id: "in_123",
  status: "open",
  hosted_invoice_url: "https://pay.stripe.test/in_123",
  amount_due: 1234,
  period_start: 1700000000,
  period_end: 1702592000,
  lines: { data: [{ quantity: 42 }] },
};

describe("invoiceRowFromStripe", () => {
  it("maps a Stripe invoice onto our invoice row shape", () => {
    const row = invoiceRowFromStripe(fakeInvoice as never, "org_1");
    expect(row).toMatchObject({
      organizationId: "org_1",
      stripeInvoiceId: "in_123",
      hostedInvoiceUrl: "https://pay.stripe.test/in_123",
      amountDueCents: 1234,
      status: "sent", // open → sent
      receiptCount: 42,
    });
    expect(row.periodStart).toBeInstanceOf(Date);
    expect(row.periodEnd).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npm test -- lib/billing/invoice-sync.test.ts`
Expected: FAIL ("Cannot find module './invoice-sync'").

- [ ] **Step 3: Implement it**

```ts
// lib/billing/invoice-sync.ts
// Mirror Stripe invoices into our `invoice` table (Stripe is authoritative).

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { invoice, tenantSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { id } from "@/lib/ids";
import { statusForStripeInvoice } from "./stripe-billing";

/** Pure: shape an `invoice` insert row from a Stripe invoice. */
export function invoiceRowFromStripe(si: Stripe.Invoice, organizationId: string) {
  const receiptCount = si.lines?.data?.reduce((n, l) => n + (l.quantity ?? 0), 0) ?? 0;
  return {
    id: id("inv"),
    organizationId,
    periodStart: new Date((si.period_start ?? 0) * 1000),
    periodEnd: new Date((si.period_end ?? 0) * 1000),
    receiptCount,
    amountDueCents: si.amount_due ?? 0,
    status: statusForStripeInvoice(si.status ?? "open"),
    stripeInvoiceId: si.id,
    hostedInvoiceUrl: si.hosted_invoice_url ?? null,
  };
}

/** Upsert by stripeInvoiceId. Resolves org via the Stripe customer mapping. */
export async function upsertInvoiceFromStripe(si: Stripe.Invoice): Promise<void> {
  const customerId = typeof si.customer === "string" ? si.customer : si.customer?.id;
  if (!customerId) return;
  const [settings] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.stripeCustomerId, customerId))
    .limit(1);
  if (!settings) return; // unknown customer — ignore

  const row = invoiceRowFromStripe(si, settings.organizationId);
  const [existing] = await db
    .select({ id: invoice.id })
    .from(invoice)
    .where(eq(invoice.stripeInvoiceId, si.id))
    .limit(1);

  if (existing) {
    await db
      .update(invoice)
      .set({
        status: row.status,
        amountDueCents: row.amountDueCents,
        hostedInvoiceUrl: row.hostedInvoiceUrl,
        receiptCount: row.receiptCount,
      })
      .where(eq(invoice.stripeInvoiceId, si.id));
  } else {
    await db.insert(invoice).values(row);
  }
}
```

- [ ] **Step 4: Run it — expect pass**

Run: `npm test -- lib/billing/invoice-sync.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/invoice-sync.ts lib/billing/invoice-sync.test.ts
git commit -m "feat: mirror Stripe invoices into the invoice table"
```

---

## Task 7: Webhook route

**Files:**
- Create: `app/api/stripe/webhook/route.ts`

- [ ] **Step 1: Write the route**

```ts
// POST /api/stripe/webhook — reconcile Stripe events into our DB.
// Verified by STRIPE_WEBHOOK_SECRET. Stripe is authoritative; we mirror.

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { upsertInvoiceFromStripe } from "@/lib/billing/invoice-sync";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!stripe) return NextResponse.json({ error: "billing not configured" }, { status: 503 });
  const secret = getEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "no webhook secret" }, { status: 503 });

  const sig = req.headers.get("stripe-signature") ?? "";
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  switch (event.type) {
    case "invoice.created":
    case "invoice.finalized":
    case "invoice.paid":
    case "invoice.payment_failed":
      await upsertInvoiceFromStripe(event.data.object as Stripe.Invoice);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      await db
        .update(tenantSettings)
        .set({ subscriptionStatus: sub.status })
        .where(eq(tenantSettings.stripeCustomerId, customerId));
      break;
    }
    case "setup_intent.succeeded":
    case "payment_method.attached": {
      const pm = (
        event.type === "payment_method.attached"
          ? (event.data.object as Stripe.PaymentMethod)
          : null
      );
      if (pm?.card && typeof pm.customer === "string") {
        await db
          .update(tenantSettings)
          .set({ cardBrand: pm.card.brand, cardLast4: pm.card.last4 })
          .where(eq(tenantSettings.stripeCustomerId, pm.customer));
      }
      break;
    }
    default:
      break; // ignore unhandled types
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verify (Stripe test mode)** — in one terminal:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the printed `whsec_...` into `.env.local` as `STRIPE_WEBHOOK_SECRET`, restart `npm run dev`, then in another terminal:

```bash
stripe trigger invoice.paid
```

Expected: route logs a 200; no errors. (Full invoice mirroring is verified end-to-end in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add app/api/stripe/webhook/route.ts
git commit -m "feat: add Stripe webhook reconciliation route"
```

---

## Task 8: Report usage on ingest (non-blocking)

**Files:**
- Modify: `app/api/ingest/route.ts`

- [ ] **Step 1: Add imports** near the other `@/lib` imports at the top of the file:

```ts
import { tenantSettings } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe";
import { reportReceiptUsage } from "@/lib/billing/stripe-billing";
```

> Note: `device as deviceTable, receipt as receiptTable` is already imported from
> `@/lib/db/schema`; add `tenantSettings` to that same import line instead of a
> duplicate import.

- [ ] **Step 2: Fire the meter event after the device heartbeat update** — locate the `db.update(deviceTable)...set({ lastSeenAt: now, status: "online" })` block (ends just before the `// --- 4. Respond` comment) and insert immediately after it:

```ts
  // Report metered usage to Stripe (best-effort: never fail ingestion on this).
  if (stripe) {
    const [settings] = await db
      .select({ customerId: tenantSettings.stripeCustomerId })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, device.organizationId))
      .limit(1);
    if (settings?.customerId) {
      reportReceiptUsage(settings.customerId).catch((e) =>
        console.error("[ingest] meter event failed", e),
      );
    }
  }
```

- [ ] **Step 3: Verify type-check + tests**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/api/ingest/route.ts
git commit -m "feat: report metered usage to Stripe on receipt ingest"
```

---

## Task 9: Tenant billing page + Elements form + view-model

**Files:**
- Modify: `lib/data.ts`
- Create: `app/(tenant)/tenant/billing/actions.ts`
- Create: `components/billing/payment-method-form.tsx`
- Create: `app/(tenant)/tenant/billing/page.tsx`

- [ ] **Step 1: Add the view-model to `lib/data.ts`** — append:

```ts
export async function getTenantBilling(organizationId: string) {
  const { tenantSettings, invoice } = await import("@/lib/db/schema");
  const { eq, desc } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");

  const [settings] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, organizationId))
    .limit(1);

  const invoices = await db
    .select()
    .from(invoice)
    .where(eq(invoice.organizationId, organizationId))
    .orderBy(desc(invoice.periodStart));

  return {
    subscriptionStatus: settings?.subscriptionStatus ?? null,
    hasSubscription: Boolean(settings?.stripeSubscriptionId),
    card:
      settings?.cardBrand && settings?.cardLast4
        ? { brand: settings.cardBrand, last4: settings.cardLast4 }
        : null,
    invoices: invoices.map((i) => ({
      id: i.id,
      periodStart: i.periodStart.toISOString(),
      periodEnd: i.periodEnd.toISOString(),
      receiptCount: i.receiptCount,
      amount: i.amountDueCents / 100,
      status: i.status,
      hostedInvoiceUrl: i.hostedInvoiceUrl ?? null,
    })),
  };
}
```

- [ ] **Step 2: Create the server action**

```ts
// app/(tenant)/tenant/billing/actions.ts
"use server";

import { requireTenant } from "@/lib/session";
import { activateBilling as activate } from "@/lib/billing/stripe-billing";

export async function activateBilling(): Promise<{ clientSecret: string }> {
  const { organizationId } = await requireTenant();
  return activate(organizationId);
}
```

- [ ] **Step 3: Create the Elements form (client)**

```tsx
// components/billing/payment-method-form.tsx
"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { activateBilling } from "@/app/(tenant)/tenant/billing/actions";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

function CardForm() {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);
    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/tenant/billing` },
      redirect: "if_required",
    });
    if (error) setError(error.message ?? "Could not save card");
    else window.location.reload();
    setSaving(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={!stripe || saving}>
        {saving ? "Saving…" : "Save card"}
      </Button>
    </form>
  );
}

export function PaymentMethodForm() {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function start() {
    setLoading(true);
    const { clientSecret } = await activateBilling();
    setClientSecret(clientSecret);
    setLoading(false);
  }

  if (!stripePromise) {
    return <p className="text-sm text-muted-foreground">Billing isn’t configured yet.</p>;
  }
  if (!clientSecret) {
    return (
      <Button onClick={start} disabled={loading}>
        {loading ? "Starting…" : "Activate billing"}
      </Button>
    );
  }
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CardForm />
    </Elements>
  );
}
```

- [ ] **Step 4: Create the page**

```tsx
// app/(tenant)/tenant/billing/page.tsx
import { requireTenant } from "@/lib/session";
import { getTenantBilling } from "@/lib/data";
import { PaymentMethodForm } from "@/components/billing/payment-method-form";

export default async function TenantBillingPage() {
  const { organizationId } = await requireTenant();
  const billing = await getTenantBilling(organizationId);

  return (
    <div className="flex flex-col gap-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">
          {billing.hasSubscription
            ? `Subscription: ${billing.subscriptionStatus ?? "unknown"}`
            : "Activate billing to start your monthly plan."}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Payment method</h2>
        {billing.card ? (
          <p className="text-sm">
            {billing.card.brand} •••• {billing.card.last4}
          </p>
        ) : null}
        <PaymentMethodForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Invoices</h2>
        {billing.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Period</th>
                <th>Receipts</th>
                <th>Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {billing.invoices.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="py-2">{inv.periodStart.slice(0, 10)}</td>
                  <td>{inv.receiptCount}</td>
                  <td>${inv.amount.toFixed(2)}</td>
                  <td>{inv.status}</td>
                  <td>
                    {inv.hostedInvoiceUrl ? (
                      <a className="underline" href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                        View
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Verify type-check + build the route**

Run: `npx tsc --noEmit`
Expected: no errors. Then `npm run dev`, open `/tenant/billing` as a tenant user — page renders; "Activate billing" appears (or "Billing isn’t configured yet" if Stripe keys absent).

- [ ] **Step 6: Commit**

```bash
git add lib/data.ts app/\(tenant\)/tenant/billing/ components/billing/
git commit -m "feat: tenant billing page with Stripe Elements card capture"
```

---

## Task 10: Env docs + end-to-end verification

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Document the new vars** — append to `.env.example`:

```bash

# ---- Stripe billing (test mode) ----
# Keys from https://dashboard.stripe.com/test/apikeys
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_xxx"
STRIPE_SECRET_KEY="sk_test_xxx"
# From `stripe listen --forward-to localhost:3000/api/stripe/webhook`
STRIPE_WEBHOOK_SECRET="whsec_xxx"
# From `npx tsx scripts/stripe-setup.ts`
STRIPE_PRICE_ID="price_xxx"
STRIPE_METER_EVENT_NAME="receipts"
```

- [ ] **Step 2: Full e2e in Stripe test mode**

1. `npx tsx scripts/stripe-setup.ts` → put `STRIPE_PRICE_ID` in `.env.local`.
2. `stripe listen --forward-to localhost:3000/api/stripe/webhook` → put `whsec_` in `.env.local`.
3. `npm run dev`; sign in as a tenant; `/tenant/billing` → **Activate billing** → enter card `4242 4242 4242 4242` → Save.
4. Confirm `tenantSettings` now has `stripeSubscriptionId` + `subscriptionStatus=active` (via `npm run db:studio`).
5. Ingest a receipt (`POST /api/ingest` with a claimed device key) → confirm a meter event appears in the Stripe dashboard (Billing → Meters → Receipts).
6. In the Stripe dashboard, use a **test clock** (or `stripe trigger invoice.paid`) to finalize/pay an invoice → confirm an `invoice` row appears for the org with `hostedInvoiceUrl` and `status` updated.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: document Stripe billing env vars"
```

---

## Self-Review

- **Spec coverage:** one-time setup (T4), activate/subscribe + Elements (T5, T9), usage reporting (T8), webhook mirror (T6, T7), tenant billing page (T9), schema (T2), env + graceful degrade (T1), e2e (T10). All spec sections mapped.
- **Placeholder scan:** none — every code step has full code. The `pk_test_xxx`/`whsec_xxx` strings in `.env.example` are template placeholders by design, not plan gaps.
- **Type consistency:** `statusForStripeInvoice` / `meterEventPayload` (T3) are reused exactly in T6/T8; `ensureStripeCustomer`/`activateBilling`/`reportReceiptUsage` (T5) match their call sites in T8/T9; `invoiceRowFromStripe`/`upsertInvoiceFromStripe` (T6) match the webhook in T7; `getTenantBilling` (T9 step 1) matches the page consumer (T9 step 4).

## Execution notes

- **Run green with no Stripe keys:** Tasks 1–3, 6 (pure parts) build + test without keys. Tasks 4, 5, 7–10 need the **test keys already in `.env.local`** plus `STRIPE_PRICE_ID` (from T4) and `STRIPE_WEBHOOK_SECRET` (from `stripe listen`) to verify live; the code itself compiles and degrades gracefully without them.
- **Migration (T2)** needs `DATABASE_URL`.
