# Audit Follow-ups (decisions taken 2026-09-09) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the items the 2026-09-09 audit left as "product decisions": defer a renewal's slot shrink to the anniversary, keep a deleted device's trigger history for overage, void a deleted device's open proration, make the unpriced-slots warning honest, bump Next/better-auth, and refresh the hijack-recovery runbook.

**Architecture:** One additive migration (0045). Pure slot arithmetic stays in `lib/device-slots.ts` with tests; `markInvoicePaid` and the billing cron are the only IO callers. Voiding a device's open prorations becomes one exported helper reused by three callers. No behaviour change outside those paths.

**Tech Stack:** Next.js 16, TypeScript strict, Drizzle ORM (drizzle-kit generate), Neon, Better Auth, vitest.

**Spec:** The audit report + final-review findings of 2026-09-09 (session). Decisions are recorded in the `docs/superpowers/plans/2026-09-09-security-and-logic-fixes.md` "Out of scope" list and in this plan's task rationales.

## Global Constraints

- **Never run anything against the database from a task.** vitest loads `.env.local`, which is PRODUCTION. `npm run db:generate` is allowed (it only reads `lib/db/schema.ts` and writes files under `drizzle/`); `npm run db:migrate`, `db:push`, `db:seed` are FORBIDDEN — the controller applies the migration.
- After `db:generate`, READ the generated `.sql` and delete any `DROP/ADD CONSTRAINT` or `DROP/CREATE INDEX` statement that is not part of this plan's change (drizzle snapshot drift produces churn). The final SQL must contain exactly the five statements listed in Task 1.
- Money in integer cents; slots and months are integers; `paidDeviceSlots` is written only by invoice payment and by the new cron pending-apply step.
- Every task: `npx tsc --noEmit && npm test` clean before committing. Task 4 additionally requires `npm run build` clean. Commit per task; do not push.
- Do not touch files a task does not list.

---

### Task 1: Migration 0045 — pending slots columns, nullable `device_command.device_id` with SET NULL

**Files:**
- Modify: `lib/db/schema.ts` (`tenantSettings` block after `paidDeviceSlots`; `deviceCommand.deviceId` column)
- Create (via `npm run db:generate`, then trimmed): `drizzle/0045_<name>.sql`, `drizzle/meta/0045_snapshot.json`, `drizzle/meta/_journal.json` entry
- Modify: any TypeScript that stops compiling because `deviceCommand.deviceId` is now `string | null` (expected: none or a handful of narrowings; `lib/trigger-usage.ts:10` already coalesces `r.deviceId ?? "unknown"`).

**Interfaces:**
- Produces: `tenantSettings.pendingDeviceSlots: integer | null`, `tenantSettings.pendingSlotsAt: timestamp | null`; `deviceCommand.deviceId: text | null` with `onDelete: "set null"`.

Rationale: (a) a renewal paid before the anniversary must not shrink the entitlement for the rest of the old year — the shrink is parked in `pendingDeviceSlots` and applied by the cron at `pendingSlotsAt` (Task 2); (b) `device_command` rows cascade-deleted with a device disappear from the open overage period's `countAckedTriggers`, under-billing the org — keeping the rows with a null device id fixes that, and `rollupTriggersByDevice` already handles null.

- [ ] **Step 1: Edit the schema**

In `lib/db/schema.ts`, directly after the `paidDeviceSlots` column in `tenantSettings`, add:

```ts
  // A renewal PAID BEFORE its anniversary prices the new year at a lower device
  // count than the org currently holds (a slot went vacant via RMA/removal).
  // The lower number must not take effect until the anniversary — the customer
  // paid for the old year's slots through its last day — so it is parked here
  // and applied by the billing cron once `pendingSlotsAt` has passed
  // (lib/billing-cron.ts). Both null = nothing pending.
  pendingDeviceSlots: integer("pending_device_slots"),
  pendingSlotsAt: timestamp("pending_slots_at"),
```

In `deviceCommand`, change the `deviceId` column to:

