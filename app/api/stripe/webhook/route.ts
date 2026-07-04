// POST /api/stripe/webhook — reconcile Stripe events into our DB.
// Verified by STRIPE_WEBHOOK_SECRET. Credit-pack purchase is the only event we act on.
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { getEnv } from "@/lib/env";
import { grantCredits } from "@/lib/credits";
import { recordAudit, AUDIT } from "@/lib/audit";

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

  if (event.type === "checkout.session.completed") {
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
  }

  return NextResponse.json({ received: true });
}
