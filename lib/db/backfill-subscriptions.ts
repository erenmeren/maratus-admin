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

  // 3. Carry prepaid balances over as legacy credits (only for newly subscribed orgs).
  // This is safe idempotent: step 1 returns only orgs with null subscriptionStartedAt
  // (a field with no legitimate reset path), so step 3 never touches the same org twice.
  const balances = await db
    .select({ organizationId: creditBalance.organizationId, available: creditBalance.available })
    .from(creditBalance);
  const balanceMap = new Map(balances.map(b => [b.organizationId, b.available]));

  let credited = 0;
  for (const org of orgs) {
    const available = balanceMap.get(org.organizationId);
    if (available == null || available <= 0) continue;
    const updated = await db
      .update(tenantSettings)
      .set({ legacyCreditsRemaining: available, updatedAt: new Date() })
      .where(eq(tenantSettings.organizationId, org.organizationId))
      .returning({ organizationId: tenantSettings.organizationId });
    if (updated.length > 0) credited += 1;
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
