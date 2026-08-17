# Subscription Billing Cutover Runbook

This is the operator checklist for taking the `feat/subscription-billing`
branch live: applying its migration, backfilling existing data, deploying,
verifying, and — later, separately — removing the credit system it replaces.
It also covers the `feat/device-slots` follow-up branch built on top of it
(§5), which separates the paid entitlement from the device occupying it.

`.env.local` in this repo points at the **production** Neon database. Every
command below that touches the database is a production write. Do not run any
step out of order, and stop if a step misbehaves rather than pushing through
to the next one.

Background: `.superpowers/sdd/2026-08-15-subscription-billing/task-16-brief.md`
describes the full plan this runbook is drawn from. Its cutover steps become
§1–4 below (migrate, backfill, deploy, verify); its clean-up steps become §6,
the destructive follow-up, which is deliberately deferred to a later sitting.
§5, the device-slot cutover, is a separate later branch (plan:
`docs/superpowers/plans/2026-08-16-device-slots.md`) slotted in before that
deferred clean-up because it is additive and unrelated to it. The additive
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
- Aligns `includedTriggersPerDevice` on **existing** rows to 1000. Migration
  0042 changes the column *default* from 2000 to 1000, but a default only
  applies to rows inserted after it — every pre-existing tenant would otherwise
  keep 2000 and silently get double the quota the model specifies. This was
  caught in production during the first cutover, where the one existing org was
  still on 2000 after the migration.
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

