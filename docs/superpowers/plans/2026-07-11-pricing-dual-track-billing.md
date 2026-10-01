# Dual-Track Pricing Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the engineering side of the dual-track pricing spec (`docs/superpowers/specs/2026-07-11-pricing-dual-track-design.md`): a per-org billing plan (`credits` | `flat` | `base_usage`), an included-quota-then-credits layer in the trigger path, a per-device monthly usage counter, Stripe device-quantity subscription sync, an admin plan control, and usage visibility.

**Architecture:** A `billingPlan` column on `tenantSettings` selects how triggers are paid. A new `device_usage_month` counter table is bumped atomically on every trigger reservation and drives both the Track C included-quota decision and the Track B fair-use ceiling — and doubles as the usage-reporting rollup. A `billing` marker on `device_command` ("credits" vs "included") tells the ack/expiry paths whether credits move. Stripe billing for flat/base plans is a quantity-based subscription (quantity = claimed device count) synced fail-open on device lifecycle events plus the daily cron.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM over neon-http, Stripe Node SDK, vitest (pure-function tests only, per repo convention).

## Global Constraints

- `organization = tenant`; every new table/column carrying org data FKs `organizationId` with `onDelete: "cascade"` and gets an org index (CLAUDE.md data-model rule).
- Repo test convention: pure decision logic lives in its own module with a colocated `*.test.ts`; DB/IO modules are not unit-tested. Test runner: `npm test` (vitest run).
- Drizzle snapshot drift hazard: after `npm run db:generate`, hand-strip the generated SQL to only the statements listed in the task (memory: `drizzle-snapshot-drift`).
- ⚠️ `.env.local` points at PROD Neon. Do NOT run `npm run db:migrate` or `npm run db:push` during implementation — migration application is an explicit, user-approved deploy step at the end.
- Device-facing flows must never block on Stripe: all subscription-sync calls are try/caught and logged (fail-open), matching the payment-enforcement precedent.
- Spec constants: fair-use = 300,000 triggers/device/month; default included quota (Track C) = 2,000 triggers/device/month; plan default = `credits`.
- Legacy behavior is the default: an org with `billingPlan = 'credits'` must behave byte-for-byte as today (402 on insufficient credits, hold/settle/release unchanged).
- Adaptive polling (12s open-hours / 60s closed) is **firmware work in the maratus-firmware repo — out of scope for this plan**; plan it separately.
- Out of scope, per spec: Stripe webhook handling of subscription lifecycle (payment failure → suspension), TRY invoicing, reseller pricing.

---

### Task 1: Schema — billing plan columns, usage counter table, command billing marker

**Files:**
- Modify: `lib/db/schema.ts` (tenantSettings ~line 200, deviceCommand ~line 331, new table after `creditLedger` ~line 405)
- Create: `drizzle/0032_<generated-name>.sql` (via `npm run db:generate`, then hand-stripped)

**Interfaces:**
- Produces: `tenantSettings.billingPlan` (`"credits" | "flat" | "base_usage"`, default `"credits"`), `tenantSettings.includedTriggersPerDevice` (int, default 2000), `tenantSettings.stripeSubscriptionId`, `tenantSettings.stripeSubscriptionItemId` (nullable text), `deviceCommand.billing` (`"credits" | "included"`, nullable), table `deviceUsageMonth` with PK `(deviceId, month)`.

- [ ] **Step 1: Add tenantSettings columns**

In `lib/db/schema.ts`, inside `tenantSettings`, directly below `stripeCustomerId`:

```ts
  // --- Pricing plan (dual-track pricing spec 2026-07-11) -------------------
  // credits    = prepaid credits only (self-service default; legacy behavior)
  // flat       = Track B: per-device subscription, unlimited triggers (fair-use)
  // base_usage = Track C: per-device base + included monthly quota, credit overage
  billingPlan: text("billing_plan", { enum: ["credits", "flat", "base_usage"] })
    .default("credits")
    .notNull(),
  // Track C: triggers included per device per calendar month (UTC).
  includedTriggersPerDevice: integer("included_triggers_per_device")
    .default(2000)
    .notNull(),
  // Per-device quantity subscription (flat/base plans). The item holds the
  // quantity (= claimed device count).
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeSubscriptionItemId: text("stripe_subscription_item_id"),
```

- [ ] **Step 2: Add deviceCommand.billing marker**

Inside `deviceCommand`, below `action`:

```ts
    // How this trigger was paid: "credits" = a credit hold exists for this
    // commandId; "included" = covered by the org's plan (flat / base quota) —
    // ack/expiry must NOT move credits for "included". Null on non-trigger
    // commands and on pre-plan legacy rows (treated as "credits").
    billing: text("billing", { enum: ["credits", "included"] }),
```

- [ ] **Step 3: Add deviceUsageMonth table**

After `creditLedger` (before `apiIdempotency`):

```ts
// Per-device monthly trigger counter (calendar month, UTC, "YYYY-MM").
// Bumped at trigger-reservation time (counts attempts, not acks — an expired
// included trigger deliberately still consumes a quota unit; accepted spec
// trade-off). Drives Track C included-quota checks, Track B fair-use, and
// usage reporting.
export const deviceUsageMonth = pgTable(
  "device_usage_month",
  {
    deviceId: text("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    triggers: integer("triggers").notNull().default(0),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.month] }),
    index("device_usage_month_org_month_idx").on(t.organizationId, t.month),
  ],
);
```

- [ ] **Step 4: Generate migration and hand-strip it**

