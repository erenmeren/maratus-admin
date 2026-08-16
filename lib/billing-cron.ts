// Daily billing sweep. Three jobs, all idempotent:
//   1. close every finished period per org and invoice its overage
//   2. issue renewal invoices 30 days ahead so there is time to transfer
//   3. surface overdue invoices and fair-use abuse as `alert` rows
//
// Idempotency is the (organizationId, kind, periodStart) unique index, not a
// cursor — a second run the same day conflicts and does nothing. That is also
// what makes it safe to re-offer the whole backlog of unclosed periods
// (periodsToClose) rather than only the most recent one.
//
// Every per-org body is wrapped in try/catch: one org with bad data must not
// stop the sweep, or everything after it goes unbilled that day.

import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { invoice, organization, tenantSettings } from "./db/schema";
import {
  addMonthsAnchored,
  MONTHS_PER_YEAR,
  periodIndexFor,
} from "./billing-period";
import { FAIR_USE_TRIGGERS_PER_DEVICE_MONTH } from "./invoicing";
import {
  countAckedTriggers,
  countPaidDevices,
  issueOverageInvoice,
  issueSubscriptionInvoice,
} from "./invoices";
import { BILLING_ALERT_PREFIX, isBillingAlertKey } from "./alerts";
import { persistAlertScope } from "./alerts-sync";
import type { HealthAlert } from "./health";

const RENEWAL_LEAD_DAYS = 30;

/**
 * How many closed periods a single sweep will reach back for. Bounds the work
 * an org with a badly backdated anchor can create, while still covering a full
 * year plus a month of cron downtime.
 */
export const MAX_PERIOD_LOOKBACK = 13;

/**
 * Every period index that has CLOSED and therefore needs an overage invoice,
 * oldest first. Period `i` spans [anchor+i months, anchor+i+1 months); the
 * period containing `now` is still accumulating and is never returned.
 *
 * Closing only `index - 1` silently loses every period the cron was down
 * across — and the cutover runbook explicitly tells the operator to backdate
 * `subscriptionStartedAt` from the admin panel, which manufactures exactly
 * that gap. issueOverageInvoice's unique-index conflict makes re-issuing an
 * already-invoiced period a no-op, so returning the whole backlog is safe.
 *
 * Pure: no DB, no clock of its own.
 */
export function periodsToClose(
  anchor: Date,
  now: Date,
  maxLookback: number = MAX_PERIOD_LOOKBACK,
): number[] {
  const index = periodIndexFor(anchor, now);
  if (index < 1) return []; // still inside the first period — nothing closed
  const first = Math.max(0, index - Math.max(0, maxLookback));
  const out: number[] = [];
  for (let i = first; i < index; i += 1) out.push(i);
  return out;
}

export interface FairUseBreach {
  deviceId: string;
  triggers: number;
}

export interface OverdueInvoice {
  invoiceId: string;
  orgName: string;
  kind: string;
  amountUsdCents: number;
  dueAt: Date;
}

/**
 * The alert set the billing sweep owns, as `alert` rows (spec §3 and §4 job 3:
 * the fair-use ceiling is an abuse valve enforced by this sweep, not by the
 * request path, and every open past-due invoice must surface as an alert).
 * A console.warn is not an alert — nobody reads Vercel logs daily.
 *
 * Pure so the message/key shape is testable. Keys are billing-namespaced so
 * the health sweep never resolves them (see isBillingAlertKey).
 */
export function buildBillingAlerts(a: {
  fairUse: FairUseBreach[];
  overdue: OverdueInvoice[];
}): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  for (const b of a.fairUse) {
    alerts.push({
      key: `${BILLING_ALERT_PREFIX}fair-use:${b.deviceId}`,
      severity: "warning",
      message: `Device ${b.deviceId} made ${b.triggers.toLocaleString("en-US")} triggers in 30 days (fair-use ceiling ${FAIR_USE_TRIGGERS_PER_DEVICE_MONTH.toLocaleString("en-US")}) — consider suspending it`,
    });
  }
  for (const o of a.overdue) {
    alerts.push({
      key: `${BILLING_ALERT_PREFIX}invoice-overdue:${o.invoiceId}`,
      severity: "warning",
      message: `${o.orgName}: ${o.kind} invoice of $${(o.amountUsdCents / 100).toFixed(2)} overdue since ${o.dueAt.toISOString().slice(0, 10)}`,
    });
  }
  return alerts;
}

