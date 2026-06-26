// POST /api/stripe/webhook — reconcile Stripe events into our DB.
// Verified by STRIPE_WEBHOOK_SECRET. Stripe is authoritative; we mirror.

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { tenantSettings, invoice as invoiceTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { upsertInvoiceFromStripe } from "@/lib/billing/invoice-sync";
import { isSuspended } from "@/lib/billing/billing-status";
import { recordAudit, AUDIT } from "@/lib/audit";
import { grantCredits } from "@/lib/credits";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!stripe) return NextResponse.json({ error: "billing not configured" }, { status: 503 });
  const secret = getEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "no webhook secret" }, { status: 503 });

  const sig = req.headers.get("stripe-signature") ?? "";
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  switch (event.type) {
    case "invoice.created":
    case "invoice.finalized":
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.voided": {
      const si = event.data.object as Stripe.Invoice;
      await upsertInvoiceFromStripe(si);

      const customerId = typeof si.customer === "string" ? si.customer : si.customer?.id;
      if (customerId && si.id) {
        const [row] = await db
          .select({ org: tenantSettings.organizationId })
          .from(tenantSettings)
          .where(eq(tenantSettings.stripeCustomerId, customerId))
          .limit(1);
        if (row) {
          if (event.type === "invoice.payment_failed") {
            await db.update(invoiceTable).set({ status: "overdue" }).where(eq(invoiceTable.stripeInvoiceId, si.id));
            await recordAudit({ organizationId: row.org, actor: { type: "stripe" }, action: AUDIT.invoicePaymentFailed, target: { type: "invoice", id: si.id }, metadata: { amountDueCents: si.amount_due } });
          } else if (event.type === "invoice.paid") {
            await recordAudit({ organizationId: row.org, actor: { type: "stripe" }, action: AUDIT.invoicePaid, target: { type: "invoice", id: si.id }, metadata: { amountDueCents: si.amount_due } });
          } else if (event.type === "invoice.voided") {
            await recordAudit({ organizationId: row.org, actor: { type: "stripe" }, action: AUDIT.invoiceVoid, target: { type: "invoice", id: si.id } });
          }
        }
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const [row] = await db
        .select({ org: tenantSettings.organizationId, prev: tenantSettings.subscriptionStatus })
        .from(tenantSettings)
        .where(eq(tenantSettings.stripeCustomerId, customerId))
        .limit(1);
      if (!row) break;

      await db
        .update(tenantSettings)
        .set({ stripeSubscriptionId: sub.id, subscriptionStatus: sub.status })
        .where(eq(tenantSettings.organizationId, row.org));

      if (row.prev !== sub.status) {
        await recordAudit({
          organizationId: row.org,
          actor: { type: "stripe" },
          action: AUDIT.subscriptionStatusChanged,
          metadata: { from: row.prev, to: sub.status },
        });
        const was = isSuspended(row.prev ?? null);
        const now = isSuspended(sub.status);
        if (!was && now) {
          await recordAudit({ organizationId: row.org, actor: { type: "stripe" }, action: AUDIT.orgSuspended, metadata: { status: sub.status } });
        } else if (was && !now) {
          await recordAudit({ organizationId: row.org, actor: { type: "stripe" }, action: AUDIT.orgReactivated, metadata: { status: sub.status } });
        }
      }
      break;
    }
    case "setup_intent.succeeded":
    case "payment_method.attached": {
      const pm =
        event.type === "payment_method.attached"
          ? (event.data.object as Stripe.PaymentMethod)
          : null;
      if (pm?.card && typeof pm.customer === "string") {
        await db
          .update(tenantSettings)
          .set({ cardBrand: pm.card.brand, cardLast4: pm.card.last4 })
          .where(eq(tenantSettings.stripeCustomerId, pm.customer));
      }
      break;
    }
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (
        session.mode === "payment" &&
        session.payment_status === "paid" &&
        session.metadata?.organizationId
      ) {
        const credits = Number(session.metadata.credits);
        if (Number.isInteger(credits) && credits > 0) {
          const res = await grantCredits({
            organizationId: session.metadata.organizationId,
            credits,
            kind: "purchase",
            idempotencyKey: session.id,
            note: `stripe pack ${session.metadata.packId ?? ""}`,
          });
          if (res.applied) {
            await recordAudit({
              organizationId: session.metadata.organizationId,
              actor: { type: "stripe" },
              action: AUDIT.creditsPurchased,
              metadata: { credits, sessionId: session.id },
            });
          }
        }
      }
      break;
    }
    default:
      break; // ignore unhandled types
  }

  return NextResponse.json({ received: true });
}
