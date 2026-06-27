// lib/billing/invoice-sync.ts
// Mirror Stripe invoices into our `invoice` table (Stripe is authoritative).

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { invoice, tenantSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { invoiceRowFromStripe } from "./billing-status";

/** Upsert by stripeInvoiceId. Resolves org via the Stripe customer mapping. */
export async function upsertInvoiceFromStripe(si: Stripe.Invoice): Promise<void> {
  if (!si.id) return;
  const customerId = typeof si.customer === "string" ? si.customer : si.customer?.id;
  if (!customerId) return;
  const [settings] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.stripeCustomerId, customerId))
    .limit(1);
  if (!settings) return; // unknown customer — ignore

  const row = invoiceRowFromStripe(si, settings.organizationId);
  // Atomic upsert on the unique stripeInvoiceId index — safe under Stripe's
  // at-least-once / concurrent webhook delivery (no read-then-write race).
  await db
    .insert(invoice)
    .values(row)
    .onConflictDoUpdate({
      target: invoice.stripeInvoiceId,
      set: {
        status: row.status,
        amountDueCents: row.amountDueCents,
        hostedInvoiceUrl: row.hostedInvoiceUrl,
        documentCount: row.documentCount,
      },
    });
}