export async function runBillingCron(now: Date = new Date()): Promise<{
  overageIssued: number;
  renewalsIssued: number;
  orgsFailed: number;
  overdue: number;
  fairUseAlerts: number;
  alertsOpened: number;
  alertsResolved: number;
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
      paidDeviceSlots: tenantSettings.paidDeviceSlots,
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
  let orgsFailed = 0;

  for (const org of orgs) {
    // One org with bad data must not take the rest of the fleet down with it:
    // without this, everything after the thrower goes unbilled that day, and
    // (before periodsToClose) permanently, since only one period was ever
    // closed. Log and carry on.
    try {
      const anchor = org.startedAt as Date;

      // 1. Close every period that has finished — the current one is still
      //    accumulating. Normally that is exactly one; after cron downtime or
      //    an operator backdating the anchor it is several, and each still
      //    owes an invoice. Already-invoiced periods conflict and are no-ops.
      let legacyCredits = org.legacyCredits ?? 0;
      for (const index of periodsToClose(anchor, now)) {
        const closedStart = addMonthsAnchored(anchor, index);
        const closedEnd = addMonthsAnchored(anchor, index + 1);
        const used = await countAckedTriggers({
          organizationId: org.organizationId,
          from: closedStart,
          to: closedEnd,
        });
        const issued = await issueOverageInvoice({
          organizationId: org.organizationId,
          periodStart: closedStart,
          periodEnd: closedEnd,
          used,
          includedPerDevice: org.included,
          // Quota is pooled from paid SLOTS, not a live device count — an
          // RMA'd device frees its slot without shrinking the entitlement.
          slotCount: org.paidDeviceSlots,
          overagePriceCents: org.overagePrice,
          // legacyCreditsRemaining is nullable: null means the cutover backfill
          // has not run for this org yet, which means zero credits, not "skip".
          // Zeroed locally after the first issued invoice of this sweep because
          // issueOverageInvoice burns them in the DB (spec §5: first invoice
          // only) and `org` is a snapshot taken before that write.
          legacyCredits,
          issuedAt: now,
        });
        if (issued) {
          overageIssued += 1;
          legacyCredits = 0;
        }
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
            periodEnd: addMonthsAnchored(org.renewsAt, MONTHS_PER_YEAR),
            issuedAt: now,
          });
          if (issued) renewalsIssued += 1;
        }
      }
    } catch (err) {
      orgsFailed += 1;
      console.error("[billing] org sweep failed", {
        organizationId: org.organizationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Overdue invoices and 4. the fair-use abuse valve, both as `alert` rows.
  //    Neither blocks anything: the operator reads the alert and acts (chases
  //    the transfer, suspends the runaway device). Persisting them through the
  //    shared alert lifecycle means they resolve themselves once the invoice
  //    is paid or the device calms down.
  const overdue = await findOverdueInvoices(now);
  const fairUse = await findFairUseBreaches(now);

  let alertsOpened = 0;
  let alertsResolved = 0;
  try {
    const diff = await persistAlertScope(
      buildBillingAlerts({ fairUse, overdue }),
      isBillingAlertKey,
      now,
    );
    alertsOpened = diff.toOpen.length;
    alertsResolved = diff.toResolve.length;
  } catch (err) {
    // Alerts are a report; an alert-write failure must not lose the invoicing
    // work this sweep already committed.
    console.error("[billing] alert sync failed", err);
  }

  return {
    overageIssued,
    renewalsIssued,
    orgsFailed,
    overdue: overdue.length,
    fairUseAlerts: fairUse.length,
    alertsOpened,
    alertsResolved,
  };
}

/** Open invoices past their due date. "Overdue" is derived, never stored. */
async function findOverdueInvoices(now: Date): Promise<OverdueInvoice[]> {
  const rows = await db
    .select({
      invoiceId: invoice.id,
      orgName: organization.name,
      kind: invoice.kind,
      amountUsdCents: invoice.amountUsdCents,
      dueAt: invoice.dueAt,
    })
    .from(invoice)
    .leftJoin(organization, eq(organization.id, invoice.organizationId))
    .where(and(eq(invoice.status, "open"), lt(invoice.dueAt, now)));
  return rows.map((r) => ({
    invoiceId: r.invoiceId,
    orgName: r.orgName ?? "Unknown customer",
    kind: r.kind,
    amountUsdCents: r.amountUsdCents,
    dueAt: r.dueAt,
  }));
}

/**
 * Devices past the fair-use ceiling in the trailing 30 days. Alerted rather
 * than blocked; the operator suspends the device from the admin panel.
 */
async function findFairUseBreaches(now: Date): Promise<FairUseBreach[]> {
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
  return result.rows.map((r) => ({
    deviceId: r.device_id,
    triggers: Number(r.c),
  }));
}
