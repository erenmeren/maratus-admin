"use server";

// Server action: persist tenant branding to tenant_settings.
// Only org owners/admins may edit. Uploaded images (layout image objects) are
// stored in R2 (private) under branding/{org}/images/{id}; their keys are
// persisted inside the printerScreens JSON. When images are replaced or removed,
// the previous R2 objects are deleted so no orphans accumulate.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { isValidHex } from "@/lib/color";
import { normalizePrinterConfig, PRINTER_SCREENS, type PrinterConfig } from "@/lib/printer-layout";
import { id } from "@/lib/ids";
import { deleteObject, iconStorageKey, imageStorageKey, putObject } from "@/lib/storage";
import { normalizeUploadImage } from "@/lib/image";
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
            let bytes: Buffer;
            try {
              bytes = await normalizeUploadImage(Buffer.from(await file.arrayBuffer()));
            } catch {
              return { ok: false, error: "Couldn't process that icon — try a PNG or JPEG." };
            }
            const key = iconStorageKey(organizationId, id("icon"));
            try {
              await putObject(key, bytes, "image/png");
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

  // Process newly-uploaded image files. The client sets image.url = "pending:<objectId>"
  // and sends the file under "image:<objectId>". Rewrite urls to the stored R2 key.
  if (printerConfig !== undefined) {
    for (const screen of PRINTER_SCREENS) {
      for (const o of printerConfig.screens[screen].objects) {
        if (o.type === "image" && o.image?.url?.startsWith("pending:")) {
          const objectId = o.image.url.slice("pending:".length);
          const file = formData.get(`image:${objectId}`);
          if (file instanceof File && file.size > 0) {
            if (!file.type.startsWith("image/")) {
              return { ok: false, error: "Image must be an image file." };
            }
            if (file.size > MAX_LOGO_BYTES) {
              return { ok: false, error: "Image must be under 2 MB." };
            }
            let bytes: Buffer;
            try {
              bytes = await normalizeUploadImage(Buffer.from(await file.arrayBuffer()));
            } catch {
              return { ok: false, error: "Couldn't process that image — try a PNG or JPEG." };
            }
            const key = imageStorageKey(organizationId, id("image"));
            try {
              await putObject(key, bytes, "image/png");
              o.image = { url: key };
            } catch (err) {
              console.error("Image upload failed", err);
              return { ok: false, error: "Image upload failed. Try again." };
            }
          } else {
            // No file for this pending marker — drop the (empty) image object so no
            // dangling "pending:" url is persisted.
            o.image = {};
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

  // Capture current state for cleanup (previous icon keys and image keys).
  const previousIconKeys = new Set<string>();
  const previousImageKeys = new Set<string>();
  if (printerConfig !== undefined) {
    const [existing] = await db
      .select({
        printerScreens: tenantSettings.printerScreens,
        printerLayout: tenantSettings.printerLayout,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, organizationId))
      .limit(1);

    if (printerConfig !== undefined && existing) {
      const prevConfig = normalizePrinterConfig(existing.printerScreens ?? existing.printerLayout);
      for (const screen of PRINTER_SCREENS) {
        for (const o of prevConfig.screens[screen].objects) {
          if (o.type === "icon" && o.icon?.source === "upload" && o.icon.url) {
            previousIconKeys.add(o.icon.url);
          }
          if (o.type === "image" && o.image?.url) {
            previousImageKeys.add(o.image.url);
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
      // Write both v3 (printerScreens) and derived v2 (printerLayout) for rollback safety.
      ...(printerConfig !== undefined ? { printerScreens: printerConfig, printerLayout } : {}),
    })
    .onConflictDoUpdate({
      target: tenantSettings.organizationId,
      set: {
        brandColor,
        brandBg,
        brandFg,
        brandMuted,
        updatedAt: now,
        ...(printerConfig !== undefined ? { printerScreens: printerConfig, printerLayout } : {}),
      },
    });

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

  // --- Clean up orphaned image objects (best-effort) ---------------------
  // Keys that were in the previous config but are absent from the new one.
  if (printerConfig !== undefined) {
    const newImageKeys = new Set<string>();
    for (const screen of PRINTER_SCREENS) {
      for (const o of printerConfig.screens[screen].objects) {
        if (o.type === "image" && o.image?.url) newImageKeys.add(o.image.url);
      }
    }
    const orphaned = [...previousImageKeys].filter((k) => !newImageKeys.has(k));
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