```ts
    // Nullable + SET NULL on purpose: a deleted device's acked triggers must
    // stay in the org's overage count for the still-open period (billing reads
    // device_command by organization_id, not by device). Per-device rollups
    // bucket null as "unknown" (lib/trigger-usage.ts).
    deviceId: text("device_id").references(() => device.id, { onDelete: "set null" }),
```

- [ ] **Step 2: Generate and trim the migration**

Run: `npm run db:generate`
Then open the new `drizzle/0045_*.sql`. It must end up containing exactly these five statements (order as generated), separated by `--> statement-breakpoint`:

```sql
ALTER TABLE "device_command" DROP CONSTRAINT "device_command_device_id_device_id_fk";
ALTER TABLE "device_command" ALTER COLUMN "device_id" DROP NOT NULL;
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "tenant_settings" ADD COLUMN "pending_device_slots" integer;
ALTER TABLE "tenant_settings" ADD COLUMN "pending_slots_at" timestamp;
```

Delete anything else drizzle emitted (drift churn on other tables). Do NOT edit the snapshot JSON.

- [ ] **Step 3: Fix type fallout**

Run: `npx tsc --noEmit`. Where a consumer assumed `deviceId: string`, narrow with `?? "unknown"` (rollups) or `if (!row.deviceId) continue` (per-device maps). Do not change query semantics. Expected touch points, if any: `lib/data.ts` around line 158 (`groupBy(deviceCommand.deviceId)` feeding a per-device map).

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm test` → clean. `cat drizzle/0045_*.sql` → exactly the five statements.

```bash
git add lib/db/schema.ts drizzle/ lib/
git commit -m "feat(db): migration 0045 — pending device slots, device_command.device_id SET NULL"
```

---

### Task 2: Defer the renewal slot shrink to the anniversary; make the unpriced-slots warning honest

**Files:**
- Modify: `lib/device-slots.ts` (add `renewalSlotWrite`, `applyPendingSlots`), `lib/device-slots.test.ts`
- Modify: `lib/invoices.ts` (`markInvoicePaid` subscription branch, ~lines 436-530)
- Modify: `lib/billing-cron.ts` (`runBillingCron`: select + pending-apply step)

**Interfaces:**
- Produces: `renewalSlotWrite(a: { currentSlots: number; newSlots: number; paidBeforeAnniversary: boolean }): { writeNow: number; pending: number | null }`; `applyPendingSlots(a: { pending: number; paidDevices: number }): number`.
- Consumes: Task 1 columns; `slotsAfterPayment`, `unpricedSlots`, `freeSlots` (existing); `countPaidDevices`.

- [ ] **Step 1: Failing tests** (append to `lib/device-slots.test.ts`; extend its import)

```ts
describe("renewalSlotWrite", () => {
  it("applies a lower count immediately when paid at or after the anniversary", () => {
    expect(renewalSlotWrite({ currentSlots: 3, newSlots: 2, paidBeforeAnniversary: false })).toEqual({ writeNow: 2, pending: null });
  });
  it("parks a lower count when paid early — the old year's slots stay until the anniversary", () => {
    expect(renewalSlotWrite({ currentSlots: 3, newSlots: 2, paidBeforeAnniversary: true })).toEqual({ writeNow: 3, pending: 2 });
  });
  it("never parks a count that is not lower", () => {
    expect(renewalSlotWrite({ currentSlots: 3, newSlots: 3, paidBeforeAnniversary: true })).toEqual({ writeNow: 3, pending: null });
    expect(renewalSlotWrite({ currentSlots: 2, newSlots: 3, paidBeforeAnniversary: true })).toEqual({ writeNow: 3, pending: null });
  });
});

