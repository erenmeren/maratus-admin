// Persistence for bank-transfer invoices. All amount arithmetic comes from
// lib/invoicing.ts; this file only reads counts and writes rows.
//
// Every issue* function is idempotent: the (organizationId, kind, periodStart)
// unique index turns a duplicate into a no-op, which is what lets the daily
// cron run more than once over the same period safely.

import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import { db } from "./db";
import { device, deviceCommand, invoice, tenantSettings } from "./db/schema";
import { id } from "./ids";
import {
  addMonthsAnchored,
  MONTHS_PER_YEAR,
  periodEndFor,
  periodStartFor,
  renewalDueAt,
} from "./billing-period";
import {
  DEFAULT_PRICE_PER_DEVICE_CENTS,
  dueAtFrom,
  monthsRemainingUntil,
  overageFor,
  prorationAmountCents,
  prorationMonths as clampProrationMonths,
  subscriptionAmountCents,
} from "./invoicing";

/**
 * `prorationMonths` with a log when the clamp fires. A zero-month proration
 * means the device was claimed at or after the org's renewal instant; that is
 * a legitimate state (an unpaid renewal is never cut off) but worth seeing,
 * because the device is being billed a full month for a year that is over.
 */
export function prorationMonths(
  monthsRemaining: number,
  ctx: { deviceId: string; organizationId: string },
): number {
  const months = clampProrationMonths(monthsRemaining);
  if (months !== monthsRemaining) {
    console.warn("proration months clamped to a minimum of one", {
      ...ctx,
      monthsRemaining,
      billedMonths: months,
    });
  }
  return months;
}

export type InvoiceRow = typeof invoice.$inferSelect;

/**
 * "Overdue" is derived, never stored: an open invoice past its due date.
 * This is a billing rule, so it has exactly one definition — every call site
 * (the admin/tenant invoice table, the subscription card, the tenant billing
 * page, the cron's overdue sweep) routes through here.
 */
export function isInvoiceOverdue(
  inv: { status: InvoiceRow["status"]; dueAt: Date },
  now: Date,
): boolean {
  return inv.status === "open" && inv.dueAt < now;
}

export type VoidEligibility = { ok: true } | { ok: false; reason: string };

/**
 * Whether an open invoice is safe to void.
 *
 * Voiding is NOT a neutral "cancel". The (organizationId, kind, periodStart)
 * unique index has no status predicate, so a void row keeps occupying its slot
 * forever — every later attempt to issue that same slot conflicts and silently
 * does nothing. Whether that matters depends entirely on whether anything can
 * ever legitimately re-issue the slot:
 *
 * - `subscription` on an org that is NOT yet subscribed — the only issuer is
 *   startSubscriptionAction, whose periodStart is today's UTC day. Voiding
 *   costs the operator a day (tomorrow is a fresh slot), nothing more. SAFE.
 * - `subscription` on an ALREADY-subscribed org — that is a cron renewal, and
 *   its periodStart is `subscriptionRenewsAt`, which only advances when a
 *   renewal is PAID. Void it and the daily sweep re-attempts the identical
 *   slot every day, conflicts every time, and the customer runs a full year
 *   with paid devices and no invoice at all — silently. NOT SAFE.
 * - `proration` — the device is re-prorated the next time a subscription
 *   invoice is paid; issueProrationsForUnpaidDevices deliberately ignores
 *   void prorations, which makes voiding the re-issue gesture. SAFE.
 * - `overage` — its periodStart is a closed, anchor-derived period that never
 *   comes round again, and issuance already burned the org's legacy credits.
 *   Void it and that period's usage is never billed and the credits are gone.
 *   NOT SAFE.
 *
 * Pure, so the rule has exactly one definition: the invoice table renders on
 * it and voidInvoiceAction enforces it.
 */
export function canVoidInvoice(a: {
  kind: InvoiceRow["kind"];
  isSubscribed: boolean;
}): VoidEligibility {
  if (a.kind === "proration") return { ok: true };
  if (a.kind === "subscription") {
    return a.isSubscribed
      ? {
          ok: false,
          reason:
            "A renewal invoice can't be voided: the renewal date only moves when the invoice is paid, so nothing would ever re-issue it and this customer would run a full year unbilled. Correct the amount off-system and mark it paid when the transfer lands.",
        }
      : { ok: true };
  }
  return {
    ok: false,
    reason:
      "An overage invoice can't be voided: its billing period is closed and is never invoiced again, and any prepaid credits it applied were already spent when it was issued.",
  };
}

