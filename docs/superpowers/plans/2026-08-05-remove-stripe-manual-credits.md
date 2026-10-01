# Remove Stripe — Manual Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Stripe from the codebase entirely; the operator invoices manually and manages tenant credits (grant + deduct) from the super-admin panel.

**Architecture:** Billing plans (`credits`/`flat`/`base_usage`) and all trigger metering stay untouched — only the Stripe payment/sync layer is deleted. A new `deductCredits` primitive (ledger kind `"adjust"`, negative credits) joins the existing CAS-guarded credit primitives, and the admin grant form becomes an add/deduct form. The tenant billing page loses its buy flow in favor of a contact note.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (Neon Postgres), vitest, shadcn/ui (radix-nova).

**Spec:** `docs/superpowers/specs/2026-08-05-remove-stripe-manual-credits-design.md`

## Global Constraints

- Branch: work on `refactor/remove-stripe` off `main`.
- Gates for every task: `npm test` (vitest, all suites green), `npx tsc --noEmit` (0 errors). `npm run build` where noted.
- Ledger convention change: `credits` was "always positive; kind conveys direction". The new `"adjust"` kind is the one exception — it stores a **negative** integer. Update the header comment in `lib/credits.ts` when adding it (Task 1).
- Keep: `lib/audit.ts` actor variant `{ type: "stripe" }` (historical rows), `creditLedger` kind `"purchase"` (historical rows), `lib/billing/invoice-emails.ts` (shared email helpers used by non-Stripe code).
- **Do NOT run `npm run db:migrate` during implementation.** `.env.local` points at PROD Neon and the currently deployed code still selects the Stripe columns. The migration (Task 6) is generated + committed only; it is applied after the code deploy (see Task 8).
- UI copy is English; commit messages follow existing `feat:`/`refactor:`/`docs:` style and end with the Claude co-author trailer.

---

### Task 1: `deductCredits` primitive + `"adjust"` ledger kind

**Files:**
- Modify: `lib/db/schema.ts:474` (creditLedger `kind` enum)
- Modify: `lib/credits.ts` (header comment, `LedgerRow`, new `deductCredits`)
- Modify: `lib/credits-overview.ts` (`CreditLedgerRow.kind`, `rollupCredits` switch)
- Test: `lib/credits-overview.test.ts`

**Interfaces:**
- Consumes: existing `ledger()` helper, `creditBalance`/`creditLedger` tables, `db`, drizzle `and/eq/gte/sql`.
- Produces: `deductCredits(a: { organizationId: string; credits: number; note?: string; createdByUserId?: string }): Promise<{ ok: true; availableAfter: number } | { ok: false; reason: "insufficient" }>` — Task 2 calls this. Ledger kind union everywhere becomes `"grant" | "purchase" | "hold" | "settle" | "release" | "spend" | "adjust"`.

- [ ] **Step 1: Write the failing rollup test**

