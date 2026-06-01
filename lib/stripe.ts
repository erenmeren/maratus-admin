// lib/stripe.ts
// Server-only Stripe client. Exports `null` when STRIPE_SECRET_KEY is unset so
// the app builds and billing features degrade gracefully.

import Stripe from "stripe";
import { getEnv } from "./env";

function build(): Stripe | null {
  const key = getEnv().STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { typescript: true });
}

export const stripe = build();
