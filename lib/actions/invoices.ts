"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { device, invoice, tenantSettings } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { isOrgArchived } from "@/lib/archived-guard";
import { recordAudit, AUDIT } from "@/lib/audit";
import { addMonthsAnchored, MONTHS_PER_YEAR } from "@/lib/billing-period";
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

  const now = new Date();
  const pricePerDeviceCents = settings?.price ?? DEFAULT_PRICE_PER_DEVICE_CENTS;
  const issued = await issueSubscriptionInvoice({
    organizationId: tenantId,
    deviceCount,
    pricePerDeviceCents,
    periodStart: now,
    periodEnd: addMonthsAnchored(now, MONTHS_PER_YEAR),
    issuedAt: now,
  });
  if (!issued) {
    return { ok: false, error: "An invoice already exists for this period." };
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
