// GET /api/device/config — device fetches its display config (device key auth).
// Doubles as a heartbeat (bumps lastSeenAt). Honors If-None-Match → 304.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, store as storeTable, tenantSettings } from "@/lib/db/schema";
import { authenticateDevice } from "@/lib/device-auth";
import { getDeviceConfig } from "@/lib/data";
import { buildMqttConfigBlock } from "@/lib/mqtt";
import { resolveEffectivePin } from "@/lib/pin-resolve";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) return NextResponse.json({ error: "Unknown or missing device key" }, { status: 401 });

  // Effective pin: device > store > tenant (lib/pin-resolve.ts). The device
  // only ever sees the resolved URL. pinnedUrl/pinMode/storeId come from the
  // authenticated device row.
  const [storeRow, [ts]] = await Promise.all([
    device.storeId
      ? db
          .select({ pinMode: storeTable.pinMode, pinnedUrl: storeTable.pinnedUrl })
          .from(storeTable)
          .where(eq(storeTable.id, device.storeId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select({ pinnedUrl: tenantSettings.pinnedUrl })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, device.organizationId)),
  ]);
  const effective = resolveEffectivePin({
    device: { pinMode: device.pinMode, pinnedUrl: device.pinnedUrl },
    store: storeRow,
    tenant: { pinnedUrl: ts?.pinnedUrl ?? null },
  });

  const ifNoneMatch = req.headers.get("if-none-match");
  const { version, notModified, payload } = await getDeviceConfig(
    device.organizationId,
    ifNoneMatch,
    { url: effective.url },
  );

  // Heartbeat: bump lastSeenAt + mark online (unless paused).
  const now = new Date();
  await db
    .update(deviceTable)
    .set({ lastSeenAt: now, ...(device.status === "paused" ? {} : { status: "online" }) })
    .where(eq(deviceTable.id, device.id));

  if (notModified) {
    return new NextResponse(null, { status: 304, headers: { ETag: `"${version}"` } });
  }
  const mqtt = await buildMqttConfigBlock(device.id);
  return NextResponse.json(
    { ...payload, ...(mqtt ? { mqtt } : {}) },
    { status: 200, headers: { ETag: `"${version}"`, "Cache-Control": "no-cache" } },
  );
}
