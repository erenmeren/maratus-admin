# Subscription Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prepaid-credit billing system with a single subscription plan — $15/device/month billed annually by bank transfer, anniversary-based periods, a pooled 1000-trigger/device monthly quota, and $0.02 post-paid overage that never blocks a request.

**Architecture:** All money arithmetic lives in two pure, fully-tested modules (`lib/billing-period.ts`, `lib/invoicing.ts`); persistence is a thin layer over them (`lib/invoices.ts`). The trigger hot path loses credit reservation entirely and becomes a single boolean check on `device.subscriptionPaidAt` plus a 50-trigger trial count for unpaid devices. Quota and overage are derived from `device_command` rows at read time — there is no usage counter table.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle ORM over Neon (`neon-http`), Vitest (node env, `lib/**/*.test.ts`), Vercel cron.

**Spec:** `docs/superpowers/specs/2026-08-15-subscription-billing-design.md`

## Global Constraints

- **Money is integer cents (USD).** Never floats. `pricePerDeviceCents` default `1500`, `overagePriceCents` default `2`.
- **All billing dates are UTC.** Use `getUTC*` / `Date.UTC` exclusively; never local-time getters.
- **Included quota: 1000 triggers per paid device per month, pooled at the org.**
- **Invoice payment terms: net 14 days** (`DUE_DAYS = 14`).
- **Trial: 50 acked triggers per unpaid device**, lifetime, not reset on payment.
- **Tests are pure.** `vitest.config.ts` includes only `lib/**/*.test.ts` and nothing in the suite touches the database. Do not write DB-hitting tests; verify persistence manually per the steps given.
- **⚠️ `.env.local` points at PRODUCTION.** Any script run via `tsx` hits the live database. Migrations and the backfill script are destructive-by-reach; only run them when a step explicitly says to.
- **Migrations:** `drizzle-kit generate` writes to `./drizzle`; next numbers are `0042` (additive) and `0043` (destructive). Per the known snapshot-drift gotcha, **strip any generated `.sql` down to only your intended change** before committing.
- **Layout:** dashboard pages return a fragment and inherit the shell container; use `PageHeader` / `SectionHeader` / `PageSection`. Never re-pad a page.
- **Role gating:** platform-admin-only writes go through `requirePlatformAdmin()`; tenant reads through `requireTenant()`.

---

### Task 1: Billing period arithmetic (pure)

The anniversary math every other task depends on. Month-end anchoring is the whole difficulty: a subscription starting 31 January must clamp to 28/29 February and then return to 31 March — the anchor is always the original day-of-month, never the clamped one.

**Files:**
- Create: `lib/billing-period.ts`
- Test: `lib/billing-period.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `addMonthsAnchored(anchor: Date, months: number): Date`
  - `periodIndexFor(anchor: Date, now: Date): number`
  - `periodStartFor(anchor: Date, now: Date): Date`
  - `periodEndFor(anchor: Date, now: Date): Date`
  - `renewalDueAt(anchor: Date): Date`
  - `MONTHS_PER_YEAR: 12`

- [ ] **Step 1: Write the failing test**

Create `lib/billing-period.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addMonthsAnchored,
  periodEndFor,
  periodIndexFor,
  periodStartFor,
  renewalDueAt,
} from "./billing-period";

