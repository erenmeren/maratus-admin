// lib/billing/stripe-billing.ts
// Stripe billing IO: customer, subscription, and metered usage. Pure mappers
// live in ./billing-status and are re-exported here for convenience.

import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { tenantSettings, invoice as invoiceTable } from "@/lib/db/schema";
import { stripeInvoiceParamsFor, invoicePeriodLabel } from "./invoice-collect";
import { getEnv } from "@/lib/env";
import { eq } from "drizzle-orm";
import { meterEventPayload } from "./billing-status";
import { findPack } from "./credit-packs";
import { getOrgEmailContext, invoiceSentEmail, formatDueDate } from "./invoice-emails";
import { sendEmail } from "@/lib/email";

export { statusForStripeInvoice, meterEventPayload } from "./billing-status";

function requireStripe() {
  if (!stripe) throw new Error("Stripe is not configured");
  return stripe;
}

/** Find-or-create the Stripe Customer for an org; persists the id. */
export async function ensureStripeCustomer(organizationId: string): Promise<string> {
  const s = requireStripe();
  const [settings] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, organizationId))
    .limit(1);
  if (settings?.stripeCustomerId) return settings.stripeCustomerId;

  const customer = await s.customers.create({ metadata: { organizationId } });
  await db
    .update(tenantSettings)
    .set({ stripeCustomerId: customer.id })
    .where(eq(tenantSettings.organizationId, organizationId));
  return customer.id;
}

/**
 * Create a Checkout Session in subscription mode (`ui_mode: "elements"`) and
 * return its client secret. Stripe's recommended path for starting a
 * subscription: Checkout creates the subscription and captures the card on
 * confirm; we learn the subscription id/status via webhook. The metered first
 * invoice is $0, so no immediate charge — the card is saved for off-session use.
 */
export async function activateBilling(organizationId: string): Promise<{ clientSecret: string }> {
  const s = requireStripe();
  const priceId = getEnv().STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not configured");

  const customerId = await ensureStripeCustomer(organizationId);
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    ui_mode: "elements",
    customer: customerId,
    line_items: [{ price: priceId }],
    return_url: `${getEnv().BETTER_AUTH_URL}/tenant/billing`,
  });

  if (!session.client_secret) {
    throw new Error("No client secret returned for checkout session");
  }
  return { clientSecret: session.client_secret };
}

/**
 * Create a one-time Checkout Session for a credit pack (`mode: "payment"`,
 * `ui_mode: "elements"`). The webhook grants the credits after payment.
 */
export async function createCreditCheckout(
  organizationId: string,
  packId: string,
): Promise<{ clientSecret: string }> {
  const s = requireStripe();
  const pack = findPack(packId);
  if (!pack) throw new Error("Unknown credit pack");

  const customerId = await ensureStripeCustomer(organizationId);
  const session = await s.checkout.sessions.create({
    mode: "payment",
    ui_mode: "elements",
    customer: customerId,
    line_items: [{ price: pack.priceId, quantity: 1 }],
    metadata: {
      organizationId,
      packId: pack.id,
      credits: String(pack.credits),
    },
    return_url: `${getEnv().BETTER_AUTH_URL}/tenant/billing`,
  });

  if (!session.client_secret) {
    throw new Error("No client secret for credit checkout");
  }
  return { clientSecret: session.client_secret };
}

/** Fire one metered usage event for a customer. Caller handles errors. */
export async function reportDocumentUsage(stripeCustomerId: string): Promise<void> {
  const s = requireStripe();
  const { event_name, payload } = meterEventPayload(
    stripeCustomerId,
    getEnv().STRIPE_METER_EVENT_NAME,
  );
  await s.billing.meterEvents.create({ event_name, payload });
}

/**
 * Phase 1A — push a locally-generated invoice to Stripe so it can collect.
 * Hybrid collection: charge_automatically when the org has a saved card, else
 * send_invoice (Net 14, Stripe emails the hosted page). Idempotent: a row that
 * already has a stripeInvoiceId is a no-op. The webhook reconciles paid/failed.
 */
export async function sendInvoiceToStripe(invoiceId: string): Promise<
  | {
      ok: true;
      stripeInvoiceId: string;
      hostedInvoiceUrl: string | null;
      collectionMethod: "charge_automatically" | "send_invoice";
    }
  | { ok: false; reason: "not_found" | "already_sent" | "no_amount" | "stripe_disabled" }
> {
  if (!stripe) return { ok: false, reason: "stripe_disabled" };
  const s = stripe;

  const [inv] = await db
    .select()
    .from(invoiceTable)
    .where(eq(invoiceTable.id, invoiceId))
    .limit(1);
  if (!inv) return { ok: false, reason: "not_found" };
  if (inv.stripeInvoiceId) return { ok: false, reason: "already_sent" };
  if (inv.amountDueCents <= 0) return { ok: false, reason: "no_amount" };

  const customerId = await ensureStripeCustomer(inv.organizationId);

  const [settings] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, inv.organizationId))
    .limit(1);
  const hasCard = settings?.cardLast4 != null;

  const params = stripeInvoiceParamsFor(
    {
      amountDueCents: inv.amountDueCents,
      documentCount: inv.documentCount,
      unitPriceCents: inv.unitPriceCents,
      periodStart: inv.periodStart,
    },
    { hasCard },
  );

  // Create the invoice first so the item can attach to it explicitly.
  const created = await s.invoices.create({
    customer: customerId,
    collection_method: params.collectionMethod,
    ...(params.daysUntilDue != null ? { days_until_due: params.daysUntilDue } : {}),
    auto_advance: false,
    metadata: { organizationId: inv.organizationId, localInvoiceId: inv.id },
  });

  if (!created.id) throw new Error("Stripe invoice has no id");

  await s.invoiceItems.create({
    customer: customerId,
    invoice: created.id,
    amount: params.item.amountCents,
    currency: params.item.currency,
    description: params.item.description,
  });

  // Finalize: charge_automatically attempts the charge now; either way we get
  // the hosted_invoice_url. For send_invoice, email the hosted page.
  const finalized = await s.invoices.finalizeInvoice(created.id);
  if (params.collectionMethod === "send_invoice") {
    await s.invoices.sendInvoice(finalized.id);
  }

  await db
    .update(invoiceTable)
    .set({
      stripeInvoiceId: finalized.id,
      hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
      dueDate: finalized.due_date != null ? new Date(finalized.due_date * 1000) : null,
      status: "sent",
    })
    .where(eq(invoiceTable.id, inv.id));

  // 1C: notify the tenant owner only on the send_invoice (pay-link) path. For
  // charge_automatically there's nothing to pay; paid/failed emails cover it.
  if (params.collectionMethod === "send_invoice") {
    const { ownerEmail, orgName } = await getOrgEmailContext(inv.organizationId);
    if (ownerEmail) {
      const mail = invoiceSentEmail({
        orgName,
        periodLabel: invoicePeriodLabel(inv.periodStart),
        amountDollars: inv.amountDueCents / 100,
        payUrl: finalized.hosted_invoice_url ?? `${getEnv().BETTER_AUTH_URL}/tenant/billing`,
        dueDateLabel:
          finalized.due_date != null ? formatDueDate(new Date(finalized.due_date * 1000)) : undefined,
      });
      await sendEmail(ownerEmail, mail.subject, mail.html);
    }
  }

  return {
    ok: true,
    stripeInvoiceId: finalized.id,
    hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
    collectionMethod: params.collectionMethod,
  };
}
