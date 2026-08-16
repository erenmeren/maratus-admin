// One-shot backfill for the device-slots migration (0043).
// MUST run right after 0043 and BEFORE the new code deploys: until it runs
// every org reads 0 slots, which zeroes quotas and refuses replacement
// activations.
//
// Seeds each org's entitlement from what it currently occupies:
//   paidDeviceSlots = count(devices with subscriptionPaidAt set)
//
// DO NOT re-run this after the deploy. It recomputes purely from live device
// occupancy, so a later run would clobber an entitlement that has since
// become independent of occupancy by design — invoice payments move it
// (lib/invoices.ts markInvoicePaid), and RMA/device removal deliberately does
// not shrink it. Re-running post-deploy would silently confiscate slots the
// org already paid for.
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
