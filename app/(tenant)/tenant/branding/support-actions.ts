"use server";

// Persist the optional customer-facing support contact (shown on /d/{token}).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { isLikelyEmail, isHttpUrl } from "@/lib/branding/support";
import { recordAudit, AUDIT } from "@/lib/audit";

export interface SaveSupportResult {
  ok: boolean;
  error?: string;
}

export async function saveSupportContact(formData: FormData): Promise<SaveSupportResult> {
  const { ctx, organizationId } = await requireTenant();
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission to edit this." };
  }

  const emailRaw = String(formData.get("supportEmail") ?? "").trim();
  const urlRaw = String(formData.get("supportUrl") ?? "").trim();
  if (emailRaw && !isLikelyEmail(emailRaw)) {
    return { ok: false, error: "Enter a valid support email, or leave it blank." };
  }
  if (urlRaw && !isHttpUrl(urlRaw)) {
    return { ok: false, error: "Enter a full http(s) URL, or leave it blank." };
  }

  await db
    .insert(tenantSettings)
    .values({ organizationId, supportEmail: emailRaw || null, supportUrl: urlRaw || null })
    .onConflictDoUpdate({
      target: tenantSettings.organizationId,
      set: { supportEmail: emailRaw || null, supportUrl: urlRaw || null, updatedAt: new Date() },
    });

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.brandingUpdated,
  });
  revalidatePath("/tenant/branding");
  return { ok: true };
}
