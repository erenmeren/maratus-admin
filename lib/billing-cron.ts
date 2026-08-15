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
  // Archived orgs are excluded here — countPaidDevices does not filter
  // archivedAt itself, so this is the only thing keeping an offboarded
  // customer's devices from contributing quota or generating invoices.
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
        // legacyCreditsRemaining is nullable: null means the cutover backfill
        // has not run for this org yet, which means zero credits, not "skip".
        legacyCredits: org.legacyCredits ?? 0,
        issuedAt: now,
      });
      if (issued) overageIssued += 1;
    }

    // 2. Renewal, 30 days ahead. The unique index on (org, kind="subscription",
    //    periodStart=renewsAt) is what stops every day in that 30-day lead
    //    window from re-issuing it — the insert conflicts and returns null
    //    on every run after the first.
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
  // A raw JS Date param is serialized as local wall-clock by neon-http
  // (parseInputDatesAsUTC=false), which would skew the window off UTC —
  // cast through an ISO string, matching the convention in lib/data.ts.
  const result = await db.execute<{ device_id: string; c: number }>(sql`
    select device_id, count(*)::int as c
    from device_command
    where type = 'trigger' and status = 'acked'
      and created_at >= ${from.toISOString()}::timestamp
    group by device_id
    having count(*) > ${FAIR_USE_TRIGGERS_PER_DEVICE_MONTH}
  `);
  for (const r of result.rows) {
    console.warn("[billing] fair-use ceiling exceeded", {
      deviceId: r.device_id,
      triggers: r.c,
    });
  }
  return result.rows.length;
}
