// app/(tenant)/tenant/billing/actions.ts
"use server";

import { requireTenant } from "@/lib/session";
import {
  activateBilling as activate,
  createCreditCheckout as creditCheckout,
} from "@/lib/billing/stripe-billing";
import { recordAudit, AUDIT } from "@/lib/audit";

export async function activateBilling(): Promise<{ clientSecret: string }> {
  const { ctx, organizationId } = await requireTenant();
  const result = await activate(organizationId);

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.billingActivated,
  });

  return result;
}

export async function startCreditCheckout(
  packId: string,
): Promise<{ clientSecret: string }> {
  const { organizationId } = await requireTenant();
  return creditCheckout(organizationId, packId);
}
