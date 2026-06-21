// One-time: copy each org's existing printer-config QR timeout into the new
// qrVisibleSeconds column (default 60 if absent). Idempotent. Run with:
//   npx tsx lib/db/backfill-qr-visible.ts
import "./load-env"; // must be first: loads env before ../db reads it
import { eq } from "drizzle-orm";
import { db } from "../db";
import { tenantSettings } from "./schema";
import { normalizePrinterConfig } from "../printer-layout";
import { normalizeDeviceSettings } from "../device-settings";

async function main() {
  const rows = await db
    .select({
      organizationId: tenantSettings.organizationId,
      printerScreens: tenantSettings.printerScreens,
      printerLayout: tenantSettings.printerLayout,
    })
    .from(tenantSettings);

  let updated = 0;
  for (const r of rows) {
    const cfg = normalizePrinterConfig(r.printerScreens ?? r.printerLayout);
    const qr = normalizeDeviceSettings({ qrVisibleSeconds: cfg.qrTimeoutSeconds }).qrVisibleSeconds;
    await db
      .update(tenantSettings)
      .set({ qrVisibleSeconds: qr })
      .where(eq(tenantSettings.organizationId, r.organizationId));
    updated++;
  }
  console.log(`Backfilled qrVisibleSeconds for ${updated} org(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