/**
 * What voiding actually does, per kind — the dialog's confirmation copy.
 * Only kinds canVoidInvoice allows are reachable here; `overage` is included
 * for exhaustiveness rather than because it can be shown.
 */
export function voidConsequence(kind: InvoiceRow["kind"]): string {
  if (kind === "proration") {
    return "The device stays unpaid and contributes no quota. It is pro-rated again the next time a subscription invoice is paid for this customer.";
  }
  if (kind === "subscription") {
    return "The customer stays unsubscribed and no device is activated. You can start the subscription again to issue a fresh invoice — from tomorrow (UTC) at the earliest, because today's slot stays taken by the voided one.";
  }
  return "The invoice stops being owed. It is not issued again.";
}

/** Paid, non-archived devices — the only ones that contribute pooled quota. */
export async function countPaidDevices(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(device)
    .where(
      and(
        eq(device.organizationId, organizationId),
        isNotNull(device.subscriptionPaidAt),
      ),
    );
  return Number(row?.c ?? 0);
}

/**
 * Acked triggers in [from, to). `acked` because a trigger that never reached a
 * screen is not billed; `createdAt` because that is what the composite index
 * (organization_id, type, status, created_at) covers — ackedAt differs by
 * seconds, which is immaterial at a period boundary.
 */
export async function countAckedTriggers(a: {
  organizationId: string;
  from: Date;
  to: Date;
}): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(deviceCommand)
    .where(
      and(
        eq(deviceCommand.organizationId, a.organizationId),
        eq(deviceCommand.type, "trigger"),
        eq(deviceCommand.status, "acked"),
        gte(deviceCommand.createdAt, a.from),
        lt(deviceCommand.createdAt, a.to),
      ),
    );
  return Number(row?.c ?? 0);
}

export async function issueSubscriptionInvoice(a: {
  organizationId: string;
  deviceCount: number;
  pricePerDeviceCents: number;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  note?: string;
}): Promise<{ id: string } | null> {
  const amountUsdCents = subscriptionAmountCents(a.deviceCount, a.pricePerDeviceCents);
  // A zero-amount subscription invoice is a dead end, so never write one. It
  // cannot be marked paid (the action requires a positive TRY amount) and it
  // cannot be voided (voiding a renewal would burn its renewsAt slot forever),
  // yet it ages into overdue, raises a billing alert and reddens the tenant's
  // badge. Reachable whenever an org is subscribed with no paid devices at its
  // anniversary — every device deleted, or an org the cutover backfill
  // subscribed despite it having no claimed hardware.
  if (amountUsdCents <= 0) {
    console.warn("[billing] skipped a zero-amount subscription invoice", {
      organizationId: a.organizationId,
      deviceCount: a.deviceCount,
      periodStart: a.periodStart.toISOString(),
    });
    return null;
  }

  const rows = await db
    .insert(invoice)
    .values({
      id: id("inv"),
      organizationId: a.organizationId,
      kind: "subscription",
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      deviceCount: a.deviceCount,
      amountUsdCents,
      status: "open",
      issuedAt: a.issuedAt,
      dueAt: dueAtFrom(a.issuedAt),
      note: a.note,
    })
    .onConflictDoNothing()
    .returning({ id: invoice.id });
  return rows[0] ?? null;
}

export async function issueProrationInvoice(a: {
  organizationId: string;
  deviceId: string;
  pricePerDeviceCents: number;
  monthsRemaining: number;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
}): Promise<{ id: string } | null> {
  const amount = prorationAmountCents(a.pricePerDeviceCents, a.monthsRemaining);
  if (amount <= 0) return null;
  const rows = await db
    .insert(invoice)
    .values({
      id: id("inv"),
      organizationId: a.organizationId,
      kind: "proration",
      deviceId: a.deviceId,
      deviceCount: 1,
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      amountUsdCents: amount,
      status: "open",
      issuedAt: a.issuedAt,
      dueAt: dueAtFrom(a.issuedAt),
    })
    .onConflictDoNothing()
    .returning({ id: invoice.id });
  return rows[0] ?? null;
}

