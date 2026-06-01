// scripts/stripe-setup.ts
// One-time: create the Product, Meter, and metered Price tenants subscribe to.
// Run once per Stripe account: `npx tsx scripts/stripe-setup.ts`
// Copy the printed STRIPE_PRICE_ID into .env.local.

import "@/lib/db/load-env";
import Stripe from "stripe";
import { getEnv } from "@/lib/env";

async function main() {
  const key = getEnv().STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is required to run setup");
  const stripe = new Stripe(key, { typescript: true });
  const eventName = getEnv().STRIPE_METER_EVENT_NAME;

  const product = await stripe.products.create({ name: "Ditto digital receipts" });

  const meter = await stripe.billing.meters.create({
    display_name: "Receipts",
    event_name: eventName,
    default_aggregation: { formula: "sum" },
  });

  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: 4, // $0.04 per receipt
    recurring: { interval: "month", usage_type: "metered", meter: meter.id },
  });

  console.log("Stripe setup complete:");
  console.log(`  product:  ${product.id}`);
  console.log(`  meter:    ${meter.id} (event_name=${eventName})`);
  console.log(`  price:    ${price.id}`);
  console.log(`\nAdd to .env.local:\n  STRIPE_PRICE_ID="${price.id}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
