// app/(tenant)/tenant/billing/actions.ts
"use server";

import { requireTenant } from "@/lib/session";
import { createCreditCheckout as creditCheckout } from "@/lib/billing/stripe-billing";

export async function startCreditCheckout(
  packId: string,
): Promise<{ clientSecret: string }> {
  const { organizationId } = await requireTenant();
  return creditCheckout(organizationId, packId);
}