Append to the existing `describe` in `lib/credits-overview.test.ts` (match the file's existing style for constructing rows; the shapes below are the full `CreditLedgerRow`/`CreditBalanceRow` interfaces):

```ts
it("nets adjust rows (negative credits) against granted totals", () => {
  const now = new Date("2026-08-05T12:00:00Z");
  const out = rollupCredits(
    [
      { orgId: "o1", name: "Org", kind: "grant", credits: 100, createdAt: now },
      { orgId: "o1", name: "Org", kind: "adjust", credits: -30, createdAt: now },
    ],
    [{ orgId: "o1", name: "Org", available: 70 }],
    now,
  );
  expect(out.totals.granted).toBe(70);
  expect(out.totals.consumed).toBe(0);
  expect(out.totals.outstanding).toBe(70);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/credits-overview.test.ts`
Expected: FAIL — TS rejects `kind: "adjust"` (not in union) / `granted` is `100`, not `70`.

- [ ] **Step 3: Implement the kind + rollup case**

`lib/credits-overview.ts`: extend the union on line 8 and add a switch case after `case "grant":`'s block:

```ts
kind: "grant" | "purchase" | "hold" | "settle" | "release" | "spend" | "adjust";
```

```ts
      case "adjust":
        // Manual admin deduction — stored negative, nets against grants.
        granted += row.credits;
        break;
```

`lib/db/schema.ts` (creditLedger): 

```ts
    kind: text("kind", { enum: ["grant", "purchase", "hold", "settle", "release", "spend", "adjust"] }).notNull(),
```

- [ ] **Step 4: Add `deductCredits` to `lib/credits.ts`**

Extend `LedgerRow.kind` with `"adjust"`. Amend the header comment (lines 7–9) to:

```ts
// Ledger convention: `credits` is a positive integer and `kind` conveys
// direction (hold/settle/release decrease one bucket; grant/purchase increase
// available) — with one exception: "adjust" (manual admin deduction) stores a
// NEGATIVE integer so sums over grant+adjust net out naturally.
```

Append after `grantCredits`:

```ts
/** Manually remove credits (admin correction / unpaid invoice claw-back).
 *  Atomic: only succeeds when `available >= credits`; `held` is never touched.
 *  Ledger row is kind "adjust" with NEGATIVE credits (see header convention). */
export async function deductCredits(a: {
  organizationId: string;
  credits: number; // positive amount to remove
  note?: string;
  createdByUserId?: string;
}): Promise<{ ok: true; availableAfter: number } | { ok: false; reason: "insufficient" }> {
  const [updated] = await db
    .update(creditBalance)
    .set({
      available: sql`${creditBalance.available} - ${a.credits}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(creditBalance.organizationId, a.organizationId),
        gte(creditBalance.available, a.credits),
      ),
    )
    .returning({ available: creditBalance.available });
  if (!updated) return { ok: false, reason: "insufficient" };
  await ledger({
    organizationId: a.organizationId,
    kind: "adjust",
    credits: -a.credits,
    note: a.note ?? null,
    balanceAfterAvailable: updated.available,
    createdByUserId: a.createdByUserId ?? null,
  });
  return { ok: true, availableAfter: updated.available };
}
```

(No unit test for `deductCredits` itself — it is DB-bound, like the other primitives in this file, none of which have unit tests. The pure rollup change is the tested surface.)

- [ ] **Step 5: Run gates**

Run: `npx vitest run lib/credits-overview.test.ts` → PASS, then `npm test` and `npx tsc --noEmit` → green.

- [ ] **Step 6: Commit**

```bash
git add lib/credits.ts lib/credits-overview.ts lib/credits-overview.test.ts lib/db/schema.ts
git commit -m "feat(credits): deductCredits primitive with 'adjust' ledger kind"
```

---

### Task 2: Admin add/deduct form + audit action

**Files:**
- Modify: `lib/audit.ts:50` (add action), `lib/audit-labels.ts:51` (add label)
- Modify: `lib/actions/credits.ts` (replace `grantCreditsAction` with `adjustCreditsAction`)
- Create: `components/adjust-credits-form.tsx` (replaces `components/grant-credits-form.tsx`)
- Delete: `components/grant-credits-form.tsx`
- Modify: `app/(admin)/admin/customers/[tenantId]/page.tsx:251` (swap component)
- Test: `lib/audit-labels.test.ts` only if it enumerates actions exhaustively (check; if it asserts every `AUDIT` value has a label, the new pair keeps it green automatically).

**Interfaces:**
- Consumes: `deductCredits` / `grantCredits` from Task 1, `requirePlatformAdmin`, `isOrgArchived`, `recordAudit`/`AUDIT`.
- Produces: `adjustCreditsAction(_prev: GrantState, formData: FormData): Promise<GrantState>` reading fields `organizationId`, `direction` (`"grant" | "deduct"`), `credits`, `note`; `<AdjustCreditsForm organizationId={string} />`.

- [ ] **Step 1: Add the audit action + label**

`lib/audit.ts` — next to `creditsGranted`:

```ts
  creditsDeducted: "credits.deducted",
```

`lib/audit-labels.ts` — next to `"credits.granted"`:

```ts
  "credits.deducted": "Credits deducted",
```

- [ ] **Step 2: Replace the server action**

`grantCreditsAction` is only imported by `components/grant-credits-form.tsx` (verify: `grep -rn grantCreditsAction app components lib`). Rewrite `lib/actions/credits.ts`:

```ts
"use server";
import { requirePlatformAdmin } from "@/lib/session";
import { grantCredits, deductCredits } from "@/lib/credits";
import { recordAudit, AUDIT } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { isOrgArchived } from "@/lib/archived-guard";