Run: `npm run db:generate`
Expected: a new `drizzle/0032_*.sql`. Open it and delete everything except:
- `CREATE TABLE "device_usage_month" ...` (+ its two FK `ALTER TABLE ... ADD CONSTRAINT` statements and the `device_usage_month_org_month_idx` index)
- the four `ALTER TABLE "tenant_settings" ADD COLUMN ...` statements
- `ALTER TABLE "device_command" ADD COLUMN "billing" text;`

Any other FK churn is snapshot drift — delete it. Do NOT run `db:migrate`/`db:push` (PROD env).

- [ ] **Step 5: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (no code consumes the columns yet).

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(billing): schema for dual-track pricing — plan columns, device_usage_month, command billing marker"
```

---

### Task 2: Pure plan decision logic — `lib/billing-plan.ts`

**Files:**
- Create: `lib/billing-plan.ts`
- Test: `lib/billing-plan.test.ts`

**Interfaces:**
- Produces: `type BillingPlan = "credits" | "flat" | "base_usage"`; `FAIR_USE_TRIGGERS_PER_DEVICE_MONTH = 300_000`; `DEFAULT_INCLUDED_TRIGGERS = 2_000`; `monthKey(d: Date): string`; `triggerBillingDecision(a: { plan: BillingPlan; includedTriggersPerDevice: number; usedThisMonth: number }): TriggerBillingDecision` where `TriggerBillingDecision = { mode: "credits" } | { mode: "included" } | { mode: "fair_use_exceeded" }`.

- [ ] **Step 1: Write the failing tests**

`lib/billing-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_INCLUDED_TRIGGERS,
  FAIR_USE_TRIGGERS_PER_DEVICE_MONTH,
  monthKey,
  triggerBillingDecision,
} from "./billing-plan";

