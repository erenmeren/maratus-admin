"use server";

// Persist the optional return/warranty windows (shown on /d/{token}).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { isValidWindowDays, isValidWarrantyMonths } from "@/lib/branding/coverage";
import { recordAudit, AUDIT } from "@/lib/audit";

export interface SaveCoverageResult {
  ok: boolean;
  error?: string;
}

/** Parse a blank-or-integer field. Returns: null (blank), number (parsed), or "invalid". */
function parseWindow(raw: string): number | null | "invalid" {
  const s = raw.trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return "invalid";
  return Number(s);
}

export async function saveCoverageWindow(formData: FormData): Promise<SaveCoverageResult> {
  const { ctx, organizationId } = await requireTenant();
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission to edit this." };
  }

  const days = parseWindow(String(formData.get("returnWindowDays") ?? ""));
  const months = parseWindow(String(formData.get("warrantyPeriodMonths") ?? ""));

  if (days === "invalid" || (typeof days === "number" && !isValidWindowDays(days))) {
    return { ok: false, error: "Return window must be a whole number of days (1–3650), or blank." };
  }
  if (months === "invalid" || (typeof months === "number" && !isValidWarrantyMonths(months))) {
    return { ok: false, error: "Warranty must be a whole number of months (1–120), or blank." };
  }

  const returnWindowDays = days as number | null;
  const warrantyPeriodMonths = months as number | null;

  await db
    .insert(tenantSettings)
    .values({ organizationId, returnWindowDays, warrantyPeriodMonths })
    .onConflictDoUpdate({
      target: tenantSettings.organizationId,
      set: { returnWindowDays, warrantyPeriodMonths, updatedAt: new Date() },
    });

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.brandingUpdated,
  });
  revalidatePath("/tenant/branding");
  return { ok: true };
}
