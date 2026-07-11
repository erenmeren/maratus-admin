"use server";
import { eq } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { recordAudit, AUDIT } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { isOrgArchived } from "@/lib/archived-guard";
import { syncDeviceSubscription } from "@/lib/billing/device-subscription";
import type { BillingPlan } from "@/lib/billing-plan";

export type PlanState = { ok: boolean; error?: string };

const PLANS: BillingPlan[] = ["credits", "flat", "base_usage"];

export async function setBillingPlanAction(
  _prev: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const ctx = await requirePlatformAdmin();
  const orgId = String(formData.get("organizationId") ?? "");
  const plan = String(formData.get("billingPlan") ?? "") as BillingPlan;
  const included = Number(formData.get("includedTriggersPerDevice") ?? 0);
  if (!orgId || !PLANS.includes(plan)) {
    return { ok: false, error: "Pick a valid billing plan." };
  }
  if (!Number.isInteger(included) || included < 0 || included > 1_000_000) {
    return { ok: false, error: "Included triggers must be a whole number between 0 and 1,000,000." };
  }
  if (await isOrgArchived(orgId)) {
    return { ok: false, error: "Customer is archived." };
  }

  const [updated] = await db
    .update(tenantSettings)
    .set({ billingPlan: plan, includedTriggersPerDevice: included, updatedAt: new Date() })
    .where(eq(tenantSettings.organizationId, orgId))
    .returning({ organizationId: tenantSettings.organizationId });
  if (!updated) return { ok: false, error: "Customer not found." };

  await recordAudit({
    organizationId: orgId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.billingPlanChanged,
    metadata: { plan, includedTriggersPerDevice: included },
  });

  // Reconcile the Stripe subscription with the new plan (fail-open).
  try {
    await syncDeviceSubscription(orgId);
  } catch (err) {
    console.error("device-subscription sync after plan change failed", err);
  }

  revalidatePath(`/admin/customers/${orgId}`);
  return { ok: true };
}
