# Device Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an org a paid device-slot entitlement that outlives the devices occupying it, so an RMA'd or removed device stops billing and stops consuming quota while its replacement activates for free.

**Architecture:** A single new counter, `tenantSettings.paidDeviceSlots`, becomes the org's entitlement. Quota derives from slots rather than from live devices, so a device leaving never shrinks the pool mid-year. Slots change only when an invoice is paid; they are recomputed once a year at renewal, which is where a voluntary reduction naturally settles. Two pure functions hold all the arithmetic.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle ORM over Neon (`neon-http`), Vitest (node env, `lib/**/*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-08-16-device-slots-rma-design.md`

## Global Constraints

- **Quota is `paidDeviceSlots × includedTriggersPerDevice`** — slots, never a live device count. This is the load-bearing change; getting it wrong reintroduces the bug the spec exists to fix.
- **`paidDeviceSlots` is written ONLY in `markInvoicePaid`.** Subscription (first or renewal) sets it to `invoice.deviceCount`; proration increments by 1; overage does not touch it. Nothing else writes it — in particular, removing a device never decrements it.
- **A device activated into a free slot must not leave an open invoice behind:** void any open `proration` invoice for that device.
- **Renewal pricing stays on `countPaidDevices`** — every departure route already removes the device from that count (RMA clears `subscriptionPaidAt`; delete/return removes the row). Do not change `lib/billing-cron.ts`'s pricing.
- Money is USD integer cents; all billing dates UTC.
- **Tests are pure.** `vitest.config.ts` includes only `lib/**/*.test.ts` and nothing touches a database. Do not write DB-hitting tests.
- **⚠️ `.env.local` points at PRODUCTION.** Never run `npm run db:migrate`, `db:push`, `db:studio`, `db:seed`, any backfill script, `npm run dev`, or `vercel`. `db:generate` is safe (it does not connect).
- **Migrations:** next number is `0043`. Per the repo's known snapshot-drift gotcha, strip generated SQL down to only your intended change.
- **Deploy order matters and is documented, not executed here:** migration → backfill → code. Until the backfill runs, every org reads 0 slots, which would zero quotas and refuse replacement activations.

---

### Task 1: Slot arithmetic (pure)

Both slot rules in one testable place, before anything depends on them.

**Files:**
- Create: `lib/device-slots.ts`
- Test: `lib/device-slots.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `freeSlots(a: { paidDeviceSlots: number; paidDevices: number }): number`
  - `slotsAfterPayment(a: { kind: "subscription" | "proration" | "overage"; currentSlots: number; invoiceDeviceCount: number | null }): number`

- [ ] **Step 1: Write the failing test**

Create `lib/device-slots.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { freeSlots, slotsAfterPayment } from "./device-slots";

describe("freeSlots", () => {
  it("is the entitlement minus what occupies it", () => {
    expect(freeSlots({ paidDeviceSlots: 3, paidDevices: 2 })).toBe(1);
  });

  it("is zero when every slot is occupied", () => {
    expect(freeSlots({ paidDeviceSlots: 3, paidDevices: 3 })).toBe(0);
  });

  it("clamps to zero when more devices are paid than slots exist", () => {
    // A data anomaly must degrade to "no free slot", never to free activations.
    expect(freeSlots({ paidDeviceSlots: 2, paidDevices: 5 })).toBe(0);
  });

  it("is zero for an org with no entitlement", () => {
    expect(freeSlots({ paidDeviceSlots: 0, paidDevices: 0 })).toBe(0);
  });

  it("frees a slot when a paid device leaves", () => {
    // The RMA case: entitlement holds, occupancy drops.
    expect(freeSlots({ paidDeviceSlots: 2, paidDevices: 1 })).toBe(1);
  });
});

