# Subscription Billing Cutover Runbook

This is the operator checklist for taking the `feat/subscription-billing`
branch live: applying its migration, backfilling existing data, deploying,
verifying, and — later, separately — removing the credit system it replaces.

`.env.local` in this repo points at the **production** Neon database. Every
command below that touches the database is a production write. Do not run any
step out of order, and stop if a step misbehaves rather than pushing through
to the next one.

Background: `.superpowers/sdd/2026-08-15-subscription-billing/task-16-brief.md`
describes the full plan this runbook is drawn from. Its cutover steps become
§1–4 below (migrate, backfill, deploy, verify); its clean-up steps become §5,
the destructive follow-up, which is deliberately deferred to a later sitting.
The additive
migration file (`drizzle/0042_magical_korg.sql`) and every code change it
depends on — the subscription gate, the new `tenantSettings`/`device`
columns, the `invoice` table, the admin/tenant billing pages — are already
committed on this branch; nothing needs to be written before running the
steps below. `CLAUDE.md` has already been updated to describe the model as
built.

---

## 1. Apply migration 0042

```bash
npm run db:migrate
```

Migration 0042 is additive only — new nullable columns and the `invoice`
table. It does not drop or rename anything, so it is safe to run against a
database the running (pre-cutover) application code is still reading from.

## 2. Run the backfill

```bash
npx tsx lib/db/backfill-subscriptions.ts
```

**This step is not optional.** The new trigger route
(`app/api/v1/devices/[deviceId]/trigger/route.ts`) checks
`device.subscriptionPaidAt` before it will publish a command: null means the
device gets a 50-trigger lifetime trial and then a hard `403
device_not_subscribed`. Migration 0042 adds that column with no default, so
every existing device is null until this script runs. Deploy the new code
(step 3) before this script has run and the entire fleet goes dark the moment
triggers exceed the trial allowance.

What it does (`lib/db/backfill-subscriptions.ts`):
- Marks every non-archived org subscribed as of *now* (`subscriptionStartedAt`
  / `subscriptionRenewsAt`, 12 months out).
- Marks every claimed device paid as of *now* (`subscriptionPaidAt`).
- Carries over any existing prepaid credit balance
  (`creditBalance.available`) into `tenantSettings.legacyCreditsRemaining`, so
  it still offsets future overage invoices instead of being forfeited.

Everyone is deliberately marked paid **as of the run date**, not their real
historical subscription date — failing safe (nobody gets locked out) is the
point. Correct the real dates afterward from the admin panel, org by org.

It carries over `creditBalance.available` only. Any credits currently **held**
(reserved against an in-flight trigger, `creditBalance.held`) are dropped
silently — there is no reservation concept in the subscription model, so a
handful of credits per org can be lost here. That is accepted; if it matters
for a particular customer, read their `creditBalance.held` before running this
and add the amount to `legacyCreditsRemaining` by hand afterwards.

It is idempotent: it only touches rows where the relevant column is still
null (`isNull(subscriptionStartedAt)`, `isNull(subscriptionPaidAt)`,
`isNull(legacyCreditsRemaining)`), so re-running it after a partial failure,
or by mistake, does not re-stamp already-backfilled rows or double-count
credit balances.

Read the printed summary line (`backfill complete: N orgs subscribed, N
devices marked paid, N credit balances carried over`) and sanity-check the
counts against what you expect for the fleet before moving on.

## 3. Deploy the application

**First confirm `CRON_SECRET` is set in the Vercel project** (Settings →
Environment Variables, Production):

```bash
vercel env ls production | grep CRON_SECRET
```

`vercel.json` repoints the daily cron slot from `/api/cron/credit-holds` to
`/api/cron/billing`, and that route returns **503 without ever running** when
`CRON_SECRET` is unset. Nothing about that is loud: the cron reports a
non-200, no invoice is ever issued, no period is ever closed, and the first
symptom is a customer who has been running unbilled for months. If it is
missing, set it (`openssl rand -base64 32`) before deploying.