export async function issueOverageInvoice(a: {
  organizationId: string;
  periodStart: Date;
  periodEnd: Date;
  used: number;
  includedPerDevice: number;
  paidDeviceCount: number;
  overagePriceCents: number;
  legacyCredits: number;
  issuedAt: Date;
}): Promise<{ id: string } | null> {
  const r = overageFor({
    used: a.used,
    includedPerDevice: a.includedPerDevice,
    paidDeviceCount: a.paidDeviceCount,
    overagePriceCents: a.overagePriceCents,
    legacyCredits: a.legacyCredits,
  });
  // Nothing billable and no credits burned → no invoice at all.
  if (r.billableTriggers <= 0 && r.creditsConsumed <= 0) return null;

  // A zero-amount invoice exists only to document that legacy credits absorbed
  // the whole overage. It is born settled: nothing is owed, no admin action is
  // possible (markInvoicePaidAction rejects a non-positive TRY amount), and an
  // "open" $0 row would age into the overdue KPI and flip the tenant's badge
  // to Overdue for a zero balance.
  const settledOnIssue = r.amountUsdCents <= 0;

  const rows = await db
    .insert(invoice)
    .values({
      id: id("inv"),
      organizationId: a.organizationId,
      kind: "overage",
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      triggersUsed: a.used,
      triggersIncluded: r.includedTotal,
      overageTriggers: r.billableTriggers,
      creditsConsumed: r.creditsConsumed,
      amountUsdCents: r.amountUsdCents,
      status: settledOnIssue ? "paid" : "open",
      issuedAt: a.issuedAt,
      dueAt: dueAtFrom(a.issuedAt),
      paidAt: settledOnIssue ? a.issuedAt : null,
      note: settledOnIssue
        ? "Fully covered by carried-over prepaid credits; nothing to pay."
        : undefined,
    })
    .onConflictDoNothing()
    .returning({ id: invoice.id });
  const issued = rows[0] ?? null;

  // Burn the legacy credits HERE, at issuance, not at payment. Spec §5 offsets
  // them against the first overage invoice only. Zeroing at payment left the
  // full balance readable by every subsequent cron run in the meantime, so the
  // same credits offset period after period — and when they fully absorbed the
  // overage the invoice could never be marked paid at all, so they were never
  // zeroed. Doing it on a non-null insert result is safe against a re-run: a
  // second run conflicts, returns null, and burns nothing twice.
  if (issued && r.creditsConsumed > 0) {
    await db
      .update(tenantSettings)
      .set({ legacyCreditsRemaining: 0, updatedAt: a.issuedAt })
      .where(eq(tenantSettings.organizationId, a.organizationId));
  }

  return issued;
}

export async function listInvoices(
  organizationId: string,
  limit = 50,
): Promise<InvoiceRow[]> {
  return db
    .select()
    .from(invoice)
    .where(eq(invoice.organizationId, organizationId))
    .orderBy(desc(invoice.issuedAt))
    .limit(limit);
}

/**
 * Which unpaid devices a paid subscription invoice activates. At most
 * `deviceCount`, oldest-claimed first (the caller supplies that order).
 *
 * Two exclusions, both closing a free-ride:
 * - Devices claimed AFTER the invoice was issued are never in
 *   `unpaidDeviceIds` (the caller pins the query to `issuedAt`), or a customer
 *   could claim extra hardware between issue and payment and ride in free.
 * - Devices that already hold a live proration invoice are filtered out HERE.
 *   The count guard (activatableDeviceCount) is not enough on its own: delete
 *   a paid device and `invoicedDeviceCount − alreadyPaid` goes positive again,
 *   and the freed slot would activate a device that is separately invoiced —
 *   a free ride and a standing double charge at once.
 *
 * Filter before the slice: a device paying its own way must not consume one of
 * the invoice's activation slots.
 */
export function devicesToActivate(a: {
  deviceCount: number;
  unpaidDeviceIds: string[];
  proratedDeviceIds: ReadonlySet<string>;
}): string[] {
  return a.unpaidDeviceIds
    .filter((deviceId) => !a.proratedDeviceIds.has(deviceId))
    .slice(0, Math.max(0, a.deviceCount));
}

/**
 * How many devices a subscription invoice still has left to activate.
 *
 * `invoice.deviceCount` is what the invoice was PRICED for, not what it still
 * owes. At first activation the two coincide (nothing is paid yet). At renewal
 * the cron prices the invoice with `countPaidDevices` — devices that are
 * ALREADY paid — so activating `deviceCount` more devices would hand free
 * activation to whatever unpaid devices happen to exist (e.g. one claimed
 * during the 30-day renewal lead window, which has its own proration invoice
 * still open). Subtracting the already-paid count makes a renewal activate
 * exactly zero, which is correct: a renewal buys another year for devices that
 * are already on the subscription.
 */
export function activatableDeviceCount(a: {
  invoicedDeviceCount: number;
  alreadyPaidCount: number;
}): number {
  return Math.max(0, a.invoicedDeviceCount - Math.max(0, a.alreadyPaidCount));
}