describe("addMonthsAnchored", () => {
  it("adds whole months keeping the day of month", () => {
    expect(addMonthsAnchored(new Date("2026-03-12T09:00:00Z"), 1).toISOString()).toBe(
      "2026-04-12T09:00:00.000Z",
    );
  });

  it("clamps to the last day of a shorter month", () => {
    expect(addMonthsAnchored(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("returns to the anchor day after a clamped month", () => {
    // The anchor is 31, not the clamped 28: two months out must be 31 March.
    expect(addMonthsAnchored(new Date("2026-01-31T00:00:00Z"), 2).toISOString()).toBe(
      "2026-03-31T00:00:00.000Z",
    );
  });

  it("handles leap years", () => {
    expect(addMonthsAnchored(new Date("2024-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2024-02-29T00:00:00.000Z",
    );
  });

  it("crosses year boundaries", () => {
    expect(addMonthsAnchored(new Date("2026-11-15T12:00:00Z"), 3).toISOString()).toBe(
      "2027-02-15T12:00:00.000Z",
    );
  });
});

describe("periodIndexFor", () => {
  const anchor = new Date("2026-03-12T09:00:00Z");

  it("is 0 on the start instant", () => {
    expect(periodIndexFor(anchor, new Date("2026-03-12T09:00:00Z"))).toBe(0);
  });

  it("is 0 one millisecond before the next period", () => {
    expect(periodIndexFor(anchor, new Date("2026-04-12T08:59:59.999Z"))).toBe(0);
  });

  it("is 1 on the next anniversary instant", () => {
    expect(periodIndexFor(anchor, new Date("2026-04-12T09:00:00Z"))).toBe(1);
  });

  it("counts whole months across a year", () => {
    expect(periodIndexFor(anchor, new Date("2027-03-12T09:00:00Z"))).toBe(12);
  });

  it("does not over-count when the month clamped", () => {
    // 31 Jan anchor: on 28 Feb we are still in period 0 until the clamped instant.
    const jan31 = new Date("2026-01-31T00:00:00Z");
    expect(periodIndexFor(jan31, new Date("2026-02-27T23:59:59Z"))).toBe(0);
    expect(periodIndexFor(jan31, new Date("2026-02-28T00:00:00Z"))).toBe(1);
  });
});

describe("periodStartFor / periodEndFor", () => {
  const anchor = new Date("2026-03-12T09:00:00Z");

  it("brackets the current period", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    expect(periodStartFor(anchor, now).toISOString()).toBe("2026-04-12T09:00:00.000Z");
    expect(periodEndFor(anchor, now).toISOString()).toBe("2026-05-12T09:00:00.000Z");
  });

  it("start is inclusive and end is exclusive", () => {
    const start = periodStartFor(anchor, new Date("2026-04-12T09:00:00Z"));
    expect(start.toISOString()).toBe("2026-04-12T09:00:00.000Z");
  });
});

describe("renewalDueAt", () => {
  it("is twelve months after the anchor", () => {
    expect(renewalDueAt(new Date("2026-03-12T09:00:00Z")).toISOString()).toBe(
      "2027-03-12T09:00:00.000Z",
    );
  });

  it("clamps a 29 February anchor", () => {
    expect(renewalDueAt(new Date("2024-02-29T00:00:00Z")).toISOString()).toBe(
      "2025-02-28T00:00:00.000Z",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/billing-period.test.ts`
Expected: FAIL — `Failed to resolve import "./billing-period"`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/billing-period.ts`:

```ts
// Anniversary-based billing period arithmetic (pure, UTC only).
// A subscription's anchor is its start instant; every period boundary is that
// instant shifted by whole months. The anchor's day-of-month is preserved even
// when an intervening month is too short — clamping is per-computation, never
// carried forward, or every February would walk the billing date backwards.

export const MONTHS_PER_YEAR = 12;

/** Shift `anchor` by whole months, clamping to the target month's last day. */
export function addMonthsAnchored(anchor: Date, months: number): Date {
  const day = anchor.getUTCDate();
  // Land on the 1st of the target month first, so the day-of-month can never
  // roll the month over before we clamp it.
  const target = new Date(
    Date.UTC(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() + months,
      1,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** How many whole anniversary months have elapsed since `anchor` at `now`. */
export function periodIndexFor(anchor: Date, now: Date): number {
  const rough =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * MONTHS_PER_YEAR +
    (now.getUTCMonth() - anchor.getUTCMonth());
  // The calendar-month difference overshoots whenever `now` sits before the
  // anchor's day/time within its month (and after clamping), so step back once.
  return addMonthsAnchored(anchor, rough).getTime() > now.getTime() ? rough - 1 : rough;
}

/** Inclusive start of the period containing `now`. */
export function periodStartFor(anchor: Date, now: Date): Date {
  return addMonthsAnchored(anchor, periodIndexFor(anchor, now));
}

/** Exclusive end of the period containing `now` (= next period's start). */
export function periodEndFor(anchor: Date, now: Date): Date {
  return addMonthsAnchored(anchor, periodIndexFor(anchor, now) + 1);
}

/** When a subscription anchored at `anchor` comes up for renewal. */
export function renewalDueAt(anchor: Date): Date {
  return addMonthsAnchored(anchor, MONTHS_PER_YEAR);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/billing-period.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add lib/billing-period.ts lib/billing-period.test.ts
git commit -m "feat(billing): anniversary period arithmetic with month-end anchoring"
```

---

### Task 2: Invoice amount computation (pure)

Every dollar figure the system produces. Kept separate from persistence so the arithmetic is exhaustively testable without a database.

**Files:**
- Create: `lib/invoicing.ts`
- Test: `lib/invoicing.test.ts`

**Interfaces:**
- Consumes: `MONTHS_PER_YEAR`, `periodIndexFor` from `lib/billing-period.ts` (Task 1)
- Produces:
  - `DEFAULT_PRICE_PER_DEVICE_CENTS: 1500`
  - `DEFAULT_OVERAGE_PRICE_CENTS: 2`
  - `DEFAULT_INCLUDED_TRIGGERS_PER_DEVICE: 1000`
  - `DUE_DAYS: 14`
  - `TRIAL_TRIGGERS_PER_DEVICE: 50`
  - `FAIR_USE_TRIGGERS_PER_DEVICE_MONTH: 300_000`
  - `subscriptionAmountCents(deviceCount: number, pricePerDeviceCents: number): number`
  - `monthsRemainingUntil(renewsAt: Date, now: Date): number`
  - `prorationAmountCents(pricePerDeviceCents: number, monthsRemaining: number): number`
  - `overageFor(a: { used: number; includedPerDevice: number; paidDeviceCount: number; overagePriceCents: number; legacyCredits: number }): { includedTotal: number; overageTriggers: number; creditsConsumed: number; billableTriggers: number; amountUsdCents: number }`
  - `dueAtFrom(issuedAt: Date): Date`

- [ ] **Step 1: Write the failing test**

Create `lib/invoicing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_INCLUDED_TRIGGERS_PER_DEVICE,
  DEFAULT_OVERAGE_PRICE_CENTS,
  DEFAULT_PRICE_PER_DEVICE_CENTS,
  DUE_DAYS,
  dueAtFrom,
  monthsRemainingUntil,
  overageFor,
  prorationAmountCents,
  subscriptionAmountCents,
} from "./invoicing";

describe("defaults", () => {
  it("prices a device at $15/month and overage at 2 cents", () => {
    expect(DEFAULT_PRICE_PER_DEVICE_CENTS).toBe(1500);
    expect(DEFAULT_OVERAGE_PRICE_CENTS).toBe(2);
    expect(DEFAULT_INCLUDED_TRIGGERS_PER_DEVICE).toBe(1000);
    expect(DUE_DAYS).toBe(14);
  });
});

describe("subscriptionAmountCents", () => {
  it("charges twelve months per device", () => {
    expect(subscriptionAmountCents(2, 1500)).toBe(36_000); // $360
  });

  it("is zero with no devices", () => {
    expect(subscriptionAmountCents(0, 1500)).toBe(0);
  });

  it("honours a negotiated price", () => {
    expect(subscriptionAmountCents(1, 1200)).toBe(14_400);
  });
});

describe("monthsRemainingUntil", () => {
  const renewsAt = new Date("2027-03-12T09:00:00Z");

  it("counts whole months left, rounding up a partial month", () => {
    // Device added in month 5 of 12 → 7 months remain.
    expect(monthsRemainingUntil(renewsAt, new Date("2026-08-12T09:00:00Z"))).toBe(7);
  });

  it("rounds a partial month up so the customer is never billed zero", () => {
    expect(monthsRemainingUntil(renewsAt, new Date("2027-02-20T00:00:00Z"))).toBe(1);
  });

  it("is 0 at or past the renewal instant", () => {
    expect(monthsRemainingUntil(renewsAt, new Date("2027-03-12T09:00:00Z"))).toBe(0);
    expect(monthsRemainingUntil(renewsAt, new Date("2027-04-01T00:00:00Z"))).toBe(0);
  });

  it("never exceeds a full year", () => {
    expect(monthsRemainingUntil(renewsAt, new Date("2026-03-12T09:00:00Z"))).toBe(12);
  });
});

describe("prorationAmountCents", () => {
  it("bills the remaining months at the device price", () => {
    expect(prorationAmountCents(1500, 7)).toBe(10_500); // $105
  });

  it("is zero when nothing remains", () => {
    expect(prorationAmountCents(1500, 0)).toBe(0);
  });
});

describe("overageFor", () => {
  const base = {
    includedPerDevice: 1000,
    paidDeviceCount: 2,
    overagePriceCents: 2,
    legacyCredits: 0,
  };

  it("pools quota across paid devices", () => {
    const r = overageFor({ ...base, used: 2000 });
    expect(r.includedTotal).toBe(2000);
    expect(r.overageTriggers).toBe(0);
    expect(r.amountUsdCents).toBe(0);
  });

  it("charges only what exceeds the pool", () => {
    const r = overageFor({ ...base, used: 2240 });
    expect(r.overageTriggers).toBe(240);
    expect(r.billableTriggers).toBe(240);
    expect(r.amountUsdCents).toBe(480); // $4.80
  });

  it("ignores which device burned the quota", () => {
    // One device consuming the whole pool is explicitly allowed.
    expect(overageFor({ ...base, used: 1999 }).amountUsdCents).toBe(0);
  });

  it("gives an unpaid fleet no quota at all", () => {
    const r = overageFor({ ...base, paidDeviceCount: 0, used: 10 });
    expect(r.includedTotal).toBe(0);
    expect(r.overageTriggers).toBe(10);
  });

  it("offsets legacy credits before billing", () => {
    const r = overageFor({ ...base, used: 2500, legacyCredits: 300 });
    expect(r.overageTriggers).toBe(500);
    expect(r.creditsConsumed).toBe(300);
    expect(r.billableTriggers).toBe(200);
    expect(r.amountUsdCents).toBe(400);
  });

  it("consumes no more credits than the overage", () => {
    const r = overageFor({ ...base, used: 2050, legacyCredits: 500 });
    expect(r.creditsConsumed).toBe(50);
    expect(r.billableTriggers).toBe(0);
    expect(r.amountUsdCents).toBe(0);
  });
});

describe("dueAtFrom", () => {
  it("is net 14 from issue", () => {
    expect(dueAtFrom(new Date("2026-04-12T09:00:00Z")).toISOString()).toBe(
      "2026-04-26T09:00:00.000Z",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/invoicing.test.ts`
Expected: FAIL — `Failed to resolve import "./invoicing"`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/invoicing.ts`:

```ts
// Pure invoice arithmetic. No database, no dates beyond what callers pass in.
// Persistence lives in lib/invoices.ts; keeping the money math here is what
// makes it exhaustively testable.

import { addMonthsAnchored, MONTHS_PER_YEAR, periodIndexFor } from "./billing-period";

export const DEFAULT_PRICE_PER_DEVICE_CENTS = 1500; // $15/device/month
export const DEFAULT_OVERAGE_PRICE_CENTS = 2; // $0.02/trigger past the pool
export const DEFAULT_INCLUDED_TRIGGERS_PER_DEVICE = 1000;
export const DUE_DAYS = 14;

/** Free acked triggers an unpaid device may make, lifetime. */
export const TRIAL_TRIGGERS_PER_DEVICE = 50;

/**
 * Abuse valve only. Nothing in the request path blocks on it — the daily
 * billing cron sweeps for devices past it and raises an alert.
 */
export const FAIR_USE_TRIGGERS_PER_DEVICE_MONTH = 300_000;

/** A full year of subscription for `deviceCount` devices. */
export function subscriptionAmountCents(
  deviceCount: number,
  pricePerDeviceCents: number,
): number {
  return deviceCount * pricePerDeviceCents * MONTHS_PER_YEAR;
}

/**
 * Whole months left until renewal, rounding a partial month UP so a device
 * added late in a month is never billed zero. Clamped to [0, 12].
 */
export function monthsRemainingUntil(renewsAt: Date, now: Date): number {
  if (now.getTime() >= renewsAt.getTime()) return 0;
  // Whole months from now to the renewal instant; anything left over is a
  // partial month that still costs a full one.
  const whole = periodIndexFor(now, renewsAt);
  const landsExactly = addMonthsAnchored(now, whole).getTime() === renewsAt.getTime();
  const months = landsExactly ? whole : whole + 1;
  return Math.min(MONTHS_PER_YEAR, Math.max(0, months));
}

/** One device for the remaining months of an existing subscription year. */
export function prorationAmountCents(
  pricePerDeviceCents: number,
  monthsRemaining: number,
): number {
  return pricePerDeviceCents * monthsRemaining;
}

/**
 * Overage for one closed period. Quota is pooled across PAID devices only;
 * legacy credits (migrated prepaid balance) offset the overage before billing.
 */
export function overageFor(a: {
  used: number;
  includedPerDevice: number;
  paidDeviceCount: number;
  overagePriceCents: number;
  legacyCredits: number;
}): {
  includedTotal: number;
  overageTriggers: number;
  creditsConsumed: number;
  billableTriggers: number;
  amountUsdCents: number;
} {
  const includedTotal = a.paidDeviceCount * a.includedPerDevice;
  const overageTriggers = Math.max(0, a.used - includedTotal);
  const creditsConsumed = Math.min(Math.max(0, a.legacyCredits), overageTriggers);
  const billableTriggers = overageTriggers - creditsConsumed;
  return {
    includedTotal,
    overageTriggers,
    creditsConsumed,
    billableTriggers,
    amountUsdCents: billableTriggers * a.overagePriceCents,
  };
}

/** Net-14 due date. */
export function dueAtFrom(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + DUE_DAYS * 24 * 60 * 60 * 1000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/invoicing.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, zero type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/invoicing.ts lib/invoicing.test.ts
git commit -m "feat(billing): pure invoice amount computation"
```

---

### Task 3: Schema — invoice table and subscription columns (additive)

Additive only. Nothing is dropped here; existing credit code keeps working so this can ship independently of the cutover.

**Files:**
- Modify: `lib/db/schema.ts` (`tenantSettings` block around line 205; `device` table; new `invoice` table near `creditBalance` around line 456)
- Modify: `lib/db/relations.ts`
- Create: `drizzle/0042_*.sql` (generated)

**Interfaces:**
- Consumes: nothing
- Produces: `invoice` table export; `tenantSettings.subscriptionStartedAt / subscriptionRenewsAt / pricePerDeviceCents / overagePriceCents / legacyCreditsRemaining`; `device.subscriptionPaidAt`

- [ ] **Step 1: Add the subscription columns to `tenantSettings`**

In `lib/db/schema.ts`, replace the pricing-plan block (the `billingPlan` and `includedTriggersPerDevice` columns and their comments) with:

```ts
  // --- Subscription plan (2026-08-15 subscription-billing spec) ------------
  // One plan: $15/device/month billed annually by bank transfer, 1000 triggers
  // per paid device per month POOLED at the org, $0.02/trigger post-paid
  // overage. `billingPlan` and the credit ledger are removed in migration 0043.
  //
  // null = not subscribed yet. Set when a platform admin marks the first
  // subscription invoice paid; it is the anchor for every billing period.
  subscriptionStartedAt: timestamp("subscription_started_at"),
  // Advanced by 12 months each time a renewal invoice is marked paid.
  subscriptionRenewsAt: timestamp("subscription_renews_at"),
  // Per-tenant so a negotiated discount needs no code change.
  pricePerDeviceCents: integer("price_per_device_cents").default(1500).notNull(),
  overagePriceCents: integer("overage_price_cents").default(2).notNull(),
  // Triggers included per PAID device per month; pooled org-wide.
  includedTriggersPerDevice: integer("included_triggers_per_device")
    .default(1000)
    .notNull(),
  // Migration-only: the org's prepaid credit balance at cutover, offset
  // against its FIRST overage invoice and then zeroed. See spec §5.
  legacyCreditsRemaining: integer("legacy_credits_remaining").default(0).notNull(),
```

Keep `billingPlan` in place for now — it is dropped in Task 16, after the new code is deployed and verified.

- [ ] **Step 2: Add `subscriptionPaidAt` to `device`**

In the `device` table definition, add:

```ts
    // Source of truth for both the trigger gate and pooled quota. null = the
    // device is unpaid: it may still run 50 trial triggers, and it contributes
    // NO quota to the org pool (otherwise a customer inflates quota by claiming
    // hardware without paying).
    subscriptionPaidAt: timestamp("subscription_paid_at"),
```

- [ ] **Step 3: Add the `invoice` table**

Add after the `creditLedger` definition in `lib/db/schema.ts`:

```ts
// Bank-transfer invoices. Money is USD cents; the TRY amount and FX rate are
// frozen onto the row when a platform admin marks it paid, so a later rate
// move never rewrites history. "Overdue" is derived (status = "open" AND
// dueAt < now), not stored — no job exists whose only purpose is a flag flip.
export const invoice = pgTable(
  "invoice",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["subscription", "proration", "overage"] }).notNull(),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    // subscription / proration
    deviceCount: integer("device_count"),
    deviceId: text("device_id").references(() => device.id, { onDelete: "set null" }),
    // overage
    triggersUsed: integer("triggers_used"),
    triggersIncluded: integer("triggers_included"),
    overageTriggers: integer("overage_triggers"), // billable, after credit offset
    creditsConsumed: integer("credits_consumed"),
    amountUsdCents: integer("amount_usd_cents").notNull(),
    tryAmountKurus: integer("try_amount_kurus"),
    fxRate: integer("fx_rate"), // kuruş per USD, frozen at payment
    status: text("status", { enum: ["open", "paid", "void"] })
      .default("open")
      .notNull(),
    issuedAt: timestamp("issued_at").notNull(),
    dueAt: timestamp("due_at").notNull(),
    paidAt: timestamp("paid_at"),
    markedPaidByUserId: text("marked_paid_by_user_id"),
    note: text("note"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    // The cron's idempotency guarantee: a second run over the same period
    // conflicts and does nothing.
    uniqueIndex("invoice_org_kind_period_idx").on(
      t.organizationId,
      t.kind,
      t.periodStart,
    ),
    index("invoice_org_issued_idx").on(t.organizationId, t.issuedAt),
    index("invoice_status_due_idx").on(t.status, t.dueAt),
  ],
);
```

- [ ] **Step 4: Register the relation**

In `lib/db/relations.ts`, follow the existing pattern for `creditLedger` and add `invoice` to the organization relations (an org has many invoices; an invoice belongs to one organization and optionally one device).

- [ ] **Step 5: Add `invoice` to the schema export list**

`lib/db/schema.ts` ends with an export object listing the tables (it currently includes `creditBalance` near line 604). Add `invoice` to it.

- [ ] **Step 6: Generate the migration**

Run: `npm run db:generate`

Then **open the generated `drizzle/0042_*.sql` and strip it** to only: the `invoice` table + its three indexes, the five new `tenant_settings` columns, and `device.subscription_paid_at`. Delete any unrelated FK churn — the snapshot has known drift and will emit spurious statements.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors. (Existing code still reads `billingPlan`, which is still there — nothing should break.)

- [ ] **Step 8: Commit**

```bash
git add lib/db/schema.ts lib/db/relations.ts drizzle/
git commit -m "feat(db): invoice table and subscription columns (additive, migration 0042)"
```

Do **not** run `npm run db:migrate` yet — the deploy runbook in Task 16 sequences it.

---

### Task 4: Backfill script

The single most dangerous step in the whole change: a device with a null `subscriptionPaidAt` returns 403. Skip this and the entire fleet goes silent the moment the new code deploys. Everyone is backfilled as *paid*, and the operator corrects real dates from the admin panel afterwards.

**Files:**
- Create: `lib/db/backfill-subscriptions.ts`

**Interfaces:**
- Consumes: schema from Task 3
- Produces: a `tsx`-runnable script; no exports other tasks use

- [ ] **Step 1: Write the script**

Create `lib/db/backfill-subscriptions.ts`:

```ts
// One-shot cutover backfill for the subscription-billing migration.
// MUST run after migration 0042 and BEFORE the new gate deploys: a device with
// a null subscriptionPaidAt returns 403, so an un-backfilled fleet goes dark.
//
// Everyone is marked paid as of the migration date; the operator corrects real
// subscription dates from the admin panel afterwards. Failing safe in that
// direction is the entire point.
//
// Run:  npx tsx lib/db/backfill-subscriptions.ts
// NOTE: .env.local points at PRODUCTION. This writes to the live database.

import "./load-env"; // MUST be first — hoisted ESM imports read env at load time
import { eq, isNull, and, sql } from "drizzle-orm";
import { db } from "../db";
import { creditBalance, device, tenantSettings } from "./schema";
import { addMonthsAnchored } from "../billing-period";

async function main() {
  const now = new Date();
  const renewsAt = addMonthsAnchored(now, 12);

  // 1. Subscribe every non-archived org as of now.
  const orgs = await db
    .update(tenantSettings)
    .set({ subscriptionStartedAt: now, subscriptionRenewsAt: renewsAt, updatedAt: now })
    .where(and(isNull(tenantSettings.archivedAt), isNull(tenantSettings.subscriptionStartedAt)))
    .returning({ organizationId: tenantSettings.organizationId });

  // 2. Mark every claimed device paid.
  const devices = await db
    .update(device)
    .set({ subscriptionPaidAt: now })
    .where(and(isNull(device.subscriptionPaidAt), sql`${device.claimedAt} is not null`))
    .returning({ id: device.id });

  // 3. Carry prepaid balances over as legacy credits.
  const balances = await db
    .select({ organizationId: creditBalance.organizationId, available: creditBalance.available })
    .from(creditBalance);
  let credited = 0;
  for (const b of balances) {
    if (b.available <= 0) continue;
    await db
      .update(tenantSettings)
      .set({ legacyCreditsRemaining: b.available, updatedAt: new Date() })
      .where(eq(tenantSettings.organizationId, b.organizationId));
    credited += 1;
  }

  console.log(
    `backfill complete: ${orgs.length} orgs subscribed, ${devices.length} devices marked paid, ${credited} credit balances carried over`,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors. If `claimedAt` is not the column name on `device`, read `lib/db/schema.ts` and use the real one.

- [ ] **Step 3: Verify it is idempotent by reading it**

Confirm every `update` is guarded by an `isNull(...)` predicate, so a second run is a no-op rather than resetting dates the operator has since corrected. Fix if not.

- [ ] **Step 4: Commit**

```bash
git add lib/db/backfill-subscriptions.ts
git commit -m "feat(db): cutover backfill script for subscription billing"
```

Do not run it yet — Task 16 sequences it.

---

### Task 5: Invoice persistence — issuing

Thin writes over Task 2's arithmetic. Every issue function is idempotent via the `(organizationId, kind, periodStart)` unique index and returns `null` when the invoice already exists.

**Files:**
- Create: `lib/invoices.ts`

**Interfaces:**
- Consumes: `overageFor`, `subscriptionAmountCents`, `prorationAmountCents`, `dueAtFrom`, `monthsRemainingUntil` from `lib/invoicing.ts`; `periodStartFor`, `periodEndFor`, `renewalDueAt` from `lib/billing-period.ts`; `id` from `lib/ids.ts`
- Produces:
  - `issueSubscriptionInvoice(a: { organizationId: string; deviceCount: number; pricePerDeviceCents: number; periodStart: Date; periodEnd: Date; issuedAt: Date; note?: string }): Promise<{ id: string } | null>`
  - `issueProrationInvoice(a: { organizationId: string; deviceId: string; pricePerDeviceCents: number; monthsRemaining: number; periodStart: Date; periodEnd: Date; issuedAt: Date }): Promise<{ id: string } | null>`
  - `issueOverageInvoice(a: { organizationId: string; periodStart: Date; periodEnd: Date; used: number; includedPerDevice: number; paidDeviceCount: number; overagePriceCents: number; legacyCredits: number; issuedAt: Date }): Promise<{ id: string } | null>`
  - `listInvoices(organizationId: string, limit?: number): Promise<InvoiceRow[]>`
  - `countPaidDevices(organizationId: string): Promise<number>`
  - `countAckedTriggers(a: { organizationId: string; from: Date; to: Date }): Promise<number>`

- [ ] **Step 1: Write the module**

Create `lib/invoices.ts`:

```ts
// Persistence for bank-transfer invoices. All amount arithmetic comes from
// lib/invoicing.ts; this file only reads counts and writes rows.
//
// Every issue* function is idempotent: the (organizationId, kind, periodStart)
// unique index turns a duplicate into a no-op, which is what lets the daily
// cron run more than once over the same period safely.

import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { device, deviceCommand, invoice } from "./db/schema";
import { id } from "./ids";
import {
  dueAtFrom,
  overageFor,
  prorationAmountCents,
  subscriptionAmountCents,
} from "./invoicing";

export type InvoiceRow = typeof invoice.$inferSelect;

/** Paid, non-archived devices — the only ones that contribute pooled quota. */
export async function countPaidDevices(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(device)
    .where(
      and(
        eq(device.organizationId, organizationId),
        isNotNull(device.subscriptionPaidAt),
      ),
    );
  return Number(row?.c ?? 0);
}

/**
 * Acked triggers in [from, to). `acked` because a trigger that never reached a
 * screen is not billed; `createdAt` because that is what the composite index
 * (organization_id, type, status, created_at) covers — ackedAt differs by
 * seconds, which is immaterial at a period boundary.
 */
export async function countAckedTriggers(a: {
  organizationId: string;
  from: Date;
  to: Date;
}): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(deviceCommand)
    .where(
      and(
        eq(deviceCommand.organizationId, a.organizationId),
        eq(deviceCommand.type, "trigger"),
        eq(deviceCommand.status, "acked"),
        gte(deviceCommand.createdAt, a.from),
        lt(deviceCommand.createdAt, a.to),
      ),
    );
  return Number(row?.c ?? 0);
}

export async function issueSubscriptionInvoice(a: {
  organizationId: string;
  deviceCount: number;
  pricePerDeviceCents: number;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  note?: string;
}): Promise<{ id: string } | null> {
  const rows = await db
    .insert(invoice)
    .values({
      id: id("inv"),
      organizationId: a.organizationId,
      kind: "subscription",
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      deviceCount: a.deviceCount,
      amountUsdCents: subscriptionAmountCents(a.deviceCount, a.pricePerDeviceCents),
      status: "open",
      issuedAt: a.issuedAt,
      dueAt: dueAtFrom(a.issuedAt),
      note: a.note,
    })
    .onConflictDoNothing()
    .returning({ id: invoice.id });
  return rows[0] ?? null;
}

export async function issueProrationInvoice(a: {
  organizationId: string;
  deviceId: string;
  pricePerDeviceCents: number;
  monthsRemaining: number;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
}): Promise<{ id: string } | null> {
  const amount = prorationAmountCents(a.pricePerDeviceCents, a.monthsRemaining);
  if (amount <= 0) return null;
  const rows = await db
    .insert(invoice)
    .values({
      id: id("inv"),
      organizationId: a.organizationId,
      kind: "proration",
      deviceId: a.deviceId,
      deviceCount: 1,
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      amountUsdCents: amount,
      status: "open",
      issuedAt: a.issuedAt,
      dueAt: dueAtFrom(a.issuedAt),
    })
    .onConflictDoNothing()
    .returning({ id: invoice.id });
  return rows[0] ?? null;
}

export async function issueOverageInvoice(a: {
  organizationId: string;
  periodStart: Date;
  periodEnd: Date;
  used: number;
  includedPerDevice: number;
  paidDeviceCount: number;
  overagePriceCents: number;
  legacyCredits: number;
  issuedAt: Date;
}): Promise<{ id: string } | null> {
  const r = overageFor({
    used: a.used,
    includedPerDevice: a.includedPerDevice,
    paidDeviceCount: a.paidDeviceCount,
    overagePriceCents: a.overagePriceCents,
    legacyCredits: a.legacyCredits,
  });
  // Nothing billable and no credits burned → no invoice at all.
  if (r.billableTriggers <= 0 && r.creditsConsumed <= 0) return null;

  const rows = await db
    .insert(invoice)
    .values({
      id: id("inv"),
      organizationId: a.organizationId,
      kind: "overage",
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      triggersUsed: a.used,
      triggersIncluded: r.includedTotal,
      overageTriggers: r.billableTriggers,
      creditsConsumed: r.creditsConsumed,
      amountUsdCents: r.amountUsdCents,
      status: "open",
      issuedAt: a.issuedAt,
      dueAt: dueAtFrom(a.issuedAt),
    })
    .onConflictDoNothing()
    .returning({ id: invoice.id });
  return rows[0] ?? null;
}

export async function listInvoices(
  organizationId: string,
  limit = 50,
): Promise<InvoiceRow[]> {
  return db
    .select()
    .from(invoice)
    .where(eq(invoice.organizationId, organizationId))
    .orderBy(desc(invoice.issuedAt))
    .limit(limit);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Verify the credit-offset invoice case by reading**

Confirm that when `billableTriggers` is 0 but `creditsConsumed` is positive, an invoice **is** written (amount $0) — the customer needs the record showing their credits were spent. The guard above does that; make sure it was not simplified to `if (r.amountUsdCents <= 0) return null`.

- [ ] **Step 4: Commit**

```bash
git add lib/invoices.ts
git commit -m "feat(billing): invoice issuing persistence"
```

---

### Task 6: Marking an invoice paid

The action that actually activates things. The device-selection rule closes a real hole: a customer could otherwise claim extra hardware between invoice issue and payment and have it activated for free.

**Files:**
- Modify: `lib/invoices.ts`
- Test: `lib/invoices-payment.test.ts` (pure helper only)

**Interfaces:**
- Consumes: `renewalDueAt` from `lib/billing-period.ts`
- Produces:
  - `devicesToActivate(a: { deviceCount: number; unpaidDeviceIds: string[] }): string[]` (pure, exported for test)
  - `markInvoicePaid(a: { invoiceId: string; tryAmountKurus: number; fxRate: number; userId: string; now?: Date }): Promise<{ ok: true } | { ok: false; reason: "not_found" | "already_settled" }>`

- [ ] **Step 1: Write the failing test**

Create `lib/invoices-payment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { devicesToActivate } from "./invoices";

describe("devicesToActivate", () => {
  it("activates exactly the invoiced device count", () => {
    expect(
      devicesToActivate({ deviceCount: 2, unpaidDeviceIds: ["a", "b", "c"] }),
    ).toEqual(["a", "b"]);
  });

  it("takes the oldest claimed devices first (caller supplies that order)", () => {
    expect(
      devicesToActivate({ deviceCount: 1, unpaidDeviceIds: ["oldest", "newer"] }),
    ).toEqual(["oldest"]);
  });

  it("never activates more than exist", () => {
    expect(devicesToActivate({ deviceCount: 5, unpaidDeviceIds: ["a"] })).toEqual(["a"]);
  });

  it("activates nothing for a zero-device invoice", () => {
    expect(devicesToActivate({ deviceCount: 0, unpaidDeviceIds: ["a"] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/invoices-payment.test.ts`
Expected: FAIL — `devicesToActivate is not a function`.

- [ ] **Step 3: Implement**

Extend the existing import block at the top of `lib/invoices.ts` — do not add a second one:

```ts
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { device, deviceCommand, invoice, tenantSettings } from "./db/schema";
import { addMonthsAnchored, MONTHS_PER_YEAR, renewalDueAt } from "./billing-period";
```

Then append:

```ts
/**
 * Which unpaid devices a paid subscription invoice activates. Exactly
 * `deviceCount`, oldest-claimed first (the caller supplies that order).
 * Devices claimed AFTER the invoice was issued deliberately stay unpaid and
 * get their own proration invoice — otherwise a customer could claim extra
 * hardware between issue and payment and ride in for free.
 */
export function devicesToActivate(a: {
  deviceCount: number;
  unpaidDeviceIds: string[];
}): string[] {
  return a.unpaidDeviceIds.slice(0, Math.max(0, a.deviceCount));
}

export async function markInvoicePaid(a: {
  invoiceId: string;
  tryAmountKurus: number;
  fxRate: number;
  userId: string;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; reason: "not_found" | "already_settled" }> {
  const now = a.now ?? new Date();

  // Settle the row first, conditioned on status — this is the concurrency gate,
  // so a double-click cannot activate devices twice.
  const settled = await db
    .update(invoice)
    .set({
      status: "paid",
      paidAt: now,
      tryAmountKurus: a.tryAmountKurus,
      fxRate: a.fxRate,
      markedPaidByUserId: a.userId,
    })
    .where(and(eq(invoice.id, a.invoiceId), eq(invoice.status, "open")))
    .returning();
  const inv = settled[0];
  if (!inv) {
    const [exists] = await db
      .select({ id: invoice.id })
      .from(invoice)
      .where(eq(invoice.id, a.invoiceId))
      .limit(1);
    return { ok: false, reason: exists ? "already_settled" : "not_found" };
  }

  if (inv.kind === "proration" && inv.deviceId) {
    await db
      .update(device)
      .set({ subscriptionPaidAt: now })
      .where(eq(device.id, inv.deviceId));
    return { ok: true };
  }

  if (inv.kind === "subscription") {
    const [settings] = await db
      .select({
        startedAt: tenantSettings.subscriptionStartedAt,
        renewsAt: tenantSettings.subscriptionRenewsAt,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, inv.organizationId))
      .limit(1);

    // First activation anchors the whole billing calendar. A renewal must NOT
    // recompute year one from the anchor — it advances the CURRENT renewal
    // date by twelve months, so a second renewal lands in year three.
    const isFirst = !settings?.startedAt;
    await db
      .update(tenantSettings)
      .set({
        subscriptionStartedAt: settings?.startedAt ?? now,
        subscriptionRenewsAt: isFirst
          ? renewalDueAt(now)
          : addMonthsAnchored(settings.renewsAt as Date, MONTHS_PER_YEAR),
        updatedAt: now,
      })
      .where(eq(tenantSettings.organizationId, inv.organizationId));

    const unpaid = await db
      .select({ id: device.id })
      .from(device)
      .where(
        and(
          eq(device.organizationId, inv.organizationId),
          isNull(device.subscriptionPaidAt),
          isNotNull(device.claimedAt),
        ),
      )
      .orderBy(asc(device.claimedAt));

    const toActivate = devicesToActivate({
      deviceCount: inv.deviceCount ?? 0,
      unpaidDeviceIds: unpaid.map((d) => d.id),
    });
    for (const deviceId of toActivate) {
      await db
        .update(device)
        .set({ subscriptionPaidAt: now })
        .where(eq(device.id, deviceId));
    }
    return { ok: true };
  }

  // overage: settles only itself, and burns the legacy credits it consumed.
  if (inv.kind === "overage" && (inv.creditsConsumed ?? 0) > 0) {
    await db
      .update(tenantSettings)
      .set({ legacyCreditsRemaining: 0, updatedAt: now })
      .where(eq(tenantSettings.organizationId, inv.organizationId));
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/invoices-payment.test.ts && npx tsc --noEmit`
Expected: PASS, zero type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/invoices.ts lib/invoices-payment.test.ts
git commit -m "feat(billing): mark invoice paid with device activation rules"
```

---

### Task 7: Subscription gate (trigger path)

Replaces the entire credit-reservation path with a boolean check plus a trial count that only runs for unpaid devices.

**Files:**
- Create: `lib/subscription-gate.ts`
- Test: `lib/subscription-gate.test.ts`

**Interfaces:**
- Consumes: `TRIAL_TRIGGERS_PER_DEVICE` from `lib/invoicing.ts`
- Produces:
  - `type GateDecision = { ok: true; reason: "subscribed" | "trial" } | { ok: false; reason: "device_not_subscribed" }`
  - `decideGate(a: { subscriptionPaidAt: Date | null; trialTriggersUsed: number }): GateDecision` (pure)
  - `checkSubscriptionGate(a: { deviceId: string; subscriptionPaidAt: Date | null }): Promise<GateDecision>`

- [ ] **Step 1: Write the failing test**

Create `lib/subscription-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideGate } from "./subscription-gate";

const paid = new Date("2026-08-15T00:00:00Z");

describe("decideGate", () => {
  it("lets a paid device through regardless of usage", () => {
    expect(decideGate({ subscriptionPaidAt: paid, trialTriggersUsed: 999_999 })).toEqual({
      ok: true,
      reason: "subscribed",
    });
  });

  it("lets an unpaid device through inside the trial", () => {
    expect(decideGate({ subscriptionPaidAt: null, trialTriggersUsed: 0 })).toEqual({
      ok: true,
      reason: "trial",
    });
    expect(decideGate({ subscriptionPaidAt: null, trialTriggersUsed: 49 })).toEqual({
      ok: true,
      reason: "trial",
    });
  });

  it("rejects an unpaid device at the trial ceiling", () => {
    expect(decideGate({ subscriptionPaidAt: null, trialTriggersUsed: 50 })).toEqual({
      ok: false,
      reason: "device_not_subscribed",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/subscription-gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/subscription-gate.ts`:

```ts
// The whole trigger-path billing decision. Post-paid overage means quota
// blocks nothing, so the only question left is whether this device is paid for
// — or still inside its trial.

import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { deviceCommand } from "./db/schema";
import { TRIAL_TRIGGERS_PER_DEVICE } from "./invoicing";

export type GateDecision =
  | { ok: true; reason: "subscribed" | "trial" }
  | { ok: false; reason: "device_not_subscribed" };

export function decideGate(a: {
  subscriptionPaidAt: Date | null;
  trialTriggersUsed: number;
}): GateDecision {
  if (a.subscriptionPaidAt) return { ok: true, reason: "subscribed" };
  return a.trialTriggersUsed < TRIAL_TRIGGERS_PER_DEVICE
    ? { ok: true, reason: "trial" }
    : { ok: false, reason: "device_not_subscribed" };
}

/**
 * A paid device costs ZERO extra queries — the trial count runs only on the
 * unpaid branch. The lifetime count needs no reset on payment because the
 * branch is skipped once subscriptionPaidAt is set.
 * Covered by device_command_device_status_idx.
 */
export async function checkSubscriptionGate(a: {
  deviceId: string;
  subscriptionPaidAt: Date | null;
}): Promise<GateDecision> {
  if (a.subscriptionPaidAt) return { ok: true, reason: "subscribed" };
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(deviceCommand)
    .where(
      and(
        eq(deviceCommand.deviceId, a.deviceId),
        eq(deviceCommand.type, "trigger"),
        eq(deviceCommand.status, "acked"),
      ),
    );
  return decideGate({
    subscriptionPaidAt: null,
    trialTriggersUsed: Number(row?.c ?? 0),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/subscription-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/subscription-gate.ts lib/subscription-gate.test.ts
git commit -m "feat(billing): subscription gate replacing credit reservation"
```

---

### Task 8: Rewire the trigger route

The route currently reserves credits, releases expired holds, and unwinds reservations on three separate failure paths. All of that goes; the MQTT fail-closed logic and the idempotency claim stay exactly as they are.

**Files:**
- Modify: `app/api/v1/devices/[deviceId]/trigger/route.ts`

**Interfaces:**
- Consumes: `checkSubscriptionGate` from `lib/subscription-gate.ts` (Task 7)
- Produces: nothing

- [ ] **Step 1: Replace the billing imports**

Remove these imports:

```ts
import { reserveTrigger, cancelTriggerReservation } from "@/lib/trigger-billing";
import { releaseExpiredHolds } from "@/lib/credit-holds";
import { validateTriggerBody, creditCostForAction } from "@/lib/trigger-actions";
```

Replace with:

```ts
import { validateTriggerBody } from "@/lib/trigger-actions";
import { checkSubscriptionGate } from "@/lib/subscription-gate";
```

- [ ] **Step 2: Gate right after the device-eligibility checks**

Immediately after the `device_offline` check and **before** the `mqttEnabled()` check, insert:

```ts
  // Post-paid overage means quota never blocks a request; the only billing
  // question left is whether this device is paid for (or still in trial).
  const gate = await checkSubscriptionGate({
    deviceId,
    subscriptionPaidAt: dev.subscriptionPaidAt,
  });
  if (!gate.ok) {
    return apiError(
      "device_not_subscribed",
      "This device has no active subscription. Contact Maratus to activate it.",
      403,
    );
  }
```

- [ ] **Step 3: Delete the reservation block**

Remove the `await releaseExpiredHolds(...)` call, the `const cost = creditCostForAction(v.action);` line, and the entire `const reserved = await reserveTrigger(...)` block including its `fair_use_exceeded` / `insufficient_credits` handling.

- [ ] **Step 4: Drop `billing` from the command insert**

In the `db.insert(deviceCommand).values({...})` call, remove `billing: reserved.billing,`.

- [ ] **Step 5: Simplify the two unwind paths**

In the `catch` around the command insert, replace the `cancelTriggerReservation(...)` call with nothing (delete the line) — the idempotency delete stays.

In the `if (!published)` branch, likewise delete the `cancelTriggerReservation(...)` call. Keep the `status: "pending"` predicate on the update and the "publish reported failure but command left pending state" early return exactly as they are — that logic is about MQTT ack races, not credits, and is still correct. Update its trailing comment: the sentence explaining that a stale release "can consume a DIFFERENT in-flight trigger's hold" no longer applies; replace that paragraph with:

```ts
    // A lost publish RESPONSE is not a lost publish: publishCommand allows two
    // 2-second attempts and measured ack latency is ~1.9s, so the device can
    // genuinely ack while we are still deciding the publish "failed". Only a
    // row still `pending` is safe to mark failed — otherwise we would overwrite
    // a real ack and report 503 for a trigger that actually reached the screen.
```

Also update the two response strings that mention credits: `"...No credit was charged; retrying will not help."` → `"...Retrying will not help."`, and `"...No credit was charged; retry."` → `"...Retry."`

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add "app/api/v1/devices/[deviceId]/trigger/route.ts"
git commit -m "refactor(trigger): gate on subscription instead of reserving credits"
```

---

### Task 9: Strip credit settlement from the ack path

**Files:**
- Modify: `lib/trigger-ack.ts`
- Modify: `lib/trigger-ack.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing

- [ ] **Step 1: Read the current module**

Run: `cat lib/trigger-ack.ts` and note every call into `lib/credits.ts` (`settleHold`, `releaseHold`) and every read of `deviceCommand.billing`.

- [ ] **Step 2: Remove settlement**

Delete the credit imports and calls. The ack path's remaining job is to move the command row to `acked` (or `expired`/`failed`) and stamp `ackedAt`. A trigger's cost is now derived at period close from the acked rows themselves, so there is nothing to settle.

- [ ] **Step 3: Update the tests**

In `lib/trigger-ack.test.ts`, delete assertions about credit settlement or the `billing` discriminator; keep every assertion about status transitions and `ackedAt`.

- [ ] **Step 4: Run tests**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, zero type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/trigger-ack.ts lib/trigger-ack.test.ts
git commit -m "refactor(billing): ack no longer settles credit holds"
```

---

### Task 10: Auto-issue a proration invoice on device claim

**Files:**
- Modify: `lib/device-claim.ts`

**Interfaces:**
- Consumes: `issueProrationInvoice` (Task 5), `monthsRemainingUntil` (Task 2), `periodStartFor` / `periodEndFor` (Task 1)
- Produces: nothing

- [ ] **Step 1: Read the claim flow**

Run: `cat lib/device-claim.ts` and find where `claimDevice` finishes binding the device to a store and sets `claimedAt`.

- [ ] **Step 2: Issue the proration after a successful claim**

After the device is successfully claimed, add:

```ts
  // A device claimed mid-year is billed for the remaining months of the org's
  // subscription year and stays UNPAID (contributing no quota) until that
  // invoice is marked paid.
  const [settings] = await db
    .select({
      startedAt: tenantSettings.subscriptionStartedAt,
      renewsAt: tenantSettings.subscriptionRenewsAt,
      price: tenantSettings.pricePerDeviceCents,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, organizationId))
    .limit(1);

  // No subscription yet → nothing to pro-rate; the device rides the org's first
  // subscription invoice instead.
  if (settings?.startedAt && settings.renewsAt) {
    const now = new Date();
    await issueProrationInvoice({
      organizationId,
      deviceId,
      pricePerDeviceCents: settings.price,
      monthsRemaining: monthsRemainingUntil(settings.renewsAt, now),
      periodStart: periodStartFor(settings.startedAt, now),
      periodEnd: periodEndFor(settings.startedAt, now),
      issuedAt: now,
    });
  }
```

Adapt the variable names (`organizationId`, `deviceId`) to whatever the surrounding function actually uses, and add the imports.

- [ ] **Step 3: Verify claiming still works when issuing fails**

Confirm the proration call cannot throw the claim away — a failed invoice write must not un-claim a device that is already bound. If `issueProrationInvoice` can reject, wrap it in `try/catch` that logs and continues.

- [ ] **Step 4: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add lib/device-claim.ts
git commit -m "feat(billing): pro-rate a device claimed mid-subscription"
```

---

### Task 11: Billing cron

**Files:**
- Create: `app/api/cron/billing/route.ts`
- Create: `lib/billing-cron.ts`
- Modify: `vercel.json`
- Delete: `app/api/cron/credit-holds/route.ts`

**Interfaces:**
- Consumes: `countPaidDevices`, `countAckedTriggers`, `issueOverageInvoice`, `issueSubscriptionInvoice` (Task 5); `periodStartFor`, `periodEndFor`, `addMonthsAnchored` (Task 1); `FAIR_USE_TRIGGERS_PER_DEVICE_MONTH` (Task 2)
- Produces: `runBillingCron(now?: Date): Promise<{ overageIssued: number; renewalsIssued: number; overdue: number; fairUseAlerts: number }>`

- [ ] **Step 1: Write the cron logic**

Create `lib/billing-cron.ts`:

```ts
// Daily billing sweep. Three jobs, all idempotent:
//   1. close each org's finished period and invoice its overage
//   2. issue renewal invoices 30 days ahead so there is time to transfer
//   3. surface overdue invoices and fair-use abuse as alerts
//
// Idempotency is the (organizationId, kind, periodStart) unique index, not a
// cursor — a second run the same day conflicts and does nothing.

import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { invoice, tenantSettings } from "./db/schema";
import { addMonthsAnchored, periodIndexFor } from "./billing-period";
import { FAIR_USE_TRIGGERS_PER_DEVICE_MONTH } from "./invoicing";
import {
  countAckedTriggers,
  countPaidDevices,
  issueOverageInvoice,
  issueSubscriptionInvoice,
} from "./invoices";

const RENEWAL_LEAD_DAYS = 30;

export async function runBillingCron(now: Date = new Date()): Promise<{
  overageIssued: number;
  renewalsIssued: number;
  overdue: number;
  fairUseAlerts: number;
}> {
  const orgs = await db
    .select({
      organizationId: tenantSettings.organizationId,
      startedAt: tenantSettings.subscriptionStartedAt,
      renewsAt: tenantSettings.subscriptionRenewsAt,
      price: tenantSettings.pricePerDeviceCents,
      overagePrice: tenantSettings.overagePriceCents,
      included: tenantSettings.includedTriggersPerDevice,
      legacyCredits: tenantSettings.legacyCreditsRemaining,
    })
    .from(tenantSettings)
    .where(
      and(
        isNotNull(tenantSettings.subscriptionStartedAt),
        isNull(tenantSettings.archivedAt),
      ),
    );

  let overageIssued = 0;
  let renewalsIssued = 0;

  for (const org of orgs) {
    const anchor = org.startedAt as Date;

    // 1. Close the PREVIOUS period — the current one is still accumulating.
    //    Index 0 means the first period has not closed yet, so there is
    //    nothing to invoice.
    const index = periodIndexFor(anchor, now);
    if (index >= 1) {
      const closedStart = addMonthsAnchored(anchor, index - 1);
      const closedEnd = addMonthsAnchored(anchor, index);
      const used = await countAckedTriggers({
        organizationId: org.organizationId,
        from: closedStart,
        to: closedEnd,
      });
      const paidDevices = await countPaidDevices(org.organizationId);
      const issued = await issueOverageInvoice({
        organizationId: org.organizationId,
        periodStart: closedStart,
        periodEnd: closedEnd,
        used,
        includedPerDevice: org.included,
        paidDeviceCount: paidDevices,
        overagePriceCents: org.overagePrice,
        legacyCredits: org.legacyCredits,
        issuedAt: now,
      });
      if (issued) overageIssued += 1;
    }

    // 2. Renewal, 30 days ahead.
    if (org.renewsAt) {
      const lead = new Date(
        org.renewsAt.getTime() - RENEWAL_LEAD_DAYS * 24 * 60 * 60 * 1000,
      );
      if (now.getTime() >= lead.getTime()) {
        const paidDevices = await countPaidDevices(org.organizationId);
        const issued = await issueSubscriptionInvoice({
          organizationId: org.organizationId,
          deviceCount: paidDevices,
          pricePerDeviceCents: org.price,
          periodStart: org.renewsAt,
          periodEnd: addMonthsAnchored(org.renewsAt, 12),
          issuedAt: now,
        });
        if (issued) renewalsIssued += 1;
      }
    }
  }

  // 3. Overdue count (surfaced in the admin UI; no automatic cut-off).
  const [overdueRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(invoice)
    .where(and(eq(invoice.status, "open"), lt(invoice.dueAt, now)));

  // 4. Fair-use abuse valve — a report, not a block. Nothing in the request
  //    path enforces it, so a runaway integration is caught within a day.
  const fairUseAlerts = await countFairUseBreaches(now);

  return {
    overageIssued,
    renewalsIssued,
    overdue: Number(overdueRow?.c ?? 0),
    fairUseAlerts,
  };
}

/**
 * Devices past the fair-use ceiling in the trailing 30 days. Logged rather
 * than blocked; the operator suspends the device from the admin panel.
 */
async function countFairUseBreaches(now: Date): Promise<number> {
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db.execute(sql`
    select device_id, count(*)::int as c
    from device_command
    where type = 'trigger' and status = 'acked' and created_at >= ${from}
    group by device_id
    having count(*) > ${FAIR_USE_TRIGGERS_PER_DEVICE_MONTH}
  `);
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown[]);
  for (const r of list as { device_id: string; c: number }[]) {
    console.warn("[billing] fair-use ceiling exceeded", {
      deviceId: r.device_id,
      triggers: r.c,
    });
  }
  return (list as unknown[]).length;
}
```

Note the brace structure in job 1: the `if (index >= 1) { ... }` block wraps the count, the paid-device lookup, and the `issueOverageInvoice` call. Close it before job 2 begins.

- [ ] **Step 2: Write the route**

Create `app/api/cron/billing/route.ts`, mirroring `app/api/cron/health/route.ts` exactly:

```ts
// GET /api/cron/billing — daily invoice sweep (Vercel cron).
// Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { runBillingCron } from "@/lib/billing-cron";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runBillingCron();
  return NextResponse.json({ ok: true, ...summary });
}
```

- [ ] **Step 3: Swap the cron registration**

Replace `vercel.json` with:

```json
{
  "crons": [
    { "path": "/api/cron/health", "schedule": "0 9 * * *" },
    { "path": "/api/cron/billing", "schedule": "0 9 * * *" }
  ]
}
```

Then delete the old route: `rm -r app/api/cron/credit-holds`

(Vercel Hobby allows two crons; the credit-holds sweep is obsolete because there are no holds.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron lib/billing-cron.ts vercel.json
git commit -m "feat(billing): daily invoice cron replacing credit-holds sweep"
```

---

### Task 12: Admin — subscription card and invoice actions

**Files:**
- Modify: `app/(admin)/admin/customers/[tenantId]/page.tsx`
- Create: `components/billing/subscription-card.tsx`
- Create: `components/billing/invoice-table.tsx`
- Create: `components/billing/mark-paid-dialog.tsx`
- Create: `lib/actions/invoices.ts`
- Delete: `lib/actions/credits.ts`, `lib/actions/billing-plan.ts`

**Interfaces:**
- Consumes: `listInvoices`, `markInvoicePaid`, `countPaidDevices`, `issueSubscriptionInvoice` (Tasks 5–6)
- Produces: server actions `startSubscriptionAction`, `markInvoicePaidAction`

- [ ] **Step 1: Read the existing page and its credit form**

Run: `cat "app/(admin)/admin/customers/[tenantId]/page.tsx"` and `cat lib/actions/credits.ts`. Match their structure: `requirePlatformAdmin()`, server actions with `revalidatePath`, shadcn `Card` / `Table` / `Dialog`.

- [ ] **Step 2: Write the server actions**

Create `lib/actions/invoices.ts`, mirroring the structure of `lib/actions/credits.ts` (read it first for the exact `requirePlatformAdmin` / audit / `revalidatePath` conventions this codebase uses):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { device, tenantSettings } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { addMonthsAnchored, MONTHS_PER_YEAR } from "@/lib/billing-period";
import { issueSubscriptionInvoice, markInvoicePaid } from "@/lib/invoices";
import { DEFAULT_PRICE_PER_DEVICE_CENTS } from "@/lib/invoicing";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function startSubscriptionAction(tenantId: string): Promise<ActionResult> {
  await requirePlatformAdmin();

  const [settings] = await db
    .select({ price: tenantSettings.pricePerDeviceCents })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1);

  const [devices] = await db
    .select({ c: count() })
    .from(device)
    .where(and(eq(device.organizationId, tenantId), isNotNull(device.claimedAt)));

  const deviceCount = Number(devices?.c ?? 0);
  if (deviceCount === 0) {
    return { ok: false, error: "This customer has no claimed devices to subscribe." };
  }

  const now = new Date();
  const issued = await issueSubscriptionInvoice({
    organizationId: tenantId,
    deviceCount,
    pricePerDeviceCents: settings?.price ?? DEFAULT_PRICE_PER_DEVICE_CENTS,
    periodStart: now,
    periodEnd: addMonthsAnchored(now, MONTHS_PER_YEAR),
    issuedAt: now,
  });
  if (!issued) {
    return { ok: false, error: "An invoice already exists for this period." };
  }

  revalidatePath(`/admin/customers/${tenantId}`);
  return { ok: true };
}

export async function markInvoicePaidAction(a: {
  tenantId: string;
  invoiceId: string;
  tryAmountKurus: number;
  fxRate: number;
}): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin();

  if (!Number.isInteger(a.tryAmountKurus) || a.tryAmountKurus <= 0) {
    return { ok: false, error: "Enter the transferred amount in kuruş (whole number)." };
  }
  if (!Number.isInteger(a.fxRate) || a.fxRate <= 0) {
    return { ok: false, error: "Enter the FX rate in kuruş per USD (whole number)." };
  }

  const result = await markInvoicePaid({
    invoiceId: a.invoiceId,
    tryAmountKurus: a.tryAmountKurus,
    fxRate: a.fxRate,
    userId: user.id,
  });
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "already_settled"
          ? "This invoice was already settled."
          : "Invoice not found.",
    };
  }

  revalidatePath(`/admin/customers/${a.tenantId}`);
  return { ok: true };
}
```

Adapt `requirePlatformAdmin()`'s return shape to whatever `lib/session.ts` actually provides (it may return the session rather than `{ user }`). Add an `auditLog` write to `markInvoicePaidAction` following the pattern the credit action used — payment settlement is exactly the kind of privileged action that page tracks.

- [ ] **Step 3: Build the components**

`components/billing/subscription-card.tsx` — a `Card` showing status (`Not subscribed` / `Active` / `Overdue`), start date, renewal date, paid device count, and annual amount (cents → dollars at the display edge). Includes the "Start subscription" button when `subscriptionStartedAt` is null.

`components/billing/invoice-table.tsx` — a `Table` of kind, period, amount (USD, plus frozen TRY when paid), status badge (`open` / `paid` / overdue when `open && dueAt < now`), due date, and a "Mark paid" trigger per open row.

`components/billing/mark-paid-dialog.tsx` — a client `Dialog` with TRY amount and FX rate inputs, disabled while pending (follow the existing dialog pending-lock pattern used elsewhere in the app).

- [ ] **Step 4: Wire into the customer page**

Add both to `app/(admin)/admin/customers/[tenantId]/page.tsx`. Remove the credit grant/deduct form and the plan selector; delete `lib/actions/credits.ts` and `lib/actions/billing-plan.ts` along with any component that only served them.

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`, sign in as `admin@maratus.app` / `123456`, open a customer, and confirm: the subscription card renders, "Start subscription" creates an open invoice, "Mark paid" moves it to paid and marks devices paid.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add "app/(admin)/admin/customers" components/billing lib/actions
git commit -m "feat(admin): subscription card, invoice table and mark-paid flow"
```

---

### Task 13: Tenant billing page

**Files:**
- Modify: `app/(tenant)/tenant/billing/page.tsx` (rewrite; currently 120 lines of credit UI)
- Create: `lib/bank-details.ts`
- Modify: `lib/data.ts` (add `getTenantBillingOverview`)

**Interfaces:**
- Consumes: `listInvoices`, `countPaidDevices`, `countAckedTriggers` (Task 5); `periodStartFor`, `periodEndFor` (Task 1); `overageFor` (Task 2)
- Produces: `getTenantBillingOverview(organizationId: string)` returning `{ subscribed: boolean; startedAt: Date | null; renewsAt: Date | null; paidDevices: number; includedTotal: number; used: number; overageTriggers: number; estimatedOverageUsdCents: number; periodStart: Date | null; periodEnd: Date | null }`

- [ ] **Step 1: Write the bank details constant**

Create `lib/bank-details.ts`:

```ts
// Bank transfer coordinates shown to every tenant. Platform-wide, identical
// for all customers, so they are a constant rather than a database row.
export const BANK_DETAILS = {
  accountName: "TODO: company legal name",
  bankName: "TODO: bank name",
  iban: "TODO: IBAN",
  currencyNote: "Prices are in USD; transfer the TRY equivalent at the day's rate.",
} as const;
```

Then ask the operator for the real values and fill them in before deploying — the placeholders above are the only ones permitted in this plan, and they must not survive to production.

- [ ] **Step 2: Add the data-layer function**

In `lib/data.ts`, add `getTenantBillingOverview`, following the file's existing conventions (Drizzle queries in, view models out, cents converted at the display edge by the page). It reads `tenantSettings`, computes the current period from the anchor, counts paid devices and acked triggers, and runs `overageFor` with `legacyCredits: 0` (the running estimate should not pre-spend credits that only settle at invoice time).

- [ ] **Step 3: Rewrite the page**

Replace `app/(tenant)/tenant/billing/page.tsx` entirely. Sections, using `PageHeader` + `PageSection`:

1. **Subscription** — status, start date, renewal date, paid devices, annual amount.
2. **This period** — `1,240 / 2,000 triggers`, period dates, and when over: `240 extra × $0.02 = $4.80 estimated`.
3. **Invoices** — `listInvoices` table: kind, period, amount, status, due date.
4. **How to pay** — `BANK_DETAILS`.

No write actions on this page; marking payment is platform-admin only. Remove every import of `getBalance`, `getCreditUsageByDevice`, and `getDeviceUsageThisMonth`.

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`, sign in as `dana@roastwell.co` / `123456`, visit `/tenant/billing`, confirm all four sections render and the numbers match what the admin page shows for the same org.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add "app/(tenant)/tenant/billing/page.tsx" lib/bank-details.ts lib/data.ts
git commit -m "feat(tenant): subscription billing page replacing credit UI"
```

---

### Task 14: Admin billing overview page

**Files:**
- Modify: `app/(admin)/admin/billing/page.tsx`
- Modify: `lib/data.ts` (replace `getCreditsOverview` / `getPlanMix`)
- Delete: `components/billing/plan-badge.tsx`

**Interfaces:**
- Consumes: `listInvoices` (Task 5)
- Produces: `getBillingOverview()` returning `{ totals: { openUsdCents: number; overdueUsdCents: number; paidThisYearUsdCents: number; subscribedOrgs: number; paidDevices: number }; perTenant: { orgId: string; name: string; paidDevices: number; renewsAt: Date | null; openUsdCents: number; overdue: boolean }[] }`

- [ ] **Step 1: Replace the data function**

In `lib/data.ts`, delete `getCreditsOverview` and `getPlanMix`, and add `getBillingOverview` per the shape above. Aggregate from `invoice` and `device`.

- [ ] **Step 2: Rewrite the page**

Keep the existing structure (`PageHeader` + `ExportButton` + three `KpiCard`s + a `Table`). Swap the KPIs to: **Open invoices**, **Overdue**, **Paid this year**. Swap the table columns to: Customer, Paid devices, Renews, Open amount, Status. Update the CSV export headers and rows to match. Remove the `PlanBadge` import and delete `components/billing/plan-badge.tsx`.

- [ ] **Step 3: Verify and commit**

Run: `npm run dev`, visit `/admin/billing` as the platform admin, confirm it renders with real data. Then:

Run: `npx tsc --noEmit && npm run lint`

```bash
git add "app/(admin)/admin/billing/page.tsx" lib/data.ts components/billing
git commit -m "feat(admin): billing overview reports invoices instead of credits"
```

---

### Task 15: Remove the credit subsystem

Everything the new path no longer references. Do this only after Tasks 8–14 are green, so the compiler tells you what is genuinely orphaned.

**Files:**
- Delete: `lib/credits.ts`, `lib/credit-holds.ts`, `lib/credits-overview.ts`, `lib/billing-plan.ts`, `lib/trigger-billing.ts`, `lib/device-usage.ts`
- Delete: `lib/credits.starter.test.ts`, `lib/credits-overview.test.ts`, `lib/billing-plan.test.ts`, `lib/credit-usage.test.ts`
- Modify: `lib/credit-usage.ts` (retarget), `lib/data.ts`, `lib/actions/register.ts`, `lib/trigger-actions.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `rollupTriggersByDevice(rows: { deviceId: string | null }[]): { total: number; byDevice: { deviceId: string; count: number }[] }`

- [ ] **Step 1: Retarget the per-device usage rollup**

`lib/credit-usage.ts` currently groups `creditLedger.settle` rows by device. Rename the file to `lib/trigger-usage.ts` and replace `rollupByDevice` with `rollupTriggersByDevice` above — same grouping, but counting rows instead of summing credits, since a trigger is one unit. Update `lib/credit-usage.test.ts` → `lib/trigger-usage.test.ts` accordingly, keeping the grouping and `"unknown"` fallback assertions.

- [ ] **Step 2: Delete the modules**

```bash
git rm lib/credits.ts lib/credit-holds.ts lib/credits-overview.ts \
       lib/billing-plan.ts lib/trigger-billing.ts lib/device-usage.ts \
       lib/credits.starter.test.ts lib/credits-overview.test.ts lib/billing-plan.test.ts
```

- [ ] **Step 3: Fix the fallout**

Run: `npx tsc --noEmit` and fix every error it reports. Expected sites:
- `lib/data.ts` — remove `creditBalance` / `creditLedger` imports, `getBalance`, `getCreditLedger`, `getCreditUsageByDevice`, `getDeviceUsageThisMonth`, and the `creditsAvailable` / `creditsUsedThisMonth` fields on the dashboard view model. Replace the dashboard's credit KPI with the current period's trigger usage.
- `lib/actions/register.ts` — remove the `grantCredits` / `STARTER_CREDITS` starter grant; a new org now begins unsubscribed with its devices on the 50-trigger trial.
- `lib/trigger-actions.ts` — remove `creditCostForAction` and its tests if nothing else uses it.
- `app/api/v1/usage/route.ts` (if present) — drop the credit fields from the machine-keyed usage payload.

- [ ] **Step 4: Run the full suite**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all green. The suite will be smaller by roughly 40 credit/plan tests; that is expected.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(billing): delete the credit subsystem"
```

---

### Task 16: Cutover — destructive migration and deploy runbook

**Files:**
- Modify: `lib/db/schema.ts` (drop `billingPlan`, `deviceCommand.billing`, `creditBalance`, `creditLedger`, `deviceUsageMonth`)
- Modify: `lib/db/relations.ts`
- Create: `drizzle/0043_*.sql`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 1: Deploy the additive half FIRST**

In this exact order, stopping if any step misbehaves:

```bash
npm run db:migrate                          # applies 0042 (additive only)
npx tsx lib/db/backfill-subscriptions.ts    # ⚠️ writes to PRODUCTION
```

Read the backfill's summary line and sanity-check the counts against what you expect (orgs subscribed, devices marked paid, balances carried).

- [ ] **Step 2: Deploy the application**

```bash
vercel --prod --yes
```

- [ ] **Step 3: Verify on production before dropping anything**

Confirm all three, and do not proceed until they hold:
1. A real device still triggers successfully (its `subscriptionPaidAt` is set by the backfill).
2. `/admin/billing` and a customer detail page render.
3. `/tenant/billing` renders for a real tenant.

- [ ] **Step 4: Now remove the dropped tables from the schema**

In `lib/db/schema.ts` delete: `tenantSettings.billingPlan`, `deviceCommand.billing`, and the `creditBalance`, `creditLedger`, `deviceUsageMonth` table definitions plus their entries in the export object. Remove their relations from `lib/db/relations.ts`.

- [ ] **Step 5: Generate and trim the destructive migration**

Run: `npm run db:generate`

Open `drizzle/0043_*.sql` and strip it to exactly: three `DROP TABLE` statements and two `ALTER TABLE ... DROP COLUMN` statements. Nothing else.

- [ ] **Step 6: Typecheck, build, commit, deploy**

```bash
npx tsc --noEmit && npm test && npm run build
git add -A
git commit -m "feat(db): drop credit tables and billing_plan (migration 0043)"
npm run db:migrate
vercel --prod --yes
```

- [ ] **Step 7: Update project documentation**

In `CLAUDE.md`, update the data-model and device-trigger sections: the app tables list loses `creditBalance`/`creditLedger`/`deviceUsageMonth` and gains `invoice`; the trigger flow no longer "reserves 1 credit" but checks the subscription gate; the seed-accounts section drops the "starter grant of prepaid credits" line.

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for subscription billing"
```

---

## Deferred (explicitly not in this plan)

- **Resend domain verification.** Until it is done no invoice email reaches a customer, so the tenant invoice list is the delivery channel and the operator notifies customers out of band.
- **iyzico adapter** on the `markInvoicePaid` seam.
- **Invoice PDF / e-arşiv.** Legal invoices are issued outside the system.
- **VAT (KDV).** All amounts here are tax-exclusive.
- **Seed data.** `lib/db/seed.ts` still grants credits; it will fail to typecheck in Task 15 and should be updated to create a subscribed org with paid devices instead.
