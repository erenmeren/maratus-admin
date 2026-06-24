// One-time: convert each org's `logo` layout widgets into `image` objects pointing
// at the org's existing uploaded logo (tenant_settings.logoUrl), then clear logoUrl.
// Orgs with no uploaded logo are left unchanged (their logo widget renders the
// wordmark). Idempotent: re-running finds no remaining logoUrl and is a no-op.
//   npx tsx lib/db/migrate-logo-to-image.ts
import "./load-env"; // must be first: loads env before ../db reads it
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { tenantSettings } from "./schema";
import { normalizePrinterConfig, PRINTER_SCREENS } from "../printer-layout";

async function main() {
  const rows = await db
    .select({
      organizationId: tenantSettings.organizationId,
      logoUrl: tenantSettings.logoUrl,
      printerScreens: tenantSettings.printerScreens,
      printerLayout: tenantSettings.printerLayout,
    })
    .from(tenantSettings)
    .where(isNotNull(tenantSettings.logoUrl));

  let updated = 0;
  for (const r of rows) {
    if (!r.logoUrl) continue;
    const cfg = normalizePrinterConfig(r.printerScreens ?? r.printerLayout);
    for (const screen of PRINTER_SCREENS) {
      cfg.screens[screen].objects = cfg.screens[screen].objects.map((o) =>
        o.type === "logo"
          ? { id: o.id, type: "image", x: o.x, y: o.y, w: o.w, h: o.h, visible: o.visible, z: o.z, image: { url: r.logoUrl! } }
          : o,
      );
    }
    const printerLayout = {
      version: 2 as const,
      clockTimezone: cfg.clockTimezone,
      clock24h: cfg.clock24h,
      wifiLevel: cfg.wifiLevel,
      objects: cfg.screens.idle.objects,
    };
    await db
      .update(tenantSettings)
      .set({ printerScreens: cfg, printerLayout, logoUrl: null })
      .where(eq(tenantSettings.organizationId, r.organizationId));
    updated++;
  }
  console.log(`Migrated logo→image for ${updated} org(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
