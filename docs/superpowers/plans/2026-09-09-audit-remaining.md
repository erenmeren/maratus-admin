# Audit Remaining Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every remaining Low finding and deferred minor from the 2026-09-09 audit so nothing is left open: leap-day renewal drift, first-invoice period label, proration period labels, silent clamp, admin overview denominator, serial-less retire idempotency, dead parameter, duplicated scope checks, log fields, vestigial catch, and `npm audit` residuals.

**Architecture:** Pure date arithmetic stays in `lib/billing-period.ts` with tests; billing IO in `lib/invoices.ts` / `lib/billing-cron.ts` only consumes it. A shared `requireScope` in `lib/api/guard.ts` replaces five copies. No schema change.

**Tech Stack:** Next.js 16, TypeScript strict, Drizzle, vitest.

**Spec:** Audit + final-review findings of 2026-09-09 (session); the "Deferred" lists in `docs/superpowers/plans/2026-09-09-security-and-logic-fixes.md` and `2026-09-09-audit-followups.md`.

## Global Constraints

- **Never run anything against the database.** vitest loads `.env.local` (PRODUCTION). No db:* scripts. Tests stay pure.
- Money in integer cents; months are integers; `paidDeviceSlots` semantics unchanged.
- `npx tsc --noEmit && npm test` clean before every commit; Task 4 also `npm run build`. Commit per task, explicit `git add`, do not push.
- Only touch listed files.

---

### Task 1: Billing-period correctness — leap-day renewal, first-payment anchor, proration labels, clamp log

**Files:**
- Modify: `lib/billing-period.ts` (+ `nextRenewalAt`), `lib/billing-period.test.ts`
- Modify: `lib/invoices.ts` (`markInvoicePaid` subscription branch; `settleClaimBilling`; `issueProrationsForUnpaidDevices`)
- Modify: `lib/billing-cron.ts` (renewal `periodEnd`)

**Interfaces:**
- Produces: `nextRenewalAt(startedAt: Date, currentRenewsAt: Date): Date` — the anniversary after `currentRenewsAt`, derived from the ANCHOR so a Feb-28 clamp is never carried forward.

Background: (a) `renewsAt` is advanced by `addMonthsAnchored(renewsAt, 12)`, so a Feb-29 anchor walks to Feb-28 forever while `periodStartFor(anchor, …)` lands on Feb-29 in leap years — period boundaries and the renewal date disagree by a day. (b) The first subscription invoice says `periodStart = startOfUtcDay(issue)` but the anchor is written as the payment INSTANT, so every later boundary is mid-day and the invoice's stated period never matches. (c) Proration invoices carry `periodStart = periodStartFor(startedAt, now)` (current MONTH start) and `periodEnd = periodEndFor(…)` (current MONTH end, or the renewal end for lead-window claims) — neither describes what the charge covers. (d) `prorationMonthsThrough` clamps to 1 silently.

- [ ] **Step 1: Failing tests** (append to `lib/billing-period.test.ts`, extend import)

```ts
describe("nextRenewalAt", () => {
  it("advances a normal anchor by exactly one year", () => {
    const anchor = new Date("2026-09-10T00:00:00Z");
    expect(nextRenewalAt(anchor, new Date("2027-09-10T00:00:00Z"))).toEqual(new Date("2028-09-10T00:00:00Z"));
  });
  it("does not carry a Feb-28 clamp forward across leap years", () => {
    const anchor = new Date("2028-02-29T00:00:00Z");
    const y1 = nextRenewalAt(anchor, anchor); // first renewal
    expect(y1).toEqual(new Date("2029-02-28T00:00:00Z"));
    const y2 = nextRenewalAt(anchor, y1);
    expect(y2).toEqual(new Date("2030-02-28T00:00:00Z"));
    const y3 = nextRenewalAt(anchor, y2);
    const y4 = nextRenewalAt(anchor, y3);
    expect(y4).toEqual(new Date("2032-02-29T00:00:00Z")); // back on the true anniversary
  });
  it("tolerates a renewsAt that drifted a day off the anchor grid", () => {
    const anchor = new Date("2028-02-29T00:00:00Z");
    expect(nextRenewalAt(anchor, new Date("2031-02-28T00:00:00Z"))).toEqual(new Date("2032-02-29T00:00:00Z"));
  });
});
```

Run: `npx vitest run lib/billing-period.test.ts` → FAIL.

- [ ] **Step 2: Implement in `lib/billing-period.ts`**

```ts
/**
 * The anniversary after `currentRenewsAt`, computed from the ANCHOR rather than
 * by adding 12 months to the current date: a Feb-29 anchor renews on Feb-28 in
 * common years, and adding 12 months to Feb-28 would keep it there forever,
 * while periodStartFor(anchor, …) lands on Feb-29 again in the next leap year.
 * Deriving from the anchor keeps the renewal date on the same grid as every
 * period boundary. Rounds the elapsed cycles so a renewsAt that sits a day off
 * the grid (clamped) still maps to the right cycle.
 */
export function nextRenewalAt(startedAt: Date, currentRenewsAt: Date): Date {
  const cycles = Math.round(periodIndexFor(startedAt, currentRenewsAt) / MONTHS_PER_YEAR);
  return addMonthsAnchored(startedAt, MONTHS_PER_YEAR * (cycles + 1));
}
```