describe("applyPendingSlots", () => {
  it("applies the parked count but never below the devices that are paid by then", () => {
    expect(applyPendingSlots({ pending: 2, paidDevices: 2 })).toBe(2);
    expect(applyPendingSlots({ pending: 2, paidDevices: 3 })).toBe(3);
    expect(applyPendingSlots({ pending: 2, paidDevices: 0 })).toBe(2);
  });
});
```

Run: `npx vitest run lib/device-slots.test.ts` → FAIL (not exported).

- [ ] **Step 2: Implement in `lib/device-slots.ts`** (append)

```ts
/**
 * What a renewal payment writes to `paidDeviceSlots` NOW, and what it parks
 * for the anniversary. A renewal is issued 30 days early and priced at that
 * moment's paid-device count; when it is paid before the anniversary and that
 * count is LOWER than the current entitlement (a slot went vacant via RMA or
 * removal), the customer still owns the old year's slots through its last
 * day. Shrinking immediately would bill overage against a pool they paid
 * for, so the lower number is parked (`pending`) and applied by the billing
 * cron once the anniversary has passed. Paid at/after the anniversary, or
 * not lower at all → write it now, nothing pending.
 */
export function renewalSlotWrite(a: {
  currentSlots: number;
  newSlots: number;
  paidBeforeAnniversary: boolean;
}): { writeNow: number; pending: number | null } {
  if (!a.paidBeforeAnniversary || a.newSlots >= a.currentSlots) {
    return { writeNow: a.newSlots, pending: null };
  }
  return { writeNow: a.currentSlots, pending: a.newSlots };
}

/** The parked count takes effect, but never below what is paid by then — a
 *  proration settled in the meantime added a slot the customer paid for. */
export function applyPendingSlots(a: { pending: number; paidDevices: number }): number {
  return Math.max(a.pending, a.paidDevices);
}
```

Run the test → PASS.

- [ ] **Step 3: `markInvoicePaid` subscription branch (`lib/invoices.ts`)**

Import `applyPendingSlots` is not needed here; import `renewalSlotWrite` from `./device-slots`. Just after `const renewsAt = isFirst ? … : addMonthsAnchored(…)` and the existing `newSlots` computation, add:

```ts
    // Paid before the anniversary? Then a LOWER count must wait (see
    // renewalSlotWrite). `settings.renewsAt` is still the OLD anniversary
    // here — it is advanced by the upsert below.
    const currentRenewsAt = settings?.renewsAt ?? null;
    const paidBeforeAnniversary =
      !isFirst && currentRenewsAt !== null && now.getTime() < currentRenewsAt.getTime();
    const slotWrite = renewalSlotWrite({
      currentSlots: settings?.slots ?? 0,
      newSlots,
      paidBeforeAnniversary,
    });
```

Change the upsert's `values` and `set` so both write:

```ts
        paidDeviceSlots: slotWrite.writeNow,
        pendingDeviceSlots: slotWrite.pending,
        pendingSlotsAt: slotWrite.pending === null ? null : currentRenewsAt,
```

(keep `subscriptionStartedAt` / `subscriptionRenewsAt` / `updatedAt` as they are). Activation must be bounded by what this invoice PRICED, not by the old-year slots that stay written for one more month — otherwise a device would ride the new year free. Change the `free` line to:

```ts
    // Bound activation by the PRICED entitlement (`newSlots`), not by the
    // old-year slots that may stay written until the anniversary — a device
    // activated into one of those would ride the whole new year for free.
    const free = freeSlots({ paidDeviceSlots: newSlots, paidDevices: paidNow });
