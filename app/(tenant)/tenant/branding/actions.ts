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
import { normalizePrinterConfig, PRINTER_SCREENS, type PrinterConfig } from "@/lib/printer-layout";
import { id } from "@/lib/ids";
import { deleteObject, iconStorageKey, logoStorageKey, putObject } from "@/lib/storage";
import { recordAudit, AUDIT } from "@/lib/audit";
import { enqueueConfigChangedForOrg } from "@/lib/data";

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

  // Optional printer theme tokens. Empty or invalid → null (derive from accent).
  const token = (key: string): string | null => {
    const v = String(formData.get(key) ?? "").trim();
    if (!v || !isValidHex(v)) return null;
    return v.startsWith("#") ? v : `#${v}`;
  };
  const brandBg = token("brandBg");
  const brandFg = token("brandFg");
  const brandMuted = token("brandMuted");

  // v3 per-screen printer config (JSON). Normalized so bad input can't be stored.
  let printerConfig: PrinterConfig | undefined;
  const screensRaw = String(formData.get("printerScreens") ?? "").trim();
  if (screensRaw) {
    try {
      printerConfig = normalizePrinterConfig(JSON.parse(screensRaw));
    } catch {
      printerConfig = undefined; // ignore malformed JSON; leave config unchanged
    }
  }

  // Process newly-uploaded icon files. The client sets icon.url = "pending:<objectId>"
  // and sends the file under "icon:<objectId>". Rewrite urls to the stored R2 key.
  if (printerConfig !== undefined) {
    for (const screen of PRINTER_SCREENS) {
      for (const o of printerConfig.screens[screen].objects) {
        if (o.type === "icon" && o.icon?.source === "upload" && o.icon.url?.startsWith("pending:")) {
          const objectId = o.icon.url.slice("pending:".length);
          const file = formData.get(`icon:${objectId}`);
          if (file instanceof File && file.size > 0) {
            if (!file.type.startsWith("image/")) {
              return { ok: false, error: "Icon must be an image file." };
            }
            if (file.size > MAX_LOGO_BYTES) {
              return { ok: false, error: "Icon must be under 2 MB." };
            }
            const key = iconStorageKey(organizationId, id("icon"));
            const bytes = Buffer.from(await file.arrayBuffer());
            try {
              await putObject(key, bytes, file.type);
              o.icon = { ...o.icon, url: key };
            } catch (err) {
              console.error("Icon upload failed", err);
              return { ok: false, error: "Icon upload failed. Try again." };
            }
          } else {
            // No file provided for this pending marker — fall back to preset.
            o.icon = { source: "preset", tint: o.icon.tint, circle: o.icon.circle };
          }
        }
      }
    }
  }

  // Derive a v2 printerLayout from the idle screen for rollback safety.
  const printerLayout = printerConfig
    ? {
        version: 2 as const,
        clockTimezone: printerConfig.clockTimezone,
        clock24h: printerConfig.clock24h,
        wifiLevel: printerConfig.wifiLevel,
        objects: printerConfig.screens.idle.objects,
      }
    : undefined;

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

  // Capture current state for cleanup (logo key and previous icon keys).
  let previousLogoKey: string | null = null;
  const previousIconKeys = new Set<string>();
  if (logoUrlUpdate !== undefined || printerConfig !== undefined) {
    const [existing] = await db
      .select({
        logoUrl: tenantSettings.logoUrl,
        printerScreens: tenantSettings.printerScreens,
        printerLayout: tenantSettings.printerLayout,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, organizationId))
      .limit(1);

    if (logoUrlUpdate !== undefined) {
      previousLogoKey = existing?.logoUrl ?? null;
    }

    if (printerConfig !== undefined && existing) {
      const prevConfig = normalizePrinterConfig(existing.printerScreens ?? existing.printerLayout);
      for (const screen of PRINTER_SCREENS) {
        for (const o of prevConfig.screens[screen].objects) {
          if (o.type === "icon" && o.icon?.source === "upload" && o.icon.url) {
            previousIconKeys.add(o.icon.url);
          }
        }
      }
    }
  }

  // --- Upsert tenant_settings --------------------------------------------
  const now = new Date();
  await db
    .insert(tenantSettings)
    .values({
      organizationId,
      brandColor,
      brandBg,
      brandFg,
      brandMuted,
      staffPin,
      // Write both v3 (printerScreens) and derived v2 (printerLayout) for rollback safety.
      ...(printerConfig !== undefined ? { printerScreens: printerConfig, printerLayout } : {}),
      ...(logoUrlUpdate !== undefined ? { logoUrl: logoUrlUpdate } : {}),
    })
    .onConflictDoUpdate({
      target: tenantSettings.organizationId,
      set: {
        brandColor,
        brandBg,
        brandFg,
        brandMuted,
        staffPin,
        updatedAt: now,
        ...(printerConfig !== undefined ? { printerScreens: printerConfig, printerLayout } : {}),
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

  // --- Clean up orphaned icon objects (best-effort) ----------------------
  // Keys that were in the previous config but are absent from the new one.
  if (printerConfig !== undefined) {
    const newIconKeys = new Set<string>();
    for (const screen of PRINTER_SCREENS) {
      for (const o of printerConfig.screens[screen].objects) {
        if (o.type === "icon" && o.icon?.source === "upload" && o.icon.url) {
          newIconKeys.add(o.icon.url);
        }
      }
    }
    const orphaned = [...previousIconKeys].filter((k) => !newIconKeys.has(k));
    await Promise.all(orphaned.map((k) => deleteObject(k)));
  }

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.brandingUpdated,
  });

  revalidatePath("/tenant/branding");
  revalidatePath("/tenant");

  // Nudge this org's devices to re-pull their display config. Best-effort: a
  // failed enqueue must not fail a save that already committed — devices also
  // reconcile via their next poll / ETag check.
  try {
    await enqueueConfigChangedForOrg(organizationId, ctx.user.id);
  } catch (err) {
    console.error("config-changed enqueue failed (devices reconcile on next poll)", err);
  }

  return { ok: true };
}
