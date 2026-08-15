// Persistence for bank-transfer invoices. All amount arithmetic comes from
// lib/invoicing.ts; this file only reads counts and writes rows.
//
// Every issue* function is idempotent: the (organizationId, kind, periodStart)
// unique index turns a duplicate into a no-op, which is what lets the daily
// cron run more than once over the same period safely.

import { and, asc, desc, eq, gte, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { device, deviceCommand, invoice, tenantSettings } from "./db/schema";
import { id } from "./ids";
import { addMonthsAnchored, MONTHS_PER_YEAR, renewalDueAt } from "./billing-period";
import {
  dueAtFrom,
  overageFor,
  prorationAmountCents,
  subscriptionAmountCents,
} from "./invoicing";

export type InvoiceRow = typeof invoice.$inferSelect;

/**
 * "Overdue" is derived, never stored: an open invoice past its due date.
 * Small shared helper — the several call sites that inline this check
 * against a full `InvoiceRow` (components/billing/invoice-table.tsx,
 * components/billing/subscription-card.tsx, tenant/billing/page.tsx) are
 * left as-is; this is for new call sites that only have the two fields.
 */
export function isInvoiceOverdue(
  inv: { status: InvoiceRow["status"]; dueAt: Date },
  now: Date,
): boolean {
  return inv.status === "open" && inv.dueAt < now;
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
  const rows = await db
    .insert(invoice)
    .values({
      id: id("inv"),
      organizationId: a.organizationId,
      kind: "subscription",
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      deviceCount: a.deviceCount,
      amountUsdCents: subscriptionAmountCents(a.deviceCount, a.pricePerDeviceCents),
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
      status: "open",
      issuedAt: a.issuedAt,
      dueAt: dueAtFrom(a.issuedAt),
    })
    .onConflictDoNothing()
    .returning({ id: invoice.id });
  return rows[0] ?? null;
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
 * Which unpaid devices a paid subscription invoice activates. Exactly
 * `deviceCount`, oldest-claimed first (the caller supplies that order).
 * Devices claimed AFTER the invoice was issued deliberately stay unpaid and
 * get their own proration invoice — otherwise a customer could claim extra
 * hardware between issue and payment and ride in for free.
 */
export function devicesToActivate(a: {
  deviceCount: number;
  unpaidDeviceIds: string[];
}): string[] {
  return a.unpaidDeviceIds.slice(0, Math.max(0, a.deviceCount));
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
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, inv.organizationId))
      .limit(1);

    // First activation anchors the whole billing calendar. A renewal must NOT
    // recompute year one from the anchor — it advances the CURRENT renewal
    // date by twelve months, so a second renewal lands in year three.
    const isFirst = !settings?.startedAt;
    await db
      .update(tenantSettings)
      .set({
        subscriptionStartedAt: settings?.startedAt ?? now,
        subscriptionRenewsAt: isFirst
          ? renewalDueAt(now)
          : addMonthsAnchored(settings.renewsAt as Date, MONTHS_PER_YEAR),
        updatedAt: now,
      })
      .where(eq(tenantSettings.organizationId, inv.organizationId));

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

    const toActivate = devicesToActivate({
      deviceCount: remaining,
      unpaidDeviceIds: unpaid.map((d) => d.id),
    });
    for (const deviceId of toActivate) {
      await db
        .update(device)
        .set({ subscriptionPaidAt: now })
        .where(eq(device.id, deviceId));
    }
    return { ok: true, organizationId: inv.organizationId };
  }

  // overage: settles only itself, and burns the legacy credits it consumed.
  if (inv.kind === "overage" && (inv.creditsConsumed ?? 0) > 0) {
    await db
      .update(tenantSettings)
      .set({ legacyCreditsRemaining: 0, updatedAt: now })
      .where(eq(tenantSettings.organizationId, inv.organizationId));
  }
  return { ok: true, organizationId: inv.organizationId };
}