```

Replace the `unpriced` computation + warn with an honest one: a slot is not unpriced when a paid proration already covers this renewal period.

```ts
    // A slot the floor writes is only truly unpriced if NO paid proration
    // already covers this renewal period — a lead-window device pays a
    // ~13-month proration through the new year's end (settleClaimBilling).
    const [coveredRow] = await db
      .select({ covered: sql<number>`count(distinct ${invoice.deviceId})::int` })
      .from(invoice)
      .where(
        and(
          eq(invoice.organizationId, inv.organizationId),
          eq(invoice.kind, "proration"),
          eq(invoice.status, "paid"),
          gte(invoice.periodEnd, inv.periodEnd),
        ),
      );
    const unpriced = Math.max(
      0,
      unpricedSlots({ invoiceDeviceCount: inv.deviceCount, paidDevices: paidNow }) -
        Number(coveredRow?.covered ?? 0),
    );
    if (unpriced > 0) {
      console.warn("[billing] renewal wrote more slots than it was priced for", {
        organizationId: inv.organizationId,
        invoiceId: inv.id,
        invoicedDeviceCount: inv.deviceCount,
        slotsWritten: slotWrite.writeNow,
        unpricedSlots: unpriced,
        renewalPeriodEnd: inv.periodEnd.toISOString(),
      });
    }
```

Keep the existing explanatory comment above it but drop the sentence that told the operator to check prorations manually (the code now does). Also in the **proration branch** of `markInvoicePaid` (the `paidDeviceSlots + 1` update): leave it — a proration paid while a shrink is pending is covered by `applyPendingSlots`' `paidDevices` floor.

- [ ] **Step 4: Cron applies the pending shrink (`lib/billing-cron.ts`)**

Import `applyPendingSlots` from `./device-slots`. Add to the org select:

```ts
      pendingSlots: tenantSettings.pendingDeviceSlots,
      pendingAt: tenantSettings.pendingSlotsAt,
```

Inside the per-org `try`, AFTER the `for (const index of periodsToClose(...))` loop (so the old year's last period is closed against the old slot count) and BEFORE the "2. Renewal, 30 days ahead" block, add:

```ts
      // 1b. A renewal paid early parked its lower slot count (see
      //     renewalSlotWrite). Once the anniversary has passed, apply it —
      //     after closing the old year's periods above, which were owed the
      //     old entitlement. Conditional on pendingSlotsAt so a concurrent
      //     payment that re-parked a different value is not clobbered.
      if (org.pendingAt !== null && org.pendingSlots !== null && org.pendingAt.getTime() <= now.getTime()) {
        const paidDevices = await countPaidDevices(org.organizationId);
        await db
          .update(tenantSettings)
          .set({
            paidDeviceSlots: applyPendingSlots({ pending: org.pendingSlots, paidDevices }),
            pendingDeviceSlots: null,
            pendingSlotsAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(tenantSettings.organizationId, org.organizationId),
              eq(tenantSettings.pendingSlotsAt, org.pendingAt),
            ),
          );
      }
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && npm test` → clean.

```bash
git add lib/device-slots.ts lib/device-slots.test.ts lib/invoices.ts lib/billing-cron.ts
git commit -m "fix(billing): park an early-paid renewal's slot shrink until the anniversary; count covered prorations as priced"
```

---

### Task 3: Void a deleted device's open proration (one helper, three callers)

**Files:**
- Modify: `lib/invoices.ts` (export `voidOpenProrationsForDevice`; `activateDeviceIntoSlot` uses it)
- Modify: `lib/actions/devices.ts` (`deleteDevice`), `lib/factory-registry.ts` (`returnDeviceToStock`)

**Interfaces:**
- Produces: `voidOpenProrationsForDevice(a: { deviceId: string; organizationId: string; now?: Date; actor: AuditActor; reason: string }): Promise<string[]>` — voids `kind='proration' AND status='open'` invoices of that device, audits each with `AUDIT.invoiceVoided` and `metadata: { reason, deviceId }`, returns voided ids.

Rationale: `invoice.deviceId` is `ON DELETE SET NULL`, so deleting a device with an open proration leaves an orphan the customer is still asked to pay; paying it later increments nothing (falls into the "no device attached" warn branch).

- [ ] **Step 1: Extract the helper in `lib/invoices.ts`**

Replace the inline void block inside `activateDeviceIntoSlot` (the `db.update(invoice).set({ status: "void" })…` through the `for (const v of voided) { … }` loop) with a call:

```ts
  await voidOpenProrationsForDevice({
    deviceId,
    organizationId,
    now,
    actor,
    reason: "device_activated_into_free_slot",
  });
