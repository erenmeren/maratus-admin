// app/(tenant)/tenant/billing/actions.ts
"use server";

import { requireTenant } from "@/lib/session";
import { activateBilling as activate } from "@/lib/billing/stripe-billing";

export async function activateBilling(): Promise<{ clientSecret: string }> {
  const { organizationId } = await requireTenant();
  return activate(organizationId);
}
