"use server";

// Server action: persist tenant branding to tenant_settings.
// Only org owners/admins may edit. A new logo is uploaded to R2 (private) and
// its object key stored in tenant_settings.logoUrl; the public-facing image is
// served later via a short-lived presigned URL. When a logo is replaced or
// removed, the previous R2 object is deleted so no orphans accumulate.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { isValidHex } from "@/lib/color";
import { id } from "@/lib/ids";
import { deleteObject, logoStorageKey, putObject } from "@/lib/storage";
import { recordAudit, AUDIT } from "@/lib/audit";

export interface SaveBrandingResult {
  ok: boolean;
  error?: string;
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

export async function saveBranding(
  formData: FormData,
): Promise<SaveBrandingResult> {
  const { ctx, organizationId } = await requireTenant();

  // Authorize: only owners/admins of the active org may change branding.
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission to edit branding." };
  }

  // --- Validate scalar fields --------------------------------------------
  const rawColor = String(formData.get("brandColor") ?? "").trim();
  if (!isValidHex(rawColor)) {
    return { ok: false, error: "Enter a valid hex color (e.g. #B4541F)." };
  }
  const brandColor = rawColor.startsWith("#") ? rawColor : `#${rawColor}`;

  const staffPinRaw = String(formData.get("staffPin") ?? "").trim();
  const staffPin = staffPinRaw.replace(/\D/g, "").slice(0, 6);

  // --- Logo: upload new, clear, or leave unchanged -----------------------
  // undefined = no change to logoUrl; null = clear it; string = new key.
  let logoUrlUpdate: string | null | undefined = undefined;
  const logo = formData.get("logo");
  const removeLogo = formData.get("removeLogo") === "true";

  if (logo instanceof File && logo.size > 0) {
    if (!logo.type.startsWith("image/")) {
      return { ok: false, error: "Logo must be an image file." };
    }
    if (logo.size > MAX_LOGO_BYTES) {
      return { ok: false, error: "Logo must be under 2 MB." };
    }
    const key = logoStorageKey(organizationId, id("logo"));
    const bytes = Buffer.from(await logo.arrayBuffer());
    try {
      await putObject(key, bytes, logo.type);
    } catch (err) {
      console.error("Logo upload failed", err);
      return { ok: false, error: "Logo upload failed. Try again." };
    }
    logoUrlUpdate = key;
  } else if (removeLogo) {
    logoUrlUpdate = null;
  }

  // If the logo is changing (replace or remove), capture the previous object
  // key first so we can delete it after the DB write succeeds.
  let previousLogoKey: string | null = null;
  if (logoUrlUpdate !== undefined) {
    const [existing] = await db
      .select({ logoUrl: tenantSettings.logoUrl })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, organizationId))
      .limit(1);
    previousLogoKey = existing?.logoUrl ?? null;
  }

  // --- Upsert tenant_settings --------------------------------------------
  const now = new Date();
  await db
    .insert(tenantSettings)
    .values({
      organizationId,
      brandColor,
      staffPin,
      ...(logoUrlUpdate !== undefined ? { logoUrl: logoUrlUpdate } : {}),
    })
    .onConflictDoUpdate({
      target: tenantSettings.organizationId,
      set: {
        brandColor,
        staffPin,
        updatedAt: now,
        ...(logoUrlUpdate !== undefined ? { logoUrl: logoUrlUpdate } : {}),
      },
    });

  // --- Clean up the orphaned old logo object (best-effort) ---------------
  // Only after the DB no longer references it, and only if it actually changed.
  if (
    previousLogoKey &&
    previousLogoKey !== logoUrlUpdate // not the same object
  ) {
    await deleteObject(previousLogoKey);
  }

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.brandingUpdated,
  });

  revalidatePath("/tenant/branding");
  revalidatePath("/tenant");
  return { ok: true };
}