export type GrantState = { ok: boolean; error?: string };

export async function adjustCreditsAction(
  _prev: GrantState,
  formData: FormData,
): Promise<GrantState> {
  const ctx = await requirePlatformAdmin();
  const orgId = String(formData.get("organizationId") ?? "");
  const direction = String(formData.get("direction") ?? "grant");
  const credits = Number(formData.get("credits") ?? 0);
  const note = String(formData.get("note") ?? "").trim() || undefined;
  if (
    !orgId ||
    (direction !== "grant" && direction !== "deduct") ||
    !Number.isInteger(credits) ||
    credits <= 0 ||
    credits > 1_000_000
  ) {
    return {
      ok: false,
      error: "Enter a whole credit amount between 1 and 1,000,000.",
    };
  }
  if (await isOrgArchived(orgId)) {
    return { ok: false, error: "Customer is archived." };
  }
  if (direction === "deduct") {
    const res = await deductCredits({
      organizationId: orgId,
      credits,
      note,
      createdByUserId: ctx.user.id,
    });
    if (!res.ok) {
      return { ok: false, error: "Insufficient available balance to deduct that amount." };
    }
  } else {
    await grantCredits({
      organizationId: orgId,
      credits,
      kind: "grant",
      note,
      createdByUserId: ctx.user.id,
    });
  }
  await recordAudit({
    organizationId: orgId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: direction === "deduct" ? AUDIT.creditsDeducted : AUDIT.creditsGranted,
    metadata: { credits, note },
  });
  revalidatePath(`/admin/customers/${orgId}`);
  return { ok: true };
}
```

- [ ] **Step 3: Create the form component**

`components/adjust-credits-form.tsx` (then `git rm components/grant-credits-form.tsx`):

```tsx
"use client";

import { useActionState } from "react";
import { adjustCreditsAction, type GrantState } from "@/lib/actions/credits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: GrantState = { ok: false };

