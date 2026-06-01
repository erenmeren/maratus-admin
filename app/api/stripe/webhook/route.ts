// POST /api/stripe/webhook — reconcile Stripe events into our DB.
// Verified by STRIPE_WEBHOOK_SECRET. Stripe is authoritative; we mirror.

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { upsertInvoiceFromStripe } from "@/lib/billing/invoice-sync";

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
      await upsertInvoiceFromStripe(event.data.object as Stripe.Invoice);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      await db
        .update(tenantSettings)
        .set({ subscriptionStatus: sub.status })
        .where(eq(tenantSettings.stripeCustomerId, customerId));
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
    default:
      break; // ignore unhandled types
  }

  return NextResponse.json({ received: true });
}
