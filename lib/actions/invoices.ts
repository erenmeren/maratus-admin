"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { device, invoice, tenantSettings } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { isOrgArchived } from "@/lib/archived-guard";
import { recordAudit, AUDIT } from "@/lib/audit";
import {
  addMonthsAnchored,
  MONTHS_PER_YEAR,
  startOfUtcDay,
} from "@/lib/billing-period";
import { issueSubscriptionInvoice, markInvoicePaid } from "@/lib/invoices";
import { DEFAULT_PRICE_PER_DEVICE_CENTS } from "@/lib/invoicing";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Issues the first (or a subsequent, distinct-period) subscription invoice
 * for every CLAIMED device the org currently has. At first subscription no
 * device is paid yet, so claimed correctly equals unpaid-claimed; renewals
 * are handled by the billing cron via countPaidDevices instead.
 */
export async function startSubscriptionAction(tenantId: string): Promise<ActionResult> {
  const ctx = await requirePlatformAdmin();

  if (await isOrgArchived(tenantId)) {
    return { ok: false, error: "Customer is archived." };
  }

  const [settings] = await db
    .select({ price: tenantSettings.pricePerDeviceCents })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, tenantId))
    .limit(1);

  const [devices] = await db
    .select({ c: count() })
    .from(device)
    .where(and(eq(device.organizationId, tenantId), isNotNull(device.claimedAt)));

  const deviceCount = Number(devices?.c ?? 0);
  if (deviceCount === 0) {
    return { ok: false, error: "This customer has no claimed devices to subscribe." };
  }

  // The card shows "Start subscription" for the whole window between issuing
  // the invoice and it being marked paid (subscriptionStartedAt is only
  // written on payment), so a second click is easy and used to produce a
  // second full-year invoice. Marking both paid would read the second as a
  // renewal and push subscriptionRenewsAt out 24 months.
  const [openSubscription] = await db
    .select({ id: invoice.id })
    .from(invoice)
    .where(
      and(
        eq(invoice.organizationId, tenantId),
        eq(invoice.kind, "subscription"),
        eq(invoice.status, "open"),
      ),
    )
    .limit(1);
  if (openSubscription) {
    return {
      ok: false,
      error:
        "This customer already has an open subscription invoice. Mark it paid, or void it first.",
    };
  }

  const now = new Date();
  // Truncated to a UTC day: the unique (organizationId, kind, periodStart)
  // index is the last line of defence against a duplicate, and a millisecond
  // timestamp never collides, so the index would never fire.
  const periodStart = startOfUtcDay(now);
  const pricePerDeviceCents = settings?.price ?? DEFAULT_PRICE_PER_DEVICE_CENTS;
  const issued = await issueSubscriptionInvoice({
    organizationId: tenantId,
    deviceCount,
    pricePerDeviceCents,
    periodStart,
    periodEnd: addMonthsAnchored(periodStart, MONTHS_PER_YEAR),
    issuedAt: now,
  });
  if (!issued) {
    // The unique index is (organizationId, kind, periodStart) with no status
    // predicate, so a paid or voided subscription invoice already issued today
    // still occupies the slot. Say so, rather than leaving the operator
    // guessing at a constraint they cannot see.
    return {
      ok: false,
      error:
        "A subscription invoice was already issued for this customer today. If it was voided, re-issue tomorrow.",
    };
  }

  await recordAudit({
    organizationId: tenantId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.invoiceIssued,
    target: { type: "invoice", id: issued.id },
    metadata: { deviceCount, pricePerDeviceCents },
  });

  revalidatePath(`/admin/customers/${tenantId}`);
  return { ok: true };
}

/**
 * Records a bank-transfer payment against an open invoice. This is the
 * action that actually activates a subscription / paid devices — see
 * lib/invoices.ts markInvoicePaid for the settlement + activation logic.
 *
 * There's no payment provider anywhere in this system, so the audit row
 * this writes IS the record of "who paid what" — it must never be
 * attributable to a caller-supplied org. Every org-scoped decision here
 * (the archived guard, the audit row, the revalidated path) is sourced
 * from the invoice actually being settled, not from an argument.
 */
export async function markInvoicePaidAction(a: {
  invoiceId: string;
  tryAmountKurus: number;
  fxRate: number;
}): Promise<ActionResult> {
  const ctx = await requirePlatformAdmin();

  if (!Number.isInteger(a.tryAmountKurus) || a.tryAmountKurus <= 0) {
    return { ok: false, error: "Enter the transferred amount in kuruş (whole number)." };
  }
  if (!Number.isInteger(a.fxRate) || a.fxRate <= 0) {
    return { ok: false, error: "Enter the FX rate in kuruş per USD (whole number)." };
  }

  const [invRow] = await db
    .select({ organizationId: invoice.organizationId })
    .from(invoice)
    .where(eq(invoice.id, a.invoiceId))
    .limit(1);
  if (!invRow) {
    return { ok: false, error: "Invoice not found." };
  }
  if (await isOrgArchived(invRow.organizationId)) {
    return { ok: false, error: "Customer is archived." };
  }

  const result = await markInvoicePaid({
    invoiceId: a.invoiceId,
    tryAmountKurus: a.tryAmountKurus,
    fxRate: a.fxRate,
    userId: ctx.user.id,
  });
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "already_settled"
          ? "This invoice was already settled."
          : "Invoice not found.",
    };
  }

  await recordAudit({
    organizationId: result.organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.invoicePaid,
    target: { type: "invoice", id: a.invoiceId },
    metadata: { tryAmountKurus: a.tryAmountKurus, fxRate: a.fxRate },
  });

  revalidatePath(`/admin/customers/${result.organizationId}`);
  return { ok: true };
}

/**
 * Cancels an invoice issued by mistake. Only open → void: a paid invoice has
 * already activated devices and moved money, so it is not reversible here.
 * Voiding has no side effects of its own — it just takes the row out of the
 * overdue sweep and frees the (org, kind, periodStart) slot for a re-issue.
 */
export async function voidInvoiceAction(invoiceId: string): Promise<ActionResult> {
  const ctx = await requirePlatformAdmin();

  const [invRow] = await db
    .select({ organizationId: invoice.organizationId, status: invoice.status })
    .from(invoice)
    .where(eq(invoice.id, invoiceId))
    .limit(1);
  if (!invRow) {
    return { ok: false, error: "Invoice not found." };
  }
  if (invRow.status !== "open") {
    return {
      ok: false,
      error:
        invRow.status === "paid"
          ? "A paid invoice cannot be voided."
          : "This invoice is already void.",
    };
  }

  // Conditioned on status so a double-click (or a race with mark-paid) cannot
  // void something that has just been settled.
  const voided = await db
    .update(invoice)
    .set({ status: "void" })
    .where(and(eq(invoice.id, invoiceId), eq(invoice.status, "open")))
    .returning({ id: invoice.id });
  if (voided.length === 0) {
    return { ok: false, error: "This invoice was already settled." };
  }

  await recordAudit({
    organizationId: invRow.organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.invoiceVoided,
    target: { type: "invoice", id: invoiceId },
  });

  revalidatePath(`/admin/customers/${invRow.organizationId}`);
  return { ok: true };
}