Run the test → PASS. (Check `periodIndexFor(anchor, anchor)` is 0 → cycles 0 → first renewal = +12 months; the second test's first assertion relies on that.)

- [ ] **Step 3: `markInvoicePaid` subscription branch (`lib/invoices.ts`)**

Import `nextRenewalAt` and `startOfUtcDay` from `./billing-period`. Change the anchor/renewal computation to:

```ts
    const isFirst = !settings?.startedAt;
    // First payment anchors the calendar at MIDNIGHT UTC of the payment day,
    // so every period boundary — and the invoice's own stated period — sits
    // on a day boundary rather than at the second the admin clicked.
    const startedAt = settings?.startedAt ?? startOfUtcDay(now);
    const renewsAt = isFirst
      ? renewalDueAt(startedAt)
      : nextRenewalAt(startedAt, settings.renewsAt ?? renewalDueAt(startedAt));
```

`paidBeforeAnniversary` and everything below stay as they are (they read `settings.renewsAt`, the OLD anniversary). Right after the tenantSettings upsert (before activation), on a FIRST payment, make the invoice say what it actually covers — best-effort, because the `(organizationId, kind, periodStart)` unique index could collide with a same-day voided invoice:

```ts
    if (isFirst) {
      try {
        await db
          .update(invoice)
          .set({ periodStart: startedAt, periodEnd: renewsAt })
          .where(eq(invoice.id, inv.id));
      } catch (err) {
        console.warn("[billing] could not align the first invoice's period to the anchor (label only)", {
          invoiceId: inv.id,
          organizationId: inv.organizationId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
```

- [ ] **Step 4: Proration labels + clamp log (`lib/invoices.ts`)**

In `settleClaimBilling`, change the `issueProrationInvoice` call's period fields to describe the charge:

```ts
      // The row describes what is charged: from the claim day until the
      // horizon the months were priced to (the issued renewal's end, or the
      // current anniversary).
      periodStart: startOfUtcDay(now),
      periodEnd: openRenewalPeriodEnd ?? settings.renewsAt,
```

and just before that call, surface the clamp that `prorationMonthsThrough` applies silently:

```ts
    if (openRenewalPeriodEnd === null && now.getTime() >= settings.renewsAt.getTime()) {
      console.warn("[billing] device claimed after the anniversary with no renewal issued; proration clamped to one month", {
        deviceId,
        organizationId,
        renewsAt: settings.renewsAt.toISOString(),
      });
    }
```

In `issueProrationsForUnpaidDevices`, same label change: `periodStart: startOfUtcDay(a.now)`, `periodEnd: a.renewsAt`. Remove the now-unused `periodStartFor`/`periodEndFor` imports if nothing else in the file uses them (tsc/eslint will tell).

- [ ] **Step 5: Cron renewal `periodEnd` (`lib/billing-cron.ts`)**

Import `nextRenewalAt` from `./billing-period` and change the renewal issuance to `periodEnd: nextRenewalAt(anchor, org.renewsAt)` (the `anchor` const is `org.startedAt`). Remove `addMonthsAnchored`/`MONTHS_PER_YEAR` from the import if unused now.

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && npm test` → clean.

```bash
git add lib/billing-period.ts lib/billing-period.test.ts lib/invoices.ts lib/billing-cron.ts
git commit -m "fix(billing): anchor-derived renewals (no leap-day drift), day-aligned first anchor, honest proration periods, clamp log"
```

---

### Task 2: Admin overview denominator, serial-less retire idempotency, dead parameter

**Files:**
- Modify: `lib/data.ts` (`getAdminOverview`), `lib/factory-registry.ts` (`retireDeviceWithCustomer`), `lib/invoices.ts` (`voidOpenProrationsForDevice` signature) and its three callers (`lib/invoices.ts` activation, `lib/actions/devices.ts`, `lib/factory-registry.ts`)

- [ ] **Step 1: `getAdminOverview` counts claimed devices with effective status**

Replace the `for (const b of bundles) { for (const d of b.devices) { totalDevices++; if (d.status === "online") activeDevices++; } }` loop with sums over the already-computed `summaries` — read `summarize()`'s return type in the same file and use its per-tenant claimed-device count and online count (they exist; the fleet page and health page use the same numbers). If the field names are `deviceCount`/`onlineCount`:

```ts
  const totalDevices = summaries.reduce((a, s) => a + s.deviceCount, 0);
  const activeDevices = summaries.reduce((a, s) => a + s.onlineCount, 0);
```

(remove the `let` declarations and the loop). Confirm by reading `summarize` that these exclude unclaimed rows and derive status via `effectiveDeviceStatus`.

- [ ] **Step 2: `retireDeviceWithCustomer` idempotency for a serial-less device**

Add `subscriptionPaidAt: deviceTable.subscriptionPaidAt` to the `for("update")` select. Replace the "already retired" test with:

```ts
    // Already done? With a registry row, its status says so. Without one (a
    // pre-registry claim, or a serial conflict) the only durable trace of a
    // prior run is the released slot: paused AND unpaid. A device the tenant
    // merely paused is paused AND still paid — that one still needs retiring.
    const alreadyRetired = dev.serial
      ? dev.status === "paused" && registryRetired
      : dev.status === "paused" && dev.subscriptionPaidAt === null;
    if (alreadyRetired) {
      return { ok: true, changed: false, serial: dev.serial, deviceName: dev.name };
    }
```

Keep the `registryRetired` lookup for the serial case as is.

- [ ] **Step 3: Drop the unused `now` parameter from `voidOpenProrationsForDevice`**

Remove `now?: Date` from its parameter type and the `now,` argument at the activation call site in `lib/invoices.ts`; the other two callers do not pass it. Update the helper's doc comment if it mentions `now`.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm test` → clean.

```bash
git add lib/data.ts lib/factory-registry.ts lib/invoices.ts lib/actions/devices.ts
git commit -m "fix(admin,registry): count only claimed devices in the overview; retire idempotency for serial-less devices; drop dead param"
```

---

### Task 3: `requireScope` helper, log fields, vestigial catch

**Files:**
- Modify: `lib/api/guard.ts`; `app/api/v1/devices/[deviceId]/trigger/route.ts`, `app/api/v1/usage/route.ts`, `app/api/v1/devices/[deviceId]/pin/route.ts`, `app/api/v1/stores/[storeId]/pin/route.ts`, `app/api/v1/org/pin/route.ts`
- Modify: `lib/api/pin-idempotency.ts` (release log), `lib/actions/members.ts` (`acceptInviteSignup` catch)

- [ ] **Step 1: Add `requireScope` to `lib/api/guard.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKey as apiKeyTable } from "@/lib/db/schema";
import { hasScope, type ApiScope } from "@/lib/api-scopes";

/** 403 unless the authenticated key carries `scope`; null when it does. One
 *  place for the check so a new route cannot forget it. */
export async function requireScope(auth: ApiKeyAuth, scope: ApiScope): Promise<NextResponse | null> {
  const [key] = await db.select({ scopes: apiKeyTable.scopes }).from(apiKeyTable).where(eq(apiKeyTable.id, auth.keyId)).limit(1);
  if (hasScope(key?.scopes, scope)) return null;
  return apiError("insufficient_scope", `API key lacks the ${scope} scope.`, 403);
}
```

(merge imports with the file's existing ones).

- [ ] **Step 2: Use it in the five routes**

Trigger route: replace the `const [key] = … if (!hasScope(key?.scopes, "devices:trigger")) { return apiError(…) }` block with `const denied = await requireScope(auth, "devices:trigger"); if (denied) return denied;`. Usage route: same with `"usage:read"`. The three pin routes: delete their local `requirePinScope` function and replace each `if (!(await requirePinScope(auth.keyId))) { return apiError(…) }` (PUT and DELETE) with `const denied = await requireScope(auth, "devices:pin"); if (denied) return denied;`. Remove now-unused imports (`hasScope`, `apiKeyTable`, `db`/`eq` where nothing else uses them). Error code and message text must be identical to before (`insufficient_scope`, "API key lacks the <scope> scope.").

- [ ] **Step 3: Log fields + vestigial catch**

`lib/api/pin-idempotency.ts` `withPinClaim`: `console.error("[pin] releasing idempotency claim failed", { nsKey: claim.nsKey, organizationId: claim.organizationId, err: releaseErr })`.

`lib/actions/members.ts` `acceptInviteSignup`: the pre-check added on 2026-09-09 already returns "An account with that email already exists — sign in to accept." for an existing user, so the regex mapping in the `catch` is dead; simplify the catch to `return { ok: false, error: err instanceof Error ? err.message : "Sign up failed." };`.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm test` → clean.

```bash
git add lib/api/guard.ts app/api/v1 lib/api/pin-idempotency.ts lib/actions/members.ts
git commit -m "refactor(api): shared requireScope for v1 routes; richer pin release log; drop vestigial catch mapping"
```

---

### Task 4: `npm audit fix` (non-force) and prove the build

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1:** `npm audit fix` (NO `--force`). Then `grep -n '"' package.json | sed -n 1,80p` and `git diff package.json` — only version ranges of existing entries may move; no dependency added/removed. If audit fix wants to change a direct dependency's MAJOR version, revert that one (`git checkout package.json` for it, re-run the fix for the rest) and note it.
- [ ] **Step 2:** `npx tsc --noEmit && npm test && npm run build` → all clean. `npm audit --omit=dev 2>&1 | tail -15` → record residuals (expected: none, or only ones needing `--force`).
- [ ] **Step 3:** Commit: `git add package.json package-lock.json && git commit -m "chore(deps): npm audit fix (non-breaking)"`. If audit fix changed nothing, commit nothing and report that.