Confirm all four of these hold on production. **Do not start §6 (the
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

## 5. Device-slot cutover (`feat/device-slots`) — ✅ DONE 2026-08-17

Ran against production on 2026-08-17: migration 0043 applied, the backfill
seeded the single org with 1 slot, `79674b7` deployed
(`ditto-admin-9yrwg2t0q`). §5.4's first check passed
(`paidDeviceSlots: 1, freeSlots: 0, includedTotal: 1000`); its second (marking
a serial `rma` to watch a slot free) was **skipped** — the only live device is
the real b580 and there is no un-RMA action. §5.5's cohort query returned no
rows, so there was nothing to release. Kept below for the record.

This section takes the `feat/device-slots` branch live: applying its
migration, backfilling the entitlement, deploying, and verifying. It is
additive — like §1–4, it is safe to run against a database the currently
deployed (pre-cutover) code is still reading from — so it does not need to
wait for §6 (the deferred destructive follow-up) below; run it whenever this
branch is ready. Migration numbering: this branch claimed **0043** for
`paid_device_slots`, so the credit-teardown migration in §6 has been renumbered
to **0044** — do not generate a `0043` migration for that work, it would
collide with what §5.1 already applied.

### 5.1. Apply migration 0043

```bash
npm run db:migrate
```

Migration 0043 is additive only — it adds `tenant_settings.paid_device_slots`
(`integer`, default `0`, not null). It does not drop or rename anything, so
it is safe to run before the new code deploys.

### 5.2. Run the backfill

```bash
npx tsx lib/db/backfill-device-slots.ts
```

**This step is not optional.** Migration 0043 adds `paid_device_slots` with a
default of `0` — every existing org reads 0 slots until this script runs,
which zeroes quotas and causes replacement-device activations to be refused.
Deploy the new code (§5.3) before this script has run and the entire fleet
loses its quota the moment the new code starts reading the column.

The script (`lib/db/backfill-device-slots.ts`) seeds each org's entitlement
from what it currently occupies: `paidDeviceSlots = count(devices with
subscriptionPaidAt set)`. It is idempotent **only up to the deploy** — it
recomputes from live device occupancy, so run it before §5.3 and not again
after. A slot deliberately becomes independent of occupancy the moment the
new code is live (invoice payments move it; RMA/removal does not shrink it),
and a post-deploy re-run would clobber that by recomputing from occupancy
again, silently confiscating slots the org already paid for.

### 5.3. Deploy the application

```bash
vercel --prod --yes
```

### 5.4. Verify

1. A tenant's `/tenant/billing` page shows the expected slot count (`N of M
   slots in use`, with a free-slot callout if any are vacant).
2. On a test serial, mark it `rma` in `/admin/inventory` and confirm that
   device's paid status clears and the org's free-slot count on its billing
   page goes up by one.

If either fails, treat it as a stop — do not proceed to §6 while the slot
figures on the billing pages are wrong.

### 5.5. Release slots for serials ALREADY at `rma` or `retired`

**Do this once, right after the deploy.** Before this branch, marking a serial
`rma` or `retired` had no billing effect at all — the device kept
`subscriptionPaidAt` set forever. So the §5.2 backfill, which seeds
`paidDeviceSlots` from devices with `subscriptionPaidAt` set, hands each of
those dead units a slot of its own. The customer is entitled to that slot
(they paid for it), but it is occupied by hardware that no longer exists, so a
replacement cannot claim into it and the whole point of the branch misses for
exactly the customers who already had an RMA or a pre-cutover offboard.

**These two cohorts need different treatment. Do not run the same action on
both — the `retired` case is destructive if you do.**

- **`rma` rows** — use the admin UI's **Re-mark as RMA**. Safe and idempotent:
  the row was already `rma` before this branch, so re-marking only performs
  the (new) slot-release side effect; it doesn't change what the row records.
- **`retired` rows** — **never click Mark/Re-mark as RMA on one of these.**
  `retired` records that the device was left with the customer during
  offboarding (`retireDeviceWithCustomer`, `lib/factory-registry.ts`) — a
  distinct disposition from RMA, and every pre-cutover "left with customer"
  device in the fleet still has `subscription_paid_at` set, so this cohort is
  real, not hypothetical. Clicking the action rewrites `factory_device.status`
  from `retired` to `rma`, which (a) permanently destroys the "left with
  customer" record on that row, and (b) moves the row outside
  `restoreCustomerAction`'s filter (`eq(factoryDevice.status, "retired")` in
  `lib/actions/offboarding.ts`) — the exact filter that exists so an
  offboard-then-restore doesn't strand a device unbillable forever. Release
  these slots with a direct `UPDATE` below instead, which touches only
  `device` and never rewrites `factory_device.status`.

Find the `rma` cohort:

```sql
SELECT fd.serial, fd.status, d.id AS device_id, d.organization_id
FROM factory_device fd
JOIN device d ON d.id = fd.device_id
WHERE fd.status = 'rma'
  AND d.subscription_paid_at IS NOT NULL;
```

For each row, open `/admin/inventory`, filter to `rma`, and use **Re-mark as
RMA…** on the serial (the row action is offered on rows already at `rma`
precisely for this). Re-marking is what releases the slot: the status write is
idempotent, and the release + slot-fill side effect runs on every call. The
confirmation dialog spells out the consequence, and each one writes an audit
row against the customer.

Find the `retired` cohort:

```sql
SELECT fd.serial, fd.status, d.id AS device_id, d.organization_id
FROM factory_device fd
JOIN device d ON d.id = fd.device_id
WHERE fd.status = 'retired'
  AND d.subscription_paid_at IS NOT NULL;
```

For these, release the slot directly — do **not** open `/admin/inventory` for
them:

```sql
UPDATE device
SET subscription_paid_at = NULL
WHERE id IN (/* device_id values from the SELECT above */);
```

This writes exactly what `setRegistryStatus` would have written to `device` —
`subscription_paid_at = NULL` — without touching `factory_device.status` at
all, so the `retired` disposition (and `restoreCustomerAction`'s ability to
find and un-retire the row later) survives intact. Two things this raw
`UPDATE` does **not** do, unlike the UI path: it writes no audit row, and it
does not run `fillFreeSlots` to immediately hand the freed slot to an
already-claimed, unpaid replacement device on the same org — that vacancy is
picked up automatically the next time that org has a claim or a payment run
through `lib/invoices.ts`. If a replacement device is already claimed and
sitting on an open proration invoice and you want it resolved immediately
rather than waiting, mark that invoice paid (or trigger any other
`fillFreeSlots` call for the org) after running the `UPDATE`.

Afterwards re-run both `SELECT`s above: each must return no rows. Every
release frees a slot that the org keeps, so the customer's replacement device
activates for free the moment it claims — and for the `rma` cohort, if the
replacement is already claimed and carrying a proration invoice, releasing the
old serial voids that invoice and activates it on the spot.

Do **not** re-run `backfill-device-slots.ts` after any of this (see §5.2): it
recomputes from live occupancy and would confiscate exactly the slots this
step just freed.

---

## 6. The destructive follow-up — ✅ DONE 2026-08-17

Ran on 2026-08-17, right after §5. Migration `0044_rainy_whirlwind.sql` came
out of `db:generate` as exactly the five statements below with no snapshot
drift, so nothing had to be stripped. Kept for the record; nothing here is
outstanding.

It removed the credit system entirely.

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
   Open the new `drizzle/0044_*.sql`. This repo has a known drizzle-kit
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
   git commit -m "feat(db): drop credit tables and billing_plan (migration 0044)"
   ```
6. **Apply and deploy:**
   ```bash
   npm run db:migrate
   vercel --prod --yes
   ```

## 7. Known-inert until you act on them

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