Then:

```bash
vercel --prod --yes
```

## 4. Verify before touching anything else

Confirm all four of these hold on production. **Do not start step 5 (the
destructive follow-up) until they do:**

1. A real device still triggers successfully.
2. `/admin/billing` and a customer detail page render.
3. `/tenant/billing` renders for a real tenant.
4. **End-to-end money path:** on a *test* org, click **Start subscription** on
   `/admin/customers/[tenantId]`, then **Mark paid** on the invoice it issues.
   Confirm afterwards that the org's Subscription card shows Active with a
   renewal date twelve months out, and that the org's claimed devices now
   count as paid devices. This is the one path with no automated coverage —
   it is where the activation and period-anchoring logic lives — so it must be
   exercised by hand once against production before real customers ride it.
   (Void the invoice instead of marking it paid if you only want to check that
   issuing works.)

If any of these fail, treat it as a stop — do not proceed to schema changes
while the fleet or the billing UI is in a broken state.

---

## 5. Deferred: the destructive follow-up

Do this later, once step 4 has held for long enough that you're confident the
cutover is solid — not in the same sitting as steps 1–4. It removes the
credit system entirely, so it should not be rushed.

1. **Edit `lib/db/schema.ts`.** Delete `tenantSettings.billingPlan`,
   `deviceCommand.billing`, and the `creditBalance`, `creditLedger`, and
   `deviceUsageMonth` table definitions. Also remove `creditBalance` and
   `creditLedger` from the flat `schema` export object at the bottom of the
   file — `deviceUsageMonth` was never in it. Nothing needs to change in
   `lib/db/relations.ts`: none of these three tables has a relation defined
   there.
2. **Delete `lib/db/backfill-subscriptions.ts`.** It has done its job by now,
   and it imports `creditBalance` from the schema — leaving it in place would
   break the build the moment that table definition is gone.
3. **Edit `lib/audit.ts`.** Drop the now-unreachable write-side constants
   `creditsGranted` / `creditsDeducted` / `creditsPurchased` from the `AUDIT`
   object (nothing can write those audit-log rows anymore once credits are
   gone). **Do not touch `lib/audit-labels.ts`** — leave the
   `"credits.granted"` / `"credits.deducted"` / `"credits.purchased"` label
   entries there. The audit log is append-only; historical rows with those
   actions still exist and still need a label to render.
4. **Generate the migration:**
   ```bash
   npm run db:generate
   ```
   Open the new `drizzle/0043_*.sql`. This repo has a known drizzle-kit
   snapshot-drift issue (see the `drizzle-snapshot-drift` memory) where
   `db:generate` can emit spurious churn unrelated to your actual change —
   **strip the file down to exactly three `DROP TABLE` statements
   (`credit_balance`, `credit_ledger`, `device_usage_month`) and two
   `ALTER TABLE ... DROP COLUMN` statements (`tenant_settings.billing_plan`,
   `device_command.billing`).** Nothing else should be in the file.
5. **Typecheck, build, commit:**
   ```bash
   npx tsc --noEmit && npm test && npm run build
   git add -A
   git commit -m "feat(db): drop credit tables and billing_plan (migration 0043)"
   ```
6. **Apply and deploy:**
   ```bash
   npm run db:migrate
   vercel --prod --yes
   ```

## 6. Known-inert until you act on them

- **Invoice email does not reach customers.** Resend has no verified sending
  domain on this project (see `docs/runbooks/phase-0-activation.md` §2 for the
  current status) — mail only delivers to the account owner's own address.
  Until a domain is verified, the tenant billing page
  (`/tenant/billing`, listing issued invoices) is the real delivery channel;
  tell customers to check there, or notify them out of band.
- **`lib/bank-details.ts` still has `TODO:` placeholders** for the company
  legal name, bank name, and IBAN shown on the tenant billing page. Fill these
  in with real values before pointing any customer at that page — right now
  it would show literal `"TODO: company legal name"` etc. to a paying
  customer.