export async function markInvoicePaid(a: {
  invoiceId: string;
  tryAmountKurus: number;
  fxRate: number;
  userId: string;
  now?: Date;
}): Promise<
  | { ok: true; organizationId: string }
  | { ok: false; reason: "not_found" | "already_settled" }
> {
  const now = a.now ?? new Date();

  // Settle the row first, conditioned on status — this is the concurrency gate,
  // so a double-click cannot activate devices twice.
  const settled = await db
    .update(invoice)
    .set({
      status: "paid",
      paidAt: now,
      tryAmountKurus: a.tryAmountKurus,
      fxRate: a.fxRate,
      markedPaidByUserId: a.userId,
    })
    .where(and(eq(invoice.id, a.invoiceId), eq(invoice.status, "open")))
    .returning();
  const inv = settled[0];
  if (!inv) {
    const [exists] = await db
      .select({ id: invoice.id })
      .from(invoice)
      .where(eq(invoice.id, a.invoiceId))
      .limit(1);
    return { ok: false, reason: exists ? "already_settled" : "not_found" };
  }

  if (inv.kind === "proration" && inv.deviceId) {
    await db
      .update(device)
      .set({ subscriptionPaidAt: now })
      .where(eq(device.id, inv.deviceId));
    return { ok: true, organizationId: inv.organizationId };
  }

  if (inv.kind === "subscription") {
    const [settings] = await db
      .select({
        startedAt: tenantSettings.subscriptionStartedAt,
        renewsAt: tenantSettings.subscriptionRenewsAt,
        price: tenantSettings.pricePerDeviceCents,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, inv.organizationId))
      .limit(1);

    // First activation anchors the whole billing calendar. A renewal must NOT
    // recompute year one from the anchor — it advances the CURRENT renewal
    // date by twelve months, so a second renewal lands in year three.
    const isFirst = !settings?.startedAt;
    const startedAt = settings?.startedAt ?? now;
    // A non-first invoice with a null renewsAt should be unreachable, but this
    // is the most important write in the product: fall back to a fresh year
    // rather than casting the null away and throwing mid-settlement, with the
    // invoice already marked paid.
    const renewsAt = isFirst
      ? renewalDueAt(now)
      : addMonthsAnchored(settings.renewsAt ?? renewalDueAt(now), MONTHS_PER_YEAR);
    const pricePerDeviceCents = settings?.price ?? DEFAULT_PRICE_PER_DEVICE_CENTS;

    // UPSERT, not UPDATE: an org can exist without a tenantSettings row (it is
    // created lazily by Branding / Device Settings and by registration), and a
    // bare UPDATE would match zero rows — devices would activate while
    // subscriptionStartedAt stayed null, so the billing cron would never see
    // the org and the tenant page would say "Not subscribed" forever. Same
    // hazard, same fix as lib/pin-service.ts.
    await db
      .insert(tenantSettings)
      .values({
        organizationId: inv.organizationId,
        subscriptionStartedAt: startedAt,
        subscriptionRenewsAt: renewsAt,
      })
      .onConflictDoUpdate({
        target: tenantSettings.organizationId,
        set: {
          subscriptionStartedAt: startedAt,
          subscriptionRenewsAt: renewsAt,
          updatedAt: now,
        },
      });

    // What the invoice still OWES, not what it was priced for. A renewal is
    // priced with countPaidDevices, so its deviceCount describes devices that
    // are already paid; without this cap it would activate that many *unpaid*
    // devices for free. See activatableDeviceCount.
    const alreadyPaid = await countPaidDevices(inv.organizationId);
    const remaining = activatableDeviceCount({
      invoicedDeviceCount: inv.deviceCount ?? 0,
      alreadyPaidCount: alreadyPaid,
    });

    // Pinned to the invoice's issuance moment: a device claimed AFTER the
    // invoice was issued is not on it and must ride its own proration invoice,
    // otherwise a customer claims extra hardware between issue and payment and
    // rides in for free.
    const unpaid = await db
      .select({ id: device.id })
      .from(device)
      .where(
        and(
          eq(device.organizationId, inv.organizationId),
          isNull(device.subscriptionPaidAt),
          isNotNull(device.claimedAt),
          lte(device.claimedAt, inv.issuedAt),
        ),
      )
      .orderBy(asc(device.claimedAt));

    // A device that already owes a proration is paying its own way and must
    // not be activated by this invoice — see devicesToActivate. Before the
    // first subscription payment this set is always empty (prorations need an
    // anchor, and the anchor is written a few lines above, in this very call),
    // so nothing that legitimately rides the first invoice is stranded.
    const alreadyProrated = await proratedDeviceIds(inv.organizationId);

    const toActivate = devicesToActivate({
      deviceCount: remaining,
      unpaidDeviceIds: unpaid.map((d) => d.id),
      proratedDeviceIds: alreadyProrated,
    });
    for (const deviceId of toActivate) {
      await db
        .update(device)
        .set({ subscriptionPaidAt: now })
        .where(eq(device.id, deviceId));
    }

    // Anything still unpaid now needs its own proration invoice. A device
    // claimed between the first subscription invoice being ISSUED and it being
    // PAID gets none from the claim path — issueProrationForClaimSafe bails
    // while the subscription dates are null, and they are null until this very
    // moment. Without this it would be claimed, unpaid, invoice-less and
    // invisible. Fail-open: the invoice is already settled and the devices
    // already activated, so a proration hiccup must not undo that.
    try {
      await issueProrationsForUnpaidDevices({
        organizationId: inv.organizationId,
        startedAt,
        renewsAt,
        pricePerDeviceCents,
        now,
      });
    } catch (err) {
      console.error("proration issue after subscription payment failed", err);
    }

    return { ok: true, organizationId: inv.organizationId };
  }

  if (inv.kind === "proration") {
    // Reachable: invoice.deviceId is ON DELETE SET NULL, so deleting a device
    // with an open proration leaves an invoice that activates nothing.
    console.warn("proration invoice settled with no device attached", {
      invoiceId: inv.id,
      organizationId: inv.organizationId,
    });
    return { ok: true, organizationId: inv.organizationId };
  }

  // overage: settles only itself. Legacy credits were already burned when the
  // invoice was ISSUED (see issueOverageInvoice) — zeroing them here left the
  // balance re-applicable every period until someone paid.
  return { ok: true, organizationId: inv.organizationId };
}