describe("slotsAfterPayment", () => {
  it("sets the entitlement from a first subscription invoice", () => {
    expect(
      slotsAfterPayment({ kind: "subscription", currentSlots: 0, invoiceDeviceCount: 3 }),
    ).toBe(3);
  });

  it("overwrites the entitlement at renewal, including downward", () => {
    // A customer who dropped from 3 devices to 1 renews at 1.
    expect(
      slotsAfterPayment({ kind: "subscription", currentSlots: 3, invoiceDeviceCount: 1 }),
    ).toBe(1);
  });

  it("increments by one for a proration", () => {
    expect(
      slotsAfterPayment({ kind: "proration", currentSlots: 2, invoiceDeviceCount: 1 }),
    ).toBe(3);
  });

  it("leaves the entitlement alone for an overage", () => {
    expect(
      slotsAfterPayment({ kind: "overage", currentSlots: 2, invoiceDeviceCount: null }),
    ).toBe(2);
  });

  it("treats a null subscription deviceCount as zero rather than throwing", () => {
    expect(
      slotsAfterPayment({ kind: "subscription", currentSlots: 5, invoiceDeviceCount: null }),
    ).toBe(0);
  });

  it("never returns a negative entitlement", () => {
    expect(
      slotsAfterPayment({ kind: "subscription", currentSlots: 2, invoiceDeviceCount: -1 }),
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/device-slots.test.ts`
Expected: FAIL — `Failed to resolve import "./device-slots"`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/device-slots.ts`:

```ts
// Device-slot arithmetic (pure). A slot is what the org PAID for; a device is
// what currently occupies one. Keeping them separate is the whole point: an
// RMA'd or removed device frees its slot without shrinking the entitlement,
// so the customer keeps the quota they bought for the rest of the year.

/** Slots the org has paid for but nothing currently occupies. */
export function freeSlots(a: { paidDeviceSlots: number; paidDevices: number }): number {
  // Clamped: a data anomaly must degrade to "no free slot", never to free
  // activations.
  return Math.max(0, a.paidDeviceSlots - a.paidDevices);
}

/**
 * The entitlement after an invoice is paid. A subscription invoice — first
 * activation or renewal alike — REPLACES the entitlement with what it was
 * priced for, which is how a voluntary reduction settles once a year. A
 * proration adds exactly the one device it covers. An overage buys no slots.
 */
export function slotsAfterPayment(a: {
  kind: "subscription" | "proration" | "overage";
  currentSlots: number;
  invoiceDeviceCount: number | null;
}): number {
  switch (a.kind) {
    case "subscription":
      return Math.max(0, a.invoiceDeviceCount ?? 0);
    case "proration":
      return a.currentSlots + 1;
    case "overage":
      return a.currentSlots;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/device-slots.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add lib/device-slots.ts lib/device-slots.test.ts
git commit -m "feat(billing): pure device-slot arithmetic"
```

---

### Task 2: Schema — the `paidDeviceSlots` column

**Files:**
- Modify: `lib/db/schema.ts` (the `tenantSettings` subscription block)
- Create: `drizzle/0043_*.sql` (generated)

**Interfaces:**
- Consumes: nothing
- Produces: `tenantSettings.paidDeviceSlots`

- [ ] **Step 1: Add the column**

In `lib/db/schema.ts`, in `tenantSettings`, directly after `overagePriceCents`:

```ts
  // Device slots the org has PAID for. Deliberately outlives the devices
  // occupying it: an RMA'd or removed device frees its slot without shrinking
  // this number, so the customer keeps the quota they bought until the year
  // ends. Written ONLY when an invoice is paid (see lib/invoices.ts
  // markInvoicePaid); nothing decrements it. Quota is slots × included, never
  // a live device count.
  paidDeviceSlots: integer("paid_device_slots").default(0).notNull(),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`

Then open the generated `drizzle/0043_*.sql` and **strip it to exactly one statement**:

```sql
ALTER TABLE "tenant_settings" ADD COLUMN "paid_device_slots" integer DEFAULT 0 NOT NULL;
```

Delete anything else it emitted — the repo's snapshot has known drift and will produce unrelated churn.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

Stage the schema, the new `.sql`, AND the regenerated snapshot together — a previous plan left snapshot files unstaged and it had to be cleaned up afterwards.

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(db): paidDeviceSlots entitlement column (migration 0043)"
```

Do **not** run `npm run db:migrate`.

---

### Task 3: Backfill script

**Files:**
- Create: `lib/db/backfill-device-slots.ts`

**Interfaces:**
- Consumes: the column from Task 2
- Produces: a `tsx`-runnable script

- [ ] **Step 1: Write the script**

Create `lib/db/backfill-device-slots.ts`:

```ts
// One-shot backfill for the device-slots migration (0043).
// MUST run right after 0043 and BEFORE the new code deploys: until it runs
// every org reads 0 slots, which zeroes quotas and refuses replacement
// activations.
//
// Seeds each org's entitlement from what it currently occupies:
//   paidDeviceSlots = count(devices with subscriptionPaidAt set)
//
// Run:  npx tsx lib/db/backfill-device-slots.ts
// NOTE: .env.local points at PRODUCTION. This writes to the live database.

import "./load-env"; // MUST be first — hoisted ESM imports read env at load time
import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { device, tenantSettings } from "./schema";

async function main() {
  const counts = await db
    .select({
      organizationId: device.organizationId,
      paid: sql<number>`count(*)::int`,
    })
    .from(device)
    .where(isNotNull(device.subscriptionPaidAt))
    .groupBy(device.organizationId);

  let updated = 0;
  for (const row of counts) {
    const res = await db
      .update(tenantSettings)
      .set({ paidDeviceSlots: Number(row.paid), updatedAt: new Date() })
      .where(eq(tenantSettings.organizationId, row.organizationId))
      .returning({ organizationId: tenantSettings.organizationId });
    if (res.length > 0) updated += 1;
  }

  console.log(
    `device-slot backfill complete: ${updated} org(s) seeded from ${counts.length} org(s) with paid devices`,
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
Expected: zero errors.

- [ ] **Step 3: Re-read for re-run safety**

This one is intentionally NOT guarded by a null check, because it is idempotent by construction: it recomputes the count from live data every time, so a second run writes the same value. Confirm that is still true of what you wrote — if you added a conditional that makes a re-run behave differently from the first, remove it.

- [ ] **Step 4: Commit**

```bash
git add lib/db/backfill-device-slots.ts
git commit -m "feat(db): backfill device-slot entitlements from paid devices"
```

Do **not** run it.

---

### Task 4: Write slots when an invoice is paid, and activate from slots

The heart of the change. `markInvoicePaid` currently reasons about activation with two guards — a count cap (`activatableDeviceCount`) and an issuance-time pin (`claimedAt <= issuedAt`) — plus a filter that skips already-prorated devices. An explicit slot counter subsumes all three: you cannot occupy a slot that does not exist.

**Files:**
- Modify: `lib/invoices.ts`
- Modify: `lib/invoices-payment.test.ts`

**Interfaces:**
- Consumes: `freeSlots`, `slotsAfterPayment` (Task 1); `paidDeviceSlots` (Task 2)
- Produces: unchanged public signatures — `markInvoicePaid` keeps returning `{ ok: true; organizationId } | { ok: false; reason }`

- [ ] **Step 1: Read the current implementation**

Run: `sed -n '/export async function markInvoicePaid/,/^}/p' lib/invoices.ts`

Note where `activatableDeviceCount`, `devicesToActivate` and `proratedDeviceIds` are used. You are replacing the *inputs* to activation, not the settle-first concurrency gate — that stays exactly as it is.

- [ ] **Step 2: Write slots in the subscription branch**

In the subscription branch, read the current entitlement alongside the other settings:

```ts
        slots: tenantSettings.paidDeviceSlots,
```

Compute the new entitlement **once**, before the upsert, and reuse that variable in both the upsert and the activation step below — computing it twice invites the two copies to drift:

```ts
    const newSlots = slotsAfterPayment({
      kind: "subscription",
      currentSlots: settings?.slots ?? 0,
      invoiceDeviceCount: inv.deviceCount,
    });
```

Then include it in the upsert's `values` and `set`:

```ts
        paidDeviceSlots: newSlots,
```

- [ ] **Step 3: Replace the activation guards with the slot check**

After the upsert, replace the `activatableDeviceCount` / `claimedAt <= issuedAt` / `proratedDeviceIds`-filter block with the following, reusing `newSlots` from Step 2:

```ts
    // Activation is now bounded by the entitlement itself: you cannot occupy a
    // slot that does not exist. This replaces the old count cap and the
    // issuance-time pin — at a renewal the newly written slots equal the
    // already-paid devices, so free is 0 and nothing rides in free. When a paid
    // device has since gone to RMA, free is 1 and the replacement takes it,
    // which is exactly the intended behaviour rather than the accident it used
    // to be.
    const paidNow = await countPaidDevices(inv.organizationId);
    const free = freeSlots({ paidDeviceSlots: newSlots, paidDevices: paidNow });

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

    for (const d of unpaid.slice(0, free)) {
      await activateDeviceIntoSlot(d.id, inv.organizationId, now);
    }
    return { ok: true, organizationId: inv.organizationId };
```

- [ ] **Step 4: Add the activation helper**

Add to `lib/invoices.ts` (near `proratedDeviceIds`):

```ts
/**
 * Put a device into a paid slot and make sure it leaves no bill behind. A
 * device can hold an open proration invoice and only LATER find itself in a
 * free slot — it was claimed while the org was full, and a paid device went to
 * RMA afterwards. Activating it for free while that invoice still stands would
 * charge the customer for a device they were given, which is the exact
 * double-charge the slot model exists to remove.
 */
async function activateDeviceIntoSlot(
  deviceId: string,
  organizationId: string,
  now: Date,
): Promise<void> {
  await db
    .update(device)
    .set({ subscriptionPaidAt: now })
    .where(eq(device.id, deviceId));

  const voided = await db
    .update(invoice)
    .set({
      status: "void",
      note: "Superseded: the device was activated into a free slot.",
    })
    .where(
      and(
        eq(invoice.deviceId, deviceId),
        eq(invoice.kind, "proration"),
        eq(invoice.status, "open"),
      ),
    )
    .returning({ id: invoice.id });

  if (voided.length > 0) {
    console.warn("[billing] voided a proration superseded by a free slot", {
      deviceId,
      organizationId,
      invoiceIds: voided.map((v) => v.id),
    });
  }
}
```

- [ ] **Step 5: Increment slots on a proration payment**

In the proration branch, before activating the device, raise the entitlement:

```ts
    await db
      .update(tenantSettings)
      .set({
        paidDeviceSlots: sql`${tenantSettings.paidDeviceSlots} + 1`,
        updatedAt: now,
      })
      .where(eq(tenantSettings.organizationId, inv.organizationId));
```

Use the SQL increment rather than read-then-write: two prorations settled concurrently must both count.

Then activate via the same helper (`activateDeviceIntoSlot(inv.deviceId, inv.organizationId, now)`) so the void-the-superseded-invoice rule applies uniformly. Note the invoice being paid is itself a proration for this device — voiding it after it was just marked `paid` must not happen, and it cannot: the void is conditioned on `status = "open"` and this row is already `paid`.

- [ ] **Step 6: Remove what the slot model subsumes**

Delete `activatableDeviceCount` and its tests. Keep `devicesToActivate` only if something still calls it after Step 3; if nothing does, delete it and its tests too. `proratedDeviceIds` is still used by `issueProrationsForUnpaidDevices` — leave it.

- [ ] **Step 7: Update the payment tests**

In `lib/invoices-payment.test.ts`, remove the `activatableDeviceCount` cases and any `devicesToActivate` cases whose function you deleted. Keep every test whose behaviour survives. Do not delete a test merely because it fails — if it asserts behaviour that still exists, fix it.

- [ ] **Step 8: Run the gate**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, zero type errors. Report the before/after test counts.

- [ ] **Step 9: Commit**

```bash
git add lib/invoices.ts lib/invoices-payment.test.ts
git commit -m "feat(billing): pay invoices into device slots, activate from free slots"
```

---

### Task 5: Derive quota from slots

**Files:**
- Modify: `lib/invoicing.ts` (`overageFor`)
- Modify: `lib/invoicing.test.ts`
- Modify: `lib/data.ts` (`getTenantBillingOverview`)
- Modify: `lib/billing-cron.ts` (the overage call)

**Interfaces:**
- Consumes: `paidDeviceSlots` (Task 2)
- Produces: `overageFor` takes `slotCount` where it took `paidDeviceCount`

- [ ] **Step 1: Rename the parameter to what it now means**

`overageFor` currently takes `paidDeviceCount` and multiplies it by `includedPerDevice`. Under the slot model the multiplicand is the entitlement, not a device count. Rename the field to `slotCount` in the argument type and the body.

This is deliberate: leaving the name as `paidDeviceCount` while passing slots into it is precisely the kind of quiet mismatch that produces a billing bug nobody can see by reading the call site.

- [ ] **Step 2: Update its tests**

In `lib/invoicing.test.ts`, rename the field in every `overageFor` case. Add one case that pins the new meaning:

```ts
  it("pools quota from paid SLOTS, not from live devices", () => {
    // Two slots paid for, one device currently occupying them (the other is at
    // RMA). The pool must stay at 2000 — this is the whole point of slots.
    const r = overageFor({
      used: 2500,
      includedPerDevice: 1000,
      slotCount: 2,
      overagePriceCents: 2,
      legacyCredits: 0,
    });
    expect(r.includedTotal).toBe(2000);
    expect(r.overageTriggers).toBe(500);
  });
```

- [ ] **Step 3: Feed slots at both call sites**

In `lib/data.ts`'s `getTenantBillingOverview`, read `tenantSettings.paidDeviceSlots` and pass it as `slotCount` instead of the `countPaidDevices` result. Keep returning `paidDevices` for display, and add `paidDeviceSlots` and `freeSlots` to the returned view model so the UI can show occupancy.

In `lib/billing-cron.ts`, read `paidDeviceSlots` in the org selection and pass it as `slotCount` to `issueOverageInvoice`. **Do not change how renewals are priced** — `countPaidDevices` stays correct there (see the spec's §3 Renewal).

- [ ] **Step 4: Run the gate**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add lib/invoicing.ts lib/invoicing.test.ts lib/data.ts lib/billing-cron.ts
git commit -m "feat(billing): derive included quota from paid slots"
```

---

### Task 6: Claim into a free slot

**Files:**
- Modify: `lib/device-claim.ts`

**Interfaces:**
- Consumes: `freeSlots` (Task 1), `countPaidDevices` (`lib/invoices.ts`)
- Produces: nothing

- [ ] **Step 1: Read the current claim flow**

Run: `sed -n '/issueProrationForClaimSafe/,/^}/p' lib/device-claim.ts`

You are inserting a branch *before* the proration path, not restructuring the claim itself. `claimDevice` validates a one-time pairing code and returns a device key exactly once — do not touch that.

- [ ] **Step 2: Take the free slot when one exists**

Rewrite `issueProrationForClaimSafe`'s body so the settings read also fetches `paidDeviceSlots`, and branch before pricing anything:

```ts
    if (!settings?.startedAt || !settings.renewsAt) return;

    // A free slot means the org already paid for this device's place — a
    // replacement for one that went to RMA, or a device filling a slot its
    // predecessor vacated. Activate it and bill nothing.
    const paidDevices = await countPaidDevices(organizationId);
    if (freeSlots({ paidDeviceSlots: settings.slots, paidDevices }) > 0) {
      await db
        .update(device)
        .set({ subscriptionPaidAt: new Date() })
        .where(eq(device.id, deviceId));
      console.warn("[billing] device claimed into a free slot; no invoice issued", {
        deviceId,
        organizationId,
      });
      return;
    }
```

then the existing proration call as the `else` path.

Keep the whole thing inside the existing `try/catch`: a billing failure must never undo a successful claim, since the device is already bound and its key already returned.

- [ ] **Step 3: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/device-claim.ts
git commit -m "feat(billing): a device claimed into a free slot bills nothing"
```

---

### Task 7: RMA and retirement release the slot

**Files:**
- Modify: `lib/factory-registry.ts` (`setRegistryStatus`)

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Clear the device's paid status**

`setRegistryStatus` currently only writes the registry row. Extend it so marking a serial `rma` or `retired` also releases the billing slot:

```ts
export async function setRegistryStatus(
  serial: string,
  status: "rma" | "retired",
): Promise<void> {
  const [row] = await db
    .update(factoryDevice)
    .set({ status })
    .where(eq(factoryDevice.serial, serial))
    .returning({ deviceId: factoryDevice.deviceId });

  // Releasing the slot is the point: the device stops passing the subscription
  // gate and stops occupying a slot, while tenantSettings.paidDeviceSlots is
  // untouched — so the org keeps the quota it paid for and a replacement can
  // claim into the vacancy for free.
  if (!row?.deviceId) return;
  const released = await db
    .update(device)
    .set({ subscriptionPaidAt: null })
    .where(and(eq(device.id, row.deviceId), isNotNull(device.subscriptionPaidAt)))
    .returning({ id: device.id });

  if (released.length > 0) {
    console.warn("[billing] released a device slot on registry status change", {
      serial,
      status,
      deviceId: row.deviceId,
    });
  }
}
```

Add the imports this needs (`device`, `and`, `isNotNull`) to the existing import block — do not add a second one.

- [ ] **Step 2: Confirm the no-op cases**

Read your code and confirm all three are no-ops on the billing side: a serial with no linked device, a device that is already unpaid, and a serial that does not exist. None should throw.

- [ ] **Step 3: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/factory-registry.ts
git commit -m "feat(inventory): RMA and retirement release the billing slot"
```

---

### Task 8: Surface slots in the UI, and document the cutover

**Files:**
- Modify: `components/billing/subscription-card.tsx`
- Modify: `app/(tenant)/tenant/billing/page.tsx`
- Modify: `docs/runbooks/subscription-billing-cutover.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `paidDeviceSlots` / `freeSlots` from `getTenantBillingOverview` (Task 5)
- Produces: nothing

- [ ] **Step 1: Show occupancy, not just a device count**

Both the admin subscription card and the tenant billing page currently show "paid devices". Under the slot model the interesting number is occupancy: `2 of 3 slots in use` with the free one called out, because a free slot is a thing the customer can act on (send us the replacement and it activates for free).

Keep the existing layout primitives and spacing (`PageHeader` / `SectionHeader` / `PageSection`, metric grids `gap-4`) and the `radix-nova` component set. Do not introduce base-nova components.

- [ ] **Step 2: Add the cutover steps to the runbook**

In `docs/runbooks/subscription-billing-cutover.md`, add a new numbered section for this change, placed before the deferred destructive follow-up. It must state the order and why it matters:

1. `npm run db:migrate` (applies 0043 — additive).
2. `npx tsx lib/db/backfill-device-slots.ts` — **not optional**: until it runs every org reads 0 slots, so quotas read zero and replacement devices are refused. It is idempotent (it recomputes from live data).
3. `vercel --prod --yes`.
4. Verify: a tenant's billing page shows the expected slot count; marking a test serial `rma` in `/admin/inventory` clears that device's paid status and frees a slot.

- [ ] **Step 3: Update `CLAUDE.md`'s billing section**

The billing section says included quota is per paid device. Change it to state that quota derives from `paidDeviceSlots`, that a slot outlives the device occupying it, and that RMA/removal frees a slot without shrinking the entitlement until renewal.

- [ ] **Step 4: Run the full gate**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean; lint no worse than the pre-existing baseline.

- [ ] **Step 5: Commit**

```bash
git add components/billing/subscription-card.tsx "app/(tenant)/tenant/billing/page.tsx" docs/runbooks/subscription-billing-cutover.md CLAUDE.md
git commit -m "feat(billing): surface slot occupancy; document the slot cutover"
```

---

## Deferred (explicitly not in this plan)

- **Customer-facing fault reporting.** No channel exists; the customer phones the operator, who marks the serial in inventory. Tracked as separate work.
- **Refunds and credit notes.** The model has no mechanism for returning money and the spec's slot-transfer decision removes the need for one.
- **Automatic slot reclamation for orgs that stop paying.** `subscriptionPaidAt` is still never cleared by non-payment; that gap predates this plan and is unchanged by it.
