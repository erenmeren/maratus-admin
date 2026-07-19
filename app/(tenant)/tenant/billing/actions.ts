// app/(tenant)/tenant/billing/actions.ts
"use server";

import { requireTenant } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";
import { createCreditCheckout as creditCheckout } from "@/lib/billing/stripe-billing";

export async function startCreditCheckout(
  packId: string,
): Promise<{ clientSecret: string }> {
  const { ctx, organizationId } = await requireTenant();
  // Billing is owner/admin territory; members are read-only.
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!canManageTenant(role)) {
    throw new Error("You don't have permission to manage billing.");
  }
  return creditCheckout(organizationId, packId);
}