export function AdjustCreditsForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(adjustCreditsAction, initialState);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-1">
        <Label className="text-xs font-medium text-muted-foreground">Direction</Label>
        <div className="flex h-9 items-center gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" name="direction" value="grant" defaultChecked /> Add
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" name="direction" value="deduct" /> Deduct
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="credits-amount" className="text-xs font-medium text-muted-foreground">
          Credits
        </Label>
        <Input
          id="credits-amount"
          name="credits"
          type="number"
          min={1}
          max={1000000}
          step={1}
          required
          placeholder="e.g. 100"
          className="h-9 w-36 tabular-nums"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="credits-note" className="text-xs font-medium text-muted-foreground">
          Note (optional)
        </Label>
        <Input
          id="credits-note"
          name="note"
          type="text"
          placeholder="e.g. invoice #42 unpaid"
          className="h-9 w-56"
        />
      </div>

      <Button type="submit" disabled={pending} className="h-9">
        {pending ? "Applying…" : "Apply"}
      </Button>

      {state.error && (
        <p className="w-full text-sm text-destructive">{state.error}</p>
      )}
      {state.ok && (
        <p className="w-full text-sm text-green-600 dark:text-green-400">Credits updated.</p>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Swap the usage**

`app/(admin)/admin/customers/[tenantId]/page.tsx`: change the import of `GrantCreditsForm` from `@/components/grant-credits-form` to `AdjustCreditsForm` from `@/components/adjust-credits-form`, and line 251 to `{!isArchived && <AdjustCreditsForm organizationId={tenantId} />}`. The ledger table below it renders `kind` raw (`capitalize`) — an `"adjust"` row shows as "Adjust" with a negative credits number; no change needed.

- [ ] **Step 5: Run gates**

`npm test` and `npx tsc --noEmit` → green.

- [ ] **Step 6: Commit**

```bash
git add -A lib/audit.ts lib/audit-labels.ts lib/actions/credits.ts components app/
git commit -m "feat(admin): add/deduct credits form with credits.deducted audit action"
```

---

### Task 3: Tenant billing page — remove the buy flow

**Files:**
- Modify: `app/(tenant)/tenant/billing/page.tsx`
- Delete: `components/billing/buy-credits-form.tsx`, `app/(tenant)/tenant/billing/actions.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: none downstream. `lib/billing/credit-packs.ts` becomes tenant-unreferenced (deleted in Task 4 once `stripe-billing.ts` — its last importer — goes too).

- [ ] **Step 1: Verify sole consumers**

Run: `grep -rn "buy-credits-form\|startCreditCheckout\|BuyCreditsSection" app components lib --include="*.ts" --include="*.tsx"`
Expected: only `app/(tenant)/tenant/billing/page.tsx` (component import) and the two files being deleted.

- [ ] **Step 2: Rewrite the page**

In `app/(tenant)/tenant/billing/page.tsx`:
- Remove imports: `BuyCreditsSection`, `creditPacks`, `canManageTenant`.
- Remove the `canManage` computation and `const packs = creditPacks();`. With `canManage` gone, `ctx` is unused — change the destructure to `const { organizationId } = await requireTenant();`.
- Replace the `<BuyCreditsSection …/>` element with:

```tsx
      <PageSection title="Credits">
        <p className="text-sm text-muted-foreground">
          Credits are added to your account by the Maratus team. Contact us to top
          up your balance — current balance and this month&apos;s usage are shown
          below.
        </p>
      </PageSection>
```

- Keep `PageHeader`, both usage sections, and all data fetching except the now-unused pieces (`getTenant` and `billingPlan`/`includedTriggersPerDevice` ARE still used by the "Device usage this month" section — keep them).

- [ ] **Step 3: Delete the dead files**

```bash
git rm components/billing/buy-credits-form.tsx "app/(tenant)/tenant/billing/actions.ts"
```

- [ ] **Step 4: Run gates**

`npm test`, `npx tsc --noEmit` → green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(tenant): billing page drops Stripe buy flow for contact note"
```

---

### Task 4: Delete the Stripe core + all sync call sites

**Files:**
- Delete: `lib/stripe.ts`, `lib/billing/stripe-billing.ts`, `lib/billing/device-subscription.ts`, `lib/billing/device-subscription-logic.ts`, `lib/billing/device-subscription-logic.test.ts`, `lib/billing/credit-packs.ts`, `app/api/stripe/` (whole directory)
- Modify: `lib/device-claim.ts` (2 sites), `app/api/device/claim/route.ts`, `lib/actions/devices.ts`, `lib/actions/offboarding.ts` (2 sites), `lib/actions/billing-plan.ts`, `app/api/cron/health/route.ts`, `lib/data.ts:2327` (comment only)

**Interfaces:**
- Consumes: Tasks 1–3 already removed the other importers of these modules.
- Produces: no `syncDeviceSubscription` / `syncAllDeviceSubscriptions` / `stripe` symbol exists anywhere afterwards. `lib/billing/` retains only `invoice-emails.ts` (+ its test).

- [ ] **Step 1: Remove call sites**

In each file, delete the `import { syncDeviceSubscription } …` line and the whole fail-open block including its leading comment:

- `lib/device-claim.ts` lines ~72–78 and ~123–129 (both `// Keep the per-device subscription quantity in sync (fail-open — a Stripe hiccup must never fail a claim).` + `try/catch`).
- `lib/actions/devices.ts` lines ~233–240 (comment + try/catch after delete).
- `lib/actions/offboarding.ts` lines ~202–209 and ~244–250 (both comment + try/catch).
- `lib/actions/billing-plan.ts` lines ~48–53 (`// Reconcile the Stripe subscription …` + try/catch).
- `app/api/device/claim/route.ts`: the import and the whole `after(async () => { … syncDeviceSubscription … })` block (lines ~76–86, including its `// Stripe hiccup …` comment). Keep the admin-notification `after()` below it.
- `app/api/cron/health/route.ts`: remove the import, the `const subs = await syncAllDeviceSubscriptions();` line, and change the response to `return NextResponse.json({ ok: true, ...summary });`.

- [ ] **Step 2: Delete the modules**

```bash
git rm lib/stripe.ts lib/billing/stripe-billing.ts lib/billing/device-subscription.ts \
  lib/billing/device-subscription-logic.ts lib/billing/device-subscription-logic.test.ts \
  lib/billing/credit-packs.ts
git rm -r app/api/stripe
```

- [ ] **Step 3: Fix the stale comment in `lib/data.ts`**

`getPlanMix`'s doc comment (~line 2327): change `(the revenue proxy while Stripe figures stay out of scope)` to `(the revenue proxy for manual invoicing)`.

- [ ] **Step 4: Run gates**

`npm test`, `npx tsc --noEmit` → green (device-subscription-logic tests are gone with their module; suite count drops accordingly).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(billing): delete Stripe client, checkout, webhook and device-subscription sync"
```

---

### Task 5: Integration status, env, packages

**Files:**
- Modify: `lib/integration-status.ts` (drop `StripeMode`/`stripeMode`), `lib/integration-status.test.ts` (drop its describe block + import)
- Modify: `components/admin/integration-health-card.tsx`
- Modify: `lib/env.ts` (remove 6 `STRIPE_*` vars), `.env.example` (remove the Stripe block)
- Modify: `package.json` / `package-lock.json` via `npm uninstall`

**Interfaces:**
- Consumes: Task 4 removed every other reader of `STRIPE_*` env and the `stripe` package.
- Produces: `lib/integration-status.ts` exports only the email surface; the admin health card shows a single (email) row.

- [ ] **Step 1: Trim `lib/integration-status.ts`**

Delete lines 85–92 (`StripeMode` type + `stripeMode`). Update the header comment: it currently says "the two integrations" — reword to describe email only, e.g. first line → `// Configuration status for transactional email, which fails SILENTLY when half-configured — which is exactly how it sat unnoticed for weeks.` (keep the rest of the email explanation).

- [ ] **Step 2: Trim the test**

`lib/integration-status.test.ts`: remove `stripeMode` from the import and the whole `describe("stripeMode", …)` block.

- [ ] **Step 3: Trim the health card**

`components/admin/integration-health-card.tsx`:
- Remove `STRIPE_TONE`, the `stripeMode`/`StripeMode` imports, `const mode = …`, and the entire Payments `<Row …/>`.
- Update the header comment (lines 2–4) to mention only the email failure mode.

- [ ] **Step 4: Env cleanup**

`lib/env.ts`: delete the `// Stripe billing …` comment and all six keys: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_CREDIT_PACK_PRICE_IDS`, `STRIPE_FLAT_PRICE_ID`, `STRIPE_BASE_PRICE_ID` (plus the per-device price comment).
`.env.example`: delete the `# ---- Stripe billing (test mode) ----` block (lines ~28–39, everything up to but not including the Sentry comment).

- [ ] **Step 5: Uninstall packages**

Run: `npm uninstall stripe @stripe/stripe-js @stripe/react-stripe-js`

- [ ] **Step 6: Run gates**

`npm test`, `npx tsc --noEmit`, and `npm run build` (full build here — env schema + package graph changed) → green.

- [ ] **Step 7: Sweep check**

Run: `grep -rin "stripe" app lib components middleware.ts next.config.ts --include="*.ts" --include="*.tsx"`
Expected: exactly one hit — `lib/audit.ts` `| { type: "stripe" };` (historical actor). Anything else is a leftover to fix now.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: drop Stripe env vars, packages and admin payments health row"
```

---

### Task 6: Migration — drop the three Stripe columns

**Files:**
- Modify: `lib/db/schema.ts` (tenantSettings: remove `stripeCustomerId` ~line 204, `stripeSubscriptionId` + `stripeSubscriptionItemId` ~lines 218–219 and the `// Per-device quantity subscription …` comment above them)
- Create: `drizzle/00XX_*.sql` + meta snapshot via `npm run db:generate`

**Interfaces:**
- Consumes: Task 4/5 removed all code reading these columns.
- Produces: a committed, NOT-YET-APPLIED migration. Task 8 applies it post-deploy.

- [ ] **Step 1: Remove the columns from the schema**

Delete the three column definitions and the subscription comment block from `tenantSettings`. `billingPlan`, `includedTriggersPerDevice`, and everything else stay.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Then open the new `drizzle/00XX_*.sql`. **Known hazard (drizzle snapshot drift): strip the file down to exactly:**

```sql
ALTER TABLE "tenant_settings" DROP COLUMN "stripe_customer_id";--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "stripe_subscription_id";--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "stripe_subscription_item_id";
```

Delete any spurious FK/index churn statements the generator emits. Keep the generated meta snapshot as-is.

- [ ] **Step 3: Gates (no migrate!)**

`npm test`, `npx tsc --noEmit` → green. **Do not run `npm run db:migrate`** — `.env.local` is PROD and the live deployment still queries these columns (its sync calls are fail-open, but don't create noise). Applied in Task 8.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(db): drop tenant_settings Stripe columns (migration deferred to deploy)"
```

---

### Task 7: Docs — DEVELOPMENT.md + Turkish manuals

**Files:**
- Modify: `docs/DEVELOPMENT.md` (~lines 175–183, Billing section)
- Modify: `docs/manuals/tr/kiraci-kilavuzu.md` (§2.5 intro + §11 "Faturalandırma & Krediler")
- Modify: `docs/manuals/tr/super-admin-kilavuzu.md` (grant-credits + health-page passages)

**Interfaces:** none — prose only. Do NOT regenerate the PDFs (`make-pdf` was a separate workflow; the user regenerates when they want).

- [ ] **Step 1: DEVELOPMENT.md**

Replace the two Stripe sentences in the Billing section ("Tenants top up by buying credit packs via Stripe Checkout (`STRIPE_CREDIT_PACK_PRICE_IDS`); the `/api/stripe/webhook` route grants credits on a completed purchase.") with:

```
Tenants cannot buy credits in-app: the operator invoices customers manually and
grants (or deducts) credits from the super-admin customer page.
```

Also update the test-suite count sentence in the Testing section if the suite/test numbers it quotes changed (run `npm test` and copy the real numbers).

- [ ] **Step 2: Tenant manual (kiraci-kilavuzu.md)**

- §11 (line ~990 onward): rewrite the section to describe the new page — header "Billing / Manage your prepaid credit balance.", a **Credits** section stating credits are added by the Maratus team ("Kredileri Maratus ekibi tanımlar; bakiye eklemek için bizimle iletişime geçin" tone, quoting the English UI copy `Credits are added to your account by the Maratus team.`), then the existing "Credit usage this month" and "Device usage this month" descriptions (these are unchanged in the UI — keep their text). Delete entirely: the "kredi satın alma bölümü hiç görünmeyebilir" callout, every "Buy {n} credits" / Stripe / kredi paketi passage, and any role note that says owners/admins can purchase (roles no longer differ on this page).
- §2.5: the prepaid-credit explanation stays, but if it mentions in-app purchase, reword to manual top-up by the operator.
- Sweep: `grep -in "stripe\|satın al" docs/manuals/tr/kiraci-kilavuzu.md` → no Stripe/purchase-flow references remain (mentions of the operator selling credits offline are fine).

- [ ] **Step 3: Super-admin manual (super-admin-kilavuzu.md)**

- Find the credits/grant section (`grep -in "kredi" docs/manuals/tr/super-admin-kilavuzu.md`): document the new form — Direction (Add/Deduct) radio, amount, note, "Apply" button; deduction fails when the amount exceeds the available balance; ledger shows `adjust` rows with negative amounts; audit records "Credits deducted".
- Find the health-page section (`grep -in "Payments\|Stripe" docs/manuals/tr/super-admin-kilavuzu.md`): remove the Payments-row description (the card now shows only transactional email).

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: manual credits story in DEVELOPMENT.md and Turkish manuals"
```

---

### Task 8: Final gates + merge/deploy runbook

**Files:** none new.

- [ ] **Step 1: Full verification**

```bash
npm test && npx tsc --noEmit && npm run build
grep -rin "stripe" app lib components --include="*.ts" --include="*.tsx"   # expect only lib/audit.ts actor
grep -rn "syncDeviceSubscription\|creditPacks\|BuyCreditsSection" app lib components  # expect empty
```

- [ ] **Step 2: Merge to main** (via superpowers:finishing-a-development-branch — user reviews first per their batch-deploy preference)

- [ ] **Step 3: Deploy, THEN migrate — order matters**

```bash
vercel --prod --yes          # new code stops querying the Stripe columns
npm run db:migrate           # now drop the columns on Neon (against PROD .env.local)
```

- [ ] **Step 4: Operator follow-up (not code)**

Remove `STRIPE_*` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` env vars from the Vercel project and from `.env.local`.