/**
 * Devices in this org that already carry a live (non-void) proration invoice.
 *
 * Two callers, one definition on purpose. It decides who does NOT need a new
 * proration (issueProrationsForUnpaidDevices) and who must NOT be activated by
 * a subscription payment (markInvoicePaid) — a device on both sides of that
 * split would be charged twice or ride for free, so the two must never drift.
 *
 * Void invoices don't count: voiding a proration is how an operator re-issues
 * one, and canVoidInvoice permits exactly that.
 */
async function proratedDeviceIds(organizationId: string): Promise<Set<string>> {
  const rows = await db
    .select({ deviceId: invoice.deviceId })
    .from(invoice)
    .where(
      and(
        eq(invoice.organizationId, organizationId),
        eq(invoice.kind, "proration"),
        ne(invoice.status, "void"),
      ),
    );
  return new Set(rows.map((r) => r.deviceId).filter((x): x is string => x !== null));
}

/**
 * One proration invoice per still-unpaid claimed device that does not already
 * have one, for the rest of the org's subscription year.
 *
 * The existing-proration check is load-bearing, not just an optimisation: the
 * (deviceId, periodStart) unique index only dedupes WITHIN a period, so a
 * device claimed in the renewal lead window and already prorated would be
 * prorated a second time if the renewal is paid after the next anniversary.
 * Void invoices don't count — voiding is how an operator re-issues one.
 */
async function issueProrationsForUnpaidDevices(a: {
  organizationId: string;
  startedAt: Date;
  renewsAt: Date;
  pricePerDeviceCents: number;
  now: Date;
}): Promise<void> {
  const stillUnpaid = await db
    .select({ id: device.id })
    .from(device)
    .where(
      and(
        eq(device.organizationId, a.organizationId),
        isNull(device.subscriptionPaidAt),
        isNotNull(device.claimedAt),
      ),
    )
    .orderBy(asc(device.claimedAt));
  if (stillUnpaid.length === 0) return;

  const alreadyProrated = await proratedDeviceIds(a.organizationId);

  for (const d of stillUnpaid) {
    if (alreadyProrated.has(d.id)) continue;
    await issueProrationInvoice({
      organizationId: a.organizationId,
      deviceId: d.id,
      pricePerDeviceCents: a.pricePerDeviceCents,
      monthsRemaining: prorationMonths(
        monthsRemainingUntil(a.renewsAt, a.now),
        { deviceId: d.id, organizationId: a.organizationId },
      ),
      periodStart: periodStartFor(a.startedAt, a.now),
      periodEnd: periodEndFor(a.startedAt, a.now),
      issuedAt: a.now,
    });
  }
}