```

and add, as an exported function near `fillFreeSlots`:

```ts
/**
 * Void every OPEN proration invoice this device still carries. Two reasons
 * a device stops owing its proration: it landed in a slot the org already
 * paid for (activation), or it is being deleted / returned to stock and the
 * invoice would otherwise outlive it as an orphan the customer is still
 * asked to pay. Audited per invoice, same event as an operator void.
 */
export async function voidOpenProrationsForDevice(a: {
  deviceId: string;
  organizationId: string;
  now?: Date;
  actor: AuditActor;
  reason: string;
}): Promise<string[]> {
  const voided = await db
    .update(invoice)
    .set({ status: "void" })
    .where(
      and(
        eq(invoice.deviceId, a.deviceId),
        eq(invoice.organizationId, a.organizationId),
        eq(invoice.kind, "proration"),
        eq(invoice.status, "open"),
      ),
    )
    .returning({ id: invoice.id });

  for (const v of voided) {
    console.warn("[billing] voided an open proration", {
      reason: a.reason,
      deviceId: a.deviceId,
      organizationId: a.organizationId,
      invoiceId: v.id,
    });
    await recordAudit({
      organizationId: a.organizationId,
      actor: a.actor,
      action: AUDIT.invoiceVoided,
      target: { type: "invoice", id: v.id },
      metadata: { reason: a.reason, deviceId: a.deviceId },
    });
  }
  return voided.map((v) => v.id);
}
```

Keep the original comment text that explained the activation case above the call site. The `now` param is accepted for signature symmetry with the other helpers; it is unused inside (no `paidAt`/`voidedAt` column exists) — do not add a column.

- [ ] **Step 2: Admin `deleteDevice` (`lib/actions/devices.ts`)**

Import `voidOpenProrationsForDevice` alongside `fillFreeSlots`. Immediately BEFORE `await db.delete(deviceTable)…` add:

```ts
  // An open proration for a device that is about to be deleted would outlive
  // it as an orphan (invoice.deviceId is SET NULL) that the customer is still
  // asked to pay. Void it first — best-effort; the delete is what was asked.
  try {
    await voidOpenProrationsForDevice({
      deviceId,
      organizationId: device.organizationId,
      actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
      reason: "device_deleted",
    });
  } catch (err) {
    console.error("[billing] voiding prorations before device delete failed", err);
  }
```

- [ ] **Step 3: Registry `returnDeviceToStock` (`lib/factory-registry.ts`)**

`fillFreeSlots` is already imported from `@/lib/invoices`; add `voidOpenProrationsForDevice`. Before the `dbTx.transaction(...)` call, look the device up and void (outside the transaction — the neon-http `db` client and the pool `tx` are different drivers; an invoice voided for a device whose deletion then fails is recoverable by re-issuing, the reverse is not):

```ts
  // Void the device's open proration BEFORE the delete below sets the
  // invoice's deviceId to null and orphans it. Outside the transaction on
  // purpose: neon-http `db` and the pool-backed `tx` are different clients.
  const [pre] = await db
    .select({ organizationId: deviceTable.organizationId })
    .from(deviceTable)
    .where(eq(deviceTable.id, deviceId))
    .limit(1);
  if (pre) {
    try {
      await voidOpenProrationsForDevice({
        deviceId,
        organizationId: pre.organizationId,
        actor: { type: "system" },
        reason: "device_returned_to_stock",
      });
    } catch (err) {
      console.error("[billing] voiding prorations before return-to-stock failed", err);
    }
  }
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm test` → clean.

```bash
git add lib/invoices.ts lib/actions/devices.ts lib/factory-registry.ts
git commit -m "fix(billing): void a device's open proration when it is deleted or returned to stock"
```

---

### Task 4: Dependency bumps — Next 16.3.4, better-auth 1.6.30

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Bump**

```bash
npm install next@16.3.4 better-auth@1.6.30
grep -n '"next"\|"better-auth"' package.json
npm ls next better-auth sharp
```

Expected: `next` pinned `16.3.4`, `better-auth` `^1.6.30`; no nested `sharp@0.34.x` under `node_modules/next` anymore (`npm ls sharp` shows only the top-level 0.35.4).

- [ ] **Step 2: Prove it still builds and runs the auth surface**

```bash
npx tsc --noEmit && npm test && npm run build
npm audit --omit=dev 2>&1 | tail -20
```

All three must be clean. Read `node_modules/better-auth/dist/api/to-auth-endpoints.mjs` and confirm the before-hook contract used by `lib/auth.ts` is unchanged in 1.6.30: (a) `ctx.request` is undefined for direct `auth.api.*` calls (the HTTP-signup lock in `lib/auth-hooks.ts` relies on it), (b) a before-hook returning `{ context: { body } }` still replaces the endpoint body. Record the line numbers you checked in the report. If either changed, STOP and report BLOCKED with the evidence — do not work around it.

If `npm run build` fails on Next 16.3.4 for a reason unrelated to this repo's code, revert Next only (`npm install next@16.2.6`) and report DONE_WITH_CONCERNS naming the error.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): next 16.3.4, better-auth 1.6.30"
```