describe("monthKey", () => {
  it("formats a UTC calendar month", () => {
    expect(monthKey(new Date("2026-07-11T21:00:00Z"))).toBe("2026-07");
  });
  it("uses UTC at year boundaries", () => {
    expect(monthKey(new Date("2025-12-31T23:59:59Z"))).toBe("2025-12");
    expect(monthKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
  it("zero-pads single-digit months", () => {
    expect(monthKey(new Date("2026-03-05T12:00:00Z"))).toBe("2026-03");
  });
});

describe("triggerBillingDecision", () => {
  it("credits plan always pays with credits", () => {
    expect(
      triggerBillingDecision({ plan: "credits", includedTriggersPerDevice: 2000, usedThisMonth: 1 }),
    ).toEqual({ mode: "credits" });
  });

  it("flat plan is included up to and including the fair-use ceiling", () => {
    expect(
      triggerBillingDecision({
        plan: "flat", includedTriggersPerDevice: 2000,
        usedThisMonth: FAIR_USE_TRIGGERS_PER_DEVICE_MONTH,
      }),
    ).toEqual({ mode: "included" });
  });

  it("flat plan rejects past the fair-use ceiling", () => {
    expect(
      triggerBillingDecision({
        plan: "flat", includedTriggersPerDevice: 2000,
        usedThisMonth: FAIR_USE_TRIGGERS_PER_DEVICE_MONTH + 1,
      }),
    ).toEqual({ mode: "fair_use_exceeded" });
  });

  it("base_usage is included up to and including the quota", () => {
    expect(
      triggerBillingDecision({ plan: "base_usage", includedTriggersPerDevice: 2000, usedThisMonth: 2000 }),
    ).toEqual({ mode: "included" });
  });

  it("base_usage falls through to credits past the quota", () => {
    expect(
      triggerBillingDecision({ plan: "base_usage", includedTriggersPerDevice: 2000, usedThisMonth: 2001 }),
    ).toEqual({ mode: "credits" });
  });

  it("exports the spec default quota", () => {
    expect(DEFAULT_INCLUDED_TRIGGERS).toBe(2000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/billing-plan.test.ts`
Expected: FAIL — cannot resolve `./billing-plan`.

- [ ] **Step 3: Implement `lib/billing-plan.ts`**

```ts
// Pure decision logic for the dual-track pricing plans
// (docs/superpowers/specs/2026-07-11-pricing-dual-track-design.md).

export type BillingPlan = "credits" | "flat" | "base_usage";

/** Fair-use ceiling for flat-plan devices (~10K/day; abuse valve, not a bill). */
export const FAIR_USE_TRIGGERS_PER_DEVICE_MONTH = 300_000;

/** Track C default: triggers included per device per calendar month. */
export const DEFAULT_INCLUDED_TRIGGERS = 2_000;

/** Calendar-month key in UTC, e.g. "2026-07". */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type TriggerBillingDecision =
  | { mode: "credits" } // reserve a credit hold (legacy path)
  | { mode: "included" } // covered by the plan; no credit movement
  | { mode: "fair_use_exceeded" }; // flat plan over the ceiling → reject

/**
 * Decide how a trigger is paid. `usedThisMonth` is the device's usage counter
 * AFTER counting this trigger (bump-then-decide), so `<=` keeps boundary
 * triggers included.
 */
export function triggerBillingDecision(a: {
  plan: BillingPlan;
  includedTriggersPerDevice: number;
  usedThisMonth: number;
}): TriggerBillingDecision {
  switch (a.plan) {
    case "flat":
      return a.usedThisMonth > FAIR_USE_TRIGGERS_PER_DEVICE_MONTH
        ? { mode: "fair_use_exceeded" }
        : { mode: "included" };
    case "base_usage":
      return a.usedThisMonth <= a.includedTriggersPerDevice
        ? { mode: "included" }
        : { mode: "credits" };
    case "credits":
      return { mode: "credits" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/billing-plan.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/billing-plan.ts lib/billing-plan.test.ts
git commit -m "feat(billing): pure dual-track trigger billing decision logic"
```

---

### Task 3: Usage counter — `lib/device-usage.ts`

**Files:**
- Create: `lib/device-usage.ts`

**Interfaces:**
- Consumes: `deviceUsageMonth` (Task 1).
- Produces: `bumpDeviceUsage(a: { deviceId: string; organizationId: string; month: string }): Promise<number>` (post-increment count), `unbumpDeviceUsage(a: { deviceId: string; month: string }): Promise<void>`, `getOrgUsageForMonth(organizationId: string, month: string): Promise<{ deviceId: string; triggers: number }[]>`.

- [ ] **Step 1: Implement `lib/device-usage.ts`**

```ts
// Per-device monthly trigger counter over device_usage_month.
// bump is a single atomic UPSERT increment returning the post-increment count
// (same CAS style as lib/credits.ts); unbump compensates a reservation that
// was rejected after the bump (fair-use / insufficient credits / enqueue
// failure), guarded so it can never go negative.

import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { deviceUsageMonth } from "./db/schema";

export async function bumpDeviceUsage(a: {
  deviceId: string;
  organizationId: string;
  month: string;
}): Promise<number> {
  const [row] = await db
    .insert(deviceUsageMonth)
    .values({
      deviceId: a.deviceId,
      organizationId: a.organizationId,
      month: a.month,
      triggers: 1,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [deviceUsageMonth.deviceId, deviceUsageMonth.month],
      set: {
        triggers: sql`${deviceUsageMonth.triggers} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ triggers: deviceUsageMonth.triggers });
  return row.triggers;
}

export async function unbumpDeviceUsage(a: {
  deviceId: string;
  month: string;
}): Promise<void> {
  await db
    .update(deviceUsageMonth)
    .set({ triggers: sql`${deviceUsageMonth.triggers} - 1`, updatedAt: new Date() })
    .where(
      and(
        eq(deviceUsageMonth.deviceId, a.deviceId),
        eq(deviceUsageMonth.month, a.month),
        gt(deviceUsageMonth.triggers, 0),
      ),
    );
}

export async function getOrgUsageForMonth(
  organizationId: string,
  month: string,
): Promise<{ deviceId: string; triggers: number }[]> {
  return db
    .select({
      deviceId: deviceUsageMonth.deviceId,
      triggers: deviceUsageMonth.triggers,
    })
    .from(deviceUsageMonth)
    .where(
      and(
        eq(deviceUsageMonth.organizationId, organizationId),
        eq(deviceUsageMonth.month, month),
      ),
    );
}
```

- [ ] **Step 2: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (DB module; no unit tests per repo convention — the decision logic it feeds is tested in Task 2).

- [ ] **Step 3: Commit**

```bash
git add lib/device-usage.ts
git commit -m "feat(billing): atomic per-device monthly usage counter"
```

---

### Task 4: Trigger reservation orchestrator + trigger route wiring

**Files:**
- Create: `lib/trigger-billing.ts`
- Modify: `app/api/v1/devices/[deviceId]/trigger/route.ts:8` (imports), `:70-85` (reserve + enqueue block)

**Interfaces:**
- Consumes: `triggerBillingDecision`, `monthKey`, `DEFAULT_INCLUDED_TRIGGERS`, `BillingPlan` (Task 2); `bumpDeviceUsage`, `unbumpDeviceUsage` (Task 3); `reserveCredit`, `releaseHold` (`lib/credits.ts`, unchanged).
- Produces: `reserveTrigger(a: { organizationId: string; deviceId: string; action: string; commandId: string; cost: number }): Promise<TriggerReservation>` where `TriggerReservation = { ok: true; billing: "credits" | "included"; month: string } | { ok: false; reason: "insufficient_credits" | "fair_use_exceeded" }`; `cancelTriggerReservation(a: { organizationId: string; deviceId: string; commandId: string; cost: number; billing: "credits" | "included"; month: string }): Promise<void>`.

- [ ] **Step 1: Implement `lib/trigger-billing.ts`**

```ts
// Orchestrates how a trigger is paid: org plan lookup → usage bump → decision
// → credit hold only on the credits path. Bump-then-decide keeps the quota
// check O(1) and race-safe; every rejection path compensates the bump so a
// failed call never burns quota.

import { eq } from "drizzle-orm";
import { db } from "./db";
import { tenantSettings } from "./db/schema";
import {
  DEFAULT_INCLUDED_TRIGGERS,
  monthKey,
  triggerBillingDecision,
  type BillingPlan,
} from "./billing-plan";
import { bumpDeviceUsage, unbumpDeviceUsage } from "./device-usage";
import { releaseHold, reserveCredit } from "./credits";

export type TriggerReservation =
  | { ok: true; billing: "credits" | "included"; month: string }
  | { ok: false; reason: "insufficient_credits" | "fair_use_exceeded" };

export async function reserveTrigger(a: {
  organizationId: string;
  deviceId: string;
  action: string;
  commandId: string;
  cost: number;
}): Promise<TriggerReservation> {
  const [settings] = await db
    .select({
      plan: tenantSettings.billingPlan,
      included: tenantSettings.includedTriggersPerDevice,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, a.organizationId))
    .limit(1);
  const plan: BillingPlan = settings?.plan ?? "credits";
  const month = monthKey(new Date());

  const used = await bumpDeviceUsage({
    deviceId: a.deviceId,
    organizationId: a.organizationId,
    month,
  });
  const decision = triggerBillingDecision({
    plan,
    includedTriggersPerDevice: settings?.included ?? DEFAULT_INCLUDED_TRIGGERS,
    usedThisMonth: used,
  });

  if (decision.mode === "fair_use_exceeded") {
    await unbumpDeviceUsage({ deviceId: a.deviceId, month });
    return { ok: false, reason: "fair_use_exceeded" };
  }
  if (decision.mode === "included") return { ok: true, billing: "included", month };

  const reserved = await reserveCredit(a);
  if (!reserved.ok) {
    await unbumpDeviceUsage({ deviceId: a.deviceId, month });
    return { ok: false, reason: "insufficient_credits" };
  }
  return { ok: true, billing: "credits", month };
}

/** Undo a successful reserveTrigger (e.g. the command enqueue failed). */
export async function cancelTriggerReservation(a: {
  organizationId: string;
  deviceId: string;
  commandId: string;
  cost: number;
  billing: "credits" | "included";
  month: string;
}): Promise<void> {
  if (a.billing === "credits") {
    await releaseHold({
      organizationId: a.organizationId,
      commandId: a.commandId,
      cost: a.cost,
      deviceId: a.deviceId,
    });
  }
  await unbumpDeviceUsage({ deviceId: a.deviceId, month: a.month });
}
```

- [ ] **Step 2: Wire the trigger route**

In `app/api/v1/devices/[deviceId]/trigger/route.ts`:

Replace the import on line 8:

```ts
import { reserveTrigger, cancelTriggerReservation } from "@/lib/trigger-billing";
```

(`reserveCredit`/`releaseHold` are no longer imported here; `releaseExpiredHolds` stays.)

Replace lines 69–85 (the reserve + enqueue block) with:

```ts
  // We own the claim. Reserve (plan-aware); on failure, release the claim so a retry can proceed.
  const reserved = await reserveTrigger({ organizationId: auth.organizationId, deviceId, action: v.action, commandId, cost });
  if (!reserved.ok) {
    await db.delete(apiIdempotency).where(and(eq(apiIdempotency.key, idemKey), eq(apiIdempotency.organizationId, auth.organizationId)));
    if (reserved.reason === "fair_use_exceeded") {
      return apiError("fair_use_exceeded", "Fair-use trigger ceiling reached for this device this month.", 429);
    }
    return apiError("insufficient_credits", "Not enough credits.", 402);
  }

  try {
    await db.insert(deviceCommand).values({
      id: commandId, deviceId, organizationId: auth.organizationId, type: "trigger",
      status: "pending", action: v.action, payload: v.payload, billing: reserved.billing,
      expiresAt: new Date(Date.now() + TTL_MS),
    });
  } catch {
    await cancelTriggerReservation({ organizationId: auth.organizationId, deviceId, commandId, cost, billing: reserved.billing, month: reserved.month });
    await db.delete(apiIdempotency).where(and(eq(apiIdempotency.key, idemKey), eq(apiIdempotency.organizationId, auth.organizationId)));
    return apiError("internal_error", "Could not enqueue the command.", 500);
  }
```

- [ ] **Step 3: Typecheck, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all PASS. (Orgs default to `credits` → behavior identical to before; existing flows unaffected.)

- [ ] **Step 4: Commit**

```bash
git add lib/trigger-billing.ts "app/api/v1/devices/[deviceId]/trigger/route.ts"
git commit -m "feat(billing): plan-aware trigger reservation (included quota → credits, fair-use ceiling)"
```

---

### Task 5: Ack and expiry paths respect the billing marker

**Files:**
- Modify: `app/api/device/commands/ack/route.ts:31-38`
- Modify: `lib/credit-holds.ts:30-55`

**Interfaces:**
- Consumes: `deviceCommand.billing` (Task 1).
- Produces: no new exports — behavioral guarantee that `settleHold`/`releaseHold` are only called for commands with `billing !== "included"` (null = legacy = credits).

Why this matters: `settleHold`/`releaseHold` guard on the ORG-aggregate `held >= cost`. A quota-covered command has no hold; if the org has OTHER outstanding holds, a stray settle/release for an included command would corrupt another command's hold. The marker is the only safe discriminator.

- [ ] **Step 1: Guard the ack route**

In `app/api/device/commands/ack/route.ts`, add `billing` to the `.returning(...)`:

```ts
    .returning({ id: deviceCommand.id, type: deviceCommand.type, action: deviceCommand.action, organizationId: deviceCommand.organizationId, deviceId: deviceCommand.deviceId, billing: deviceCommand.billing });
```

and change the settle/release condition:

```ts
  // Included (plan-covered) triggers never move credits; null billing = legacy credit-held rows.
  if (cmd && cmd.type === "trigger" && cmd.billing !== "included") {
```

- [ ] **Step 2: Guard the expiry sweep**

In `lib/credit-holds.ts`, add `billing: deviceCommand.billing` to the `select({...})` (line ~31), and in the loop wrap the release:

```ts
    if (!won) continue; // lost the race to an ack
    // Included (plan-covered) triggers hold no credits — expiring the command is enough.
    if (c.billing !== "included") {
      await releaseHold({
        organizationId: c.organizationId,
        commandId: c.id,
        cost: creditCostForAction((c.action ?? "show_qr") as "show_qr"),
        deviceId: c.deviceId,
      });
      released++;
    }
```

(`released` keeps counting only actual credit releases.)

- [ ] **Step 3: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/device/commands/ack/route.ts lib/credit-holds.ts
git commit -m "fix(billing): ack/expiry skip credit moves for plan-included triggers"
```

---

### Task 6: Stripe device-quantity subscription sync

**Files:**
- Create: `lib/billing/device-subscription-logic.ts` (pure)
- Test: `lib/billing/device-subscription-logic.test.ts`
- Create: `lib/billing/device-subscription.ts` (Stripe/DB IO)
- Modify: `lib/env.ts:43` (two new optional vars, next to `STRIPE_CREDIT_PACK_PRICE_IDS`)
- Modify: `.env.example` (document the two vars)
- Modify: `lib/documents.ts` — end of `claimDevice` (line ~26 onward): fire fail-open sync
- Modify: `app/api/cron/health/route.ts` — fold in daily reconcile (same pattern as the offline reconcile fold-in)

**Interfaces:**
- Consumes: `tenantSettings.billingPlan/stripeSubscriptionId/stripeSubscriptionItemId` (Task 1), `ensureStripeCustomer` (`lib/billing/stripe-billing.ts`), `stripe` (`lib/stripe`), `BillingPlan` (Task 2).
- Produces: `desiredSubscriptionState(a: { plan: BillingPlan; deviceCount: number; hasSubscription: boolean; priceId: string | null }): DesiredSub` with `DesiredSub = { action: "none" } | { action: "cancel" } | { action: "create"; priceId: string; quantity: number } | { action: "update"; priceId: string; quantity: number }`; `syncDeviceSubscription(organizationId: string): Promise<void>`; `syncAllDeviceSubscriptions(): Promise<{ synced: number; failed: number }>`.

- [ ] **Step 1: Write the failing pure-logic tests**

`lib/billing/device-subscription-logic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { desiredSubscriptionState } from "./device-subscription-logic";

describe("desiredSubscriptionState", () => {
  it("credits plan with no subscription → none", () => {
    expect(
      desiredSubscriptionState({ plan: "credits", deviceCount: 5, hasSubscription: false, priceId: null }),
    ).toEqual({ action: "none" });
  });

  it("credits plan with a leftover subscription → cancel", () => {
    expect(
      desiredSubscriptionState({ plan: "credits", deviceCount: 5, hasSubscription: true, priceId: null }),
    ).toEqual({ action: "cancel" });
  });

  it("flat plan with devices and no subscription → create with device quantity", () => {
    expect(
      desiredSubscriptionState({ plan: "flat", deviceCount: 12, hasSubscription: false, priceId: "price_flat" }),
    ).toEqual({ action: "create", priceId: "price_flat", quantity: 12 });
  });

  it("flat plan with an existing subscription → update quantity", () => {
    expect(
      desiredSubscriptionState({ plan: "flat", deviceCount: 3, hasSubscription: true, priceId: "price_flat" }),
    ).toEqual({ action: "update", priceId: "price_flat", quantity: 3 });
  });

  it("zero devices cancels an existing subscription", () => {
    expect(
      desiredSubscriptionState({ plan: "flat", deviceCount: 0, hasSubscription: true, priceId: "price_flat" }),
    ).toEqual({ action: "cancel" });
  });

  it("unconfigured price id is a no-op / cancel (env not set)", () => {
    expect(
      desiredSubscriptionState({ plan: "base_usage", deviceCount: 4, hasSubscription: false, priceId: null }),
    ).toEqual({ action: "none" });
    expect(
      desiredSubscriptionState({ plan: "base_usage", deviceCount: 4, hasSubscription: true, priceId: null }),
    ).toEqual({ action: "cancel" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/billing/device-subscription-logic.test.ts`
Expected: FAIL — cannot resolve `./device-subscription-logic`.

- [ ] **Step 3: Implement the pure logic**

`lib/billing/device-subscription-logic.ts`:

```ts
// Pure reconciliation decision for the per-device quantity subscription.
// The IO wrapper (device-subscription.ts) reads state, calls this, applies.

import type { BillingPlan } from "@/lib/billing-plan";

export type DesiredSub =
  | { action: "none" }
  | { action: "cancel" }
  | { action: "create"; priceId: string; quantity: number }
  | { action: "update"; priceId: string; quantity: number };

export function desiredSubscriptionState(a: {
  plan: BillingPlan;
  deviceCount: number;
  hasSubscription: boolean;
  priceId: string | null;
}): DesiredSub {
  const billable = a.priceId !== null && a.plan !== "credits" && a.deviceCount > 0;
  if (!billable) return a.hasSubscription ? { action: "cancel" } : { action: "none" };
  return a.hasSubscription
    ? { action: "update", priceId: a.priceId!, quantity: a.deviceCount }
    : { action: "create", priceId: a.priceId!, quantity: a.deviceCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/billing/device-subscription-logic.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add env vars**

In `lib/env.ts`, next to `STRIPE_CREDIT_PACK_PRICE_IDS`:

```ts
  // Per-device monthly Stripe prices (dual-track pricing). Tier discounts are
  // configured on the price objects in Stripe, not in code.
  STRIPE_FLAT_PRICE_ID: z.string().optional(),
  STRIPE_BASE_PRICE_ID: z.string().optional(),
```

In `.env.example`, after the credit-pack line:

```bash
# Per-device subscription prices (Track B flat / Track C base). Optional —
# unset means device-subscription sync is a no-op.
STRIPE_FLAT_PRICE_ID=""
STRIPE_BASE_PRICE_ID=""
```

- [ ] **Step 6: Implement the IO wrapper**

`lib/billing/device-subscription.ts`:

```ts
// Keeps the per-device Stripe subscription in sync with the org's claimed
// device count (flat / base_usage plans). Every entry point is fail-open:
// device operations must never block on Stripe. proration_behavior "none"
// keeps mid-month device churn from generating micro-prorations; the new
// quantity simply applies from the next invoice.

import { and, count, eq, isNotNull, ne } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { device, tenantSettings } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import type { BillingPlan } from "@/lib/billing-plan";
import { ensureStripeCustomer } from "./stripe-billing";
import { desiredSubscriptionState } from "./device-subscription-logic";

function planPriceId(plan: BillingPlan): string | null {
  const env = getEnv();
  if (plan === "flat") return env.STRIPE_FLAT_PRICE_ID ?? null;
  if (plan === "base_usage") return env.STRIPE_BASE_PRICE_ID ?? null;
  return null;
}

/** Reconcile one org's device subscription with its plan + claimed-device count. */
export async function syncDeviceSubscription(organizationId: string): Promise<void> {
  if (!stripe) return; // Stripe unconfigured → no-op
  const [settings] = await db
    .select({
      plan: tenantSettings.billingPlan,
      subId: tenantSettings.stripeSubscriptionId,
      itemId: tenantSettings.stripeSubscriptionItemId,
      archivedAt: tenantSettings.archivedAt,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, organizationId))
    .limit(1);
  if (!settings) return;

  const [{ n }] = await db
    .select({ n: count() })
    .from(device)
    .where(and(eq(device.organizationId, organizationId), isNotNull(device.claimedAt)));

  const plan: BillingPlan = settings.archivedAt ? "credits" : settings.plan; // archived → wind down
  const desired = desiredSubscriptionState({
    plan,
    deviceCount: Number(n),
    hasSubscription: settings.subId !== null,
    priceId: planPriceId(plan),
  });

  if (desired.action === "none") return;

  if (desired.action === "cancel") {
    if (settings.subId) await stripe.subscriptions.cancel(settings.subId);
    await db
      .update(tenantSettings)
      .set({ stripeSubscriptionId: null, stripeSubscriptionItemId: null })
      .where(eq(tenantSettings.organizationId, organizationId));
    return;
  }

  if (desired.action === "create") {
    const customerId = await ensureStripeCustomer(organizationId);
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: desired.priceId, quantity: desired.quantity }],
      proration_behavior: "none",
      metadata: { organizationId },
    });
    await db
      .update(tenantSettings)
      .set({ stripeSubscriptionId: sub.id, stripeSubscriptionItemId: sub.items.data[0].id })
      .where(eq(tenantSettings.organizationId, organizationId));
    return;
  }

  // update: quantity (and price, covering flat <-> base_usage plan switches)
  if (settings.itemId) {
    await stripe.subscriptionItems.update(settings.itemId, {
      price: desired.priceId,
      quantity: desired.quantity,
      proration_behavior: "none",
    });
  }
}

/** Daily reconcile across all plan orgs (folded into the health cron). */
export async function syncAllDeviceSubscriptions(): Promise<{ synced: number; failed: number }> {
  const orgs = await db
    .select({ organizationId: tenantSettings.organizationId })
    .from(tenantSettings)
    .where(ne(tenantSettings.billingPlan, "credits"));
  let synced = 0;
  let failed = 0;
  for (const o of orgs) {
    try {
      await syncDeviceSubscription(o.organizationId);
      synced++;
    } catch (err) {
      failed++;
      console.error(`device-subscription sync failed for ${o.organizationId}`, err);
    }
  }
  return { synced, failed };
}
```

- [ ] **Step 7: Hook device lifecycle + daily cron**

In `lib/documents.ts` `claimDevice`, after the claim succeeds (just before the final return), add a fail-open sync:

```ts
  // Keep the per-device subscription quantity in sync (fail-open — a Stripe
  // hiccup must never fail a claim).
  try {
    await syncDeviceSubscription(organizationId);
  } catch (err) {
    console.error("device-subscription sync after claim failed", err);
  }
```

with `import { syncDeviceSubscription } from "@/lib/billing/device-subscription";` — use the org id variable actually in scope in `claimDevice` (read the function; the claimed device row carries `organizationId`).

Apply the same fail-open call after any flow that unclaims or deletes claimed devices: the offboarding disposition flow (`lib/actions/offboarding.ts` or `lib/offboarding.ts` — grep `claimedAt` / device delete writes) and the admin revert-claim action (`lib/factory-registry.ts` or `lib/actions/inventory.ts` — same grep). Daily drift is also covered by the cron fold-in below, so any site that is awkward to hook may rely on the cron; note which in the commit message.

In `app/api/cron/health/route.ts`, alongside the existing folded jobs, add:

```ts
  const subs = await syncAllDeviceSubscriptions();
```

and include `subs` in the route's JSON summary response (match the shape the route already returns for the other folded jobs).

- [ ] **Step 8: Typecheck, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: PASS. With both env vars unset, every sync is a structural no-op.

- [ ] **Step 9: Commit**

```bash
git add lib/billing/device-subscription-logic.ts lib/billing/device-subscription-logic.test.ts lib/billing/device-subscription.ts lib/env.ts .env.example lib/documents.ts app/api/cron/health/route.ts lib/actions/offboarding.ts lib/factory-registry.ts
git commit -m "feat(billing): Stripe per-device quantity subscription sync (fail-open, cron-reconciled)"
```

---

### Task 7: Admin billing-plan control

**Files:**
- Create: `lib/actions/billing-plan.ts` (server action)
- Create: `components/billing-plan-card.tsx` (client form)
- Modify: `app/(admin)/admin/customers/[tenantId]/page.tsx` — render the card next to `GrantCreditsForm` in the billing/credits section
- Modify: `lib/audit.ts` — add `billingPlanChanged: "billing.plan_changed"` to the `AUDIT` map
- Modify: `lib/audit-labels.ts` — add `"billing.plan_changed": "Billing plan changed"`

**Interfaces:**
- Consumes: `requirePlatformAdmin` (`lib/session.ts`), `recordAudit`/`AUDIT` (`lib/audit.ts`), `isOrgArchived` (`lib/archived-guard.ts`), `syncDeviceSubscription` (Task 6), `BillingPlan` (Task 2).
- Produces: `setBillingPlanAction(_prev: PlanState, formData: FormData): Promise<PlanState>` with `type PlanState = { ok: boolean; error?: string }`; form fields `organizationId`, `billingPlan`, `includedTriggersPerDevice`.

- [ ] **Step 1: Implement the server action**

`lib/actions/billing-plan.ts` (mirror `lib/actions/credits.ts` exactly in structure):

```ts
"use server";
import { eq } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { recordAudit, AUDIT } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { isOrgArchived } from "@/lib/archived-guard";
import { syncDeviceSubscription } from "@/lib/billing/device-subscription";
import type { BillingPlan } from "@/lib/billing-plan";

export type PlanState = { ok: boolean; error?: string };

const PLANS: BillingPlan[] = ["credits", "flat", "base_usage"];

export async function setBillingPlanAction(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const ctx = await requirePlatformAdmin();
  const orgId = String(formData.get("organizationId") ?? "");
  const plan = String(formData.get("billingPlan") ?? "") as BillingPlan;
  const included = Number(formData.get("includedTriggersPerDevice") ?? 0);
  if (!orgId || !PLANS.includes(plan)) {
    return { ok: false, error: "Pick a valid billing plan." };
  }
  if (!Number.isInteger(included) || included < 0 || included > 1_000_000) {
    return { ok: false, error: "Included triggers must be a whole number between 0 and 1,000,000." };
  }
  if (await isOrgArchived(orgId)) {
    return { ok: false, error: "Customer is archived." };
  }

  const [updated] = await db
    .update(tenantSettings)
    .set({ billingPlan: plan, includedTriggersPerDevice: included, updatedAt: new Date() })
    .where(eq(tenantSettings.organizationId, orgId))
    .returning({ organizationId: tenantSettings.organizationId });
  if (!updated) return { ok: false, error: "Customer not found." };

  await recordAudit({
    organizationId: orgId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.billingPlanChanged,
    metadata: { plan, includedTriggersPerDevice: included },
  });

  // Reconcile the Stripe subscription with the new plan (fail-open).
  try {
    await syncDeviceSubscription(orgId);
  } catch (err) {
    console.error("device-subscription sync after plan change failed", err);
  }

  revalidatePath(`/admin/customers/${orgId}`);
  return { ok: true };
}
```

Check `recordAudit`'s actual input shape at `lib/audit.ts:63` and match it (the shape above mirrors `grantCreditsAction`; if the real signature differs, follow the real one).

- [ ] **Step 2: Add the audit action + label**

`lib/audit.ts` — inside the `AUDIT` map: `billingPlanChanged: "billing.plan_changed",`
`lib/audit-labels.ts` — inside the label map: `"billing.plan_changed": "Billing plan changed",`

- [ ] **Step 3: Implement the card**

`components/billing-plan-card.tsx` (client component, mirrors `grant-credits-form.tsx` form conventions; uses existing shadcn `Select`, `Input`, `Label`, `Button`, `Card`):

```tsx
"use client";

import { useActionState, useState } from "react";
import { setBillingPlanAction, type PlanState } from "@/lib/actions/billing-plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PLAN_LABELS: Record<string, string> = {
  credits: "Credits (prepaid, pay-as-you-go)",
  flat: "Flat Fleet (per-device, unlimited triggers)",
  base_usage: "Base + Usage (per-device base + included quota)",
};

const initialState: PlanState = { ok: true };

export function BillingPlanCard(props: {
  organizationId: string;
  billingPlan: string;
  includedTriggersPerDevice: number;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(setBillingPlanAction, initialState);
  const [plan, setPlan] = useState(props.billingPlan);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing plan</CardTitle>
        <CardDescription>
          Dual-track pricing: how this customer&apos;s triggers are paid.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="organizationId" value={props.organizationId} />
          <input type="hidden" name="billingPlan" value={plan} />
          <div className="space-y-1.5">
            <Label>Plan</Label>
            <Select value={plan} onValueChange={setPlan} disabled={props.disabled}>
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PLAN_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="includedTriggersPerDevice">Included triggers / device / month</Label>
            <Input
              id="includedTriggersPerDevice"
              name="includedTriggersPerDevice"
              type="number"
              min={0}
              defaultValue={props.includedTriggersPerDevice}
              className="w-48"
              disabled={props.disabled || plan !== "base_usage"}
            />
          </div>
          <Button type="submit" disabled={pending || props.disabled}>
            {pending ? "Saving…" : "Save plan"}
          </Button>
          {!state.ok && state.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
```

Note: when the plan is not `base_usage`, the quota input is disabled — a disabled input submits nothing, so the action would read 0. That is fine (`includedTriggersPerDevice` is ignored outside base_usage), but pass the current value through a hidden input instead if you prefer the stored value untouched: add `<input type="hidden" name="includedTriggersPerDevice" value={props.includedTriggersPerDevice} />` ONLY when the visible input is disabled (conditional render, never both — duplicate names would double-submit).

- [ ] **Step 4: Render on the admin customer page**

In `app/(admin)/admin/customers/[tenantId]/page.tsx`: fetch the plan fields alongside the existing queries. `getCustomerDetail` may not expose them — in that case add a small select in the page (it is a server component) or extend `getCustomerDetail` in `lib/data.ts`; prefer extending `getCustomerDetail`'s tenant object with `billingPlan` and `includedTriggersPerDevice` since it already reads `tenantSettings`. Render next to the credits/GrantCreditsForm section:

```tsx
<BillingPlanCard
  organizationId={tenantId}
  billingPlan={tenant.billingPlan}
  includedTriggersPerDevice={tenant.includedTriggersPerDevice}
  disabled={isArchived}
/>
```

- [ ] **Step 5: Typecheck, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/billing-plan.ts components/billing-plan-card.tsx lib/audit.ts lib/audit-labels.ts "app/(admin)/admin/customers/[tenantId]/page.tsx" lib/data.ts
git commit -m "feat(admin): billing-plan control on customer detail (credits/flat/base_usage + quota)"
```

---

### Task 8: Usage visibility — tenant billing page + admin card

**Files:**
- Modify: `lib/data.ts` — add `getDeviceUsageThisMonth(organizationId)`
- Modify: `app/(tenant)/tenant/billing/page.tsx` — "Device usage this month" section
- Modify: `app/(admin)/admin/customers/[tenantId]/page.tsx` — same data listed inside/near the BillingPlanCard

**Interfaces:**
- Consumes: `getOrgUsageForMonth` (Task 3), `monthKey` (Task 2), `device` table (names), `FAIR_USE_TRIGGERS_PER_DEVICE_MONTH`.
- Produces: `getDeviceUsageThisMonth(organizationId: string): Promise<{ deviceId: string; name: string; triggers: number }[]>` in `lib/data.ts`.

- [ ] **Step 1: Data function**

In `lib/data.ts` (follow the file's existing section conventions — this is the single data seam):

```ts
/** Current-calendar-month (UTC) trigger usage per device, with device names. */
export async function getDeviceUsageThisMonth(
  organizationId: string,
): Promise<{ deviceId: string; name: string; triggers: number }[]> {
  const month = monthKey(new Date());
  const usage = await getOrgUsageForMonth(organizationId, month);
  if (usage.length === 0) return [];
  const devices = await db
    .select({ id: device.id, name: device.name })
    .from(device)
    .where(eq(device.organizationId, organizationId));
  const names = new Map(devices.map((d) => [d.id, d.name]));
  return usage
    .map((u) => ({ deviceId: u.deviceId, name: names.get(u.deviceId) ?? "Removed device", triggers: u.triggers }))
    .sort((a, b) => b.triggers - a.triggers);
}
```

with imports `monthKey` from `@/lib/billing-plan` and `getOrgUsageForMonth` from `@/lib/device-usage` added to `lib/data.ts`'s import block.

- [ ] **Step 2: Tenant billing page section**

In `app/(tenant)/tenant/billing/page.tsx` (server component — read it first and match its existing section structure): fetch `const usage = await getDeviceUsageThisMonth(organizationId)` alongside the existing billing queries, plus the org's `billingPlan`/`includedTriggersPerDevice` (extend whatever settings query the page already makes, or select from `tenantSettings` directly). Render below the existing credits card, using the standard primitives (`SectionHeader` + `Card` + `Table` — same components the page already imports):

```tsx
<PageSection>
  <SectionHeader
    title="Device usage this month"
    description={
      billingPlan === "flat"
        ? "Your plan includes unlimited triggers (fair use)."
        : billingPlan === "base_usage"
          ? `Each device includes ${formatNumber(includedTriggersPerDevice)} triggers per month; beyond that, triggers use credits.`
          : "Each trigger uses one credit."
    }
  />
  <Card>
    <CardContent>
      {usage.length === 0 ? (
        <p className="text-sm text-muted-foreground">No triggers yet this month.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead className="text-right">Triggers</TableHead>
              {billingPlan === "base_usage" ? (
                <TableHead className="text-right">Included remaining</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.map((u) => (
              <TableRow key={u.deviceId}>
                <TableCell>{u.name}</TableCell>
                <TableCell className="text-right">{formatNumber(u.triggers)}</TableCell>
                {billingPlan === "base_usage" ? (
                  <TableCell className="text-right">
                    {formatNumber(Math.max(0, includedTriggersPerDevice - u.triggers))}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CardContent>
  </Card>
</PageSection>
```

Adjust imports/props to what the page actually uses (e.g. if it lays sections out without `PageSection`, follow the page).

- [ ] **Step 3: Admin visibility**

In `app/(admin)/admin/customers/[tenantId]/page.tsx`: fetch `getDeviceUsageThisMonth(tenantId)` in the existing `Promise.all`, and render a compact usage list (device name + trigger count, top 5 + "and N more") inside the billing section near `BillingPlanCard` — a simple `<Table>` matching the page's existing tables.

- [ ] **Step 4: Typecheck, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/data.ts "app/(tenant)/tenant/billing/page.tsx" "app/(admin)/admin/customers/[tenantId]/page.tsx"
git commit -m "feat(billing): per-device monthly usage visibility on tenant billing + admin customer pages"
```

---

## Deploy checklist (explicit user-approved steps — NOT part of task execution)

1. Apply migration 0032 to Neon (`npm run db:migrate`) — **user approval required; .env.local is PROD**.
2. Create the two per-device monthly recurring prices in Stripe (test mode first): "Maratus Flat Fleet" and "Maratus Base"; set `STRIPE_FLAT_PRICE_ID` / `STRIPE_BASE_PRICE_ID` in Vercel env (all environments) and `.env.local`.
3. Smoke: seed org stays on `credits` (unchanged behavior); flip a test org to `base_usage` with quota 2, fire 3 triggers → 2 `included` + 1 credit hold; flip to `flat` → all `included`, no credit movement; check Stripe test-mode subscription quantity follows a claim.
4. Deploy to production; verify `/api/cron/health` response includes the `subs` sync summary.