---

### Task 5: Refresh the hijack-recovery runbook

**Files:**
- Modify: `docs/runbooks/factory-registry-hijack-recovery.md`

- [ ] **Step 1: Correct the stale parts**

Edit in place (keep the document's structure and voice):

1. In "The exposure this covers", after the paragraph beginning "The serial is printed on the box", add:

```markdown
Two facts the deterrent list below understates, confirmed in the 2026-09-09
audit:

- **The pairing code is irrelevant on this path.** `autoClaimDevice` only
  requires a well-formed code that no device row already uses; it is stored,
  never matched. The per-code rate limit therefore does not slow a hijacker —
  they pick a fresh code per request. Only the per-IP limit applies.
- **What the rogue credential can see.** Connected to EMQX as the device, it
  receives every `config-changed` push for that org: org name, brand tokens,
  5-minute presigned R2 URLs for the tenant's branding images, the effective
  pinned URL, and the on-device settings PIN as `sha256(salt + PIN)` over a
  4–12 digit PIN (`lib/device-settings.ts`) — trivially brute-forced offline.
  It cannot trigger, cannot read other devices' topics (`${username}` ACL),
  and cannot reach any tenant data beyond that config payload.
```

2. Replace the "Rate limits" bullet's second sentence ("so a hijacker can't brute-force the pairing-code space quickly") with: "— the per-IP limit is the one that matters here; see the note above on why the per-code limit does not."

3. In "After recovery", replace the bullet beginning "If the org was billed for credits" with:

```markdown
- Billing side effects of the rogue claim (`settleClaimBilling`,
  `lib/invoices.ts`): if the org had a free paid slot the rogue device was
  activated into it — deleting the device frees the slot again and
  `fillFreeSlots` hands it to the real device on its claim. If there was no
  free slot a proration invoice was issued for the rogue device; deleting the
  device voids it automatically (`voidOpenProrationsForDevice`). Confirm on
  `/admin/customers/<org>` that no open proration remains for a device id
  that no longer exists.
```

4. Update the header line `_Owner: platform team · Last reviewed: 2026-07-10_` to `2026-09-09`.

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/factory-registry-hijack-recovery.md
git commit -m "docs(runbook): hijack recovery — pairing code irrelevance, config exposure, slot-era billing cleanup"
```

---

## Controller-only steps after all tasks (NOT for subagents)

1. `npm run db:migrate` against prod (0045 is additive + an FK swap on a tiny table) — BEFORE deploy, because Task 2's code reads the new columns.
2. `git checkout main && git merge --ff-only <branch> && git push origin main && vercel --prod --yes`.
3. Smoke: `/api/health`, `/login`, `/api/cron/billing` 401, `/api/auth/sign-up/email` 403.
