// GET /api/device/config — device fetches its display config (device key auth).
// Doubles as a heartbeat (bumps lastSeenAt). Honors If-None-Match → 304.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { authenticateDevice } from "@/lib/device-auth";
import { getDeviceConfig } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) return NextResponse.json({ error: "Unknown or missing device key" }, { status: 401 });

  const ifNoneMatch = req.headers.get("if-none-match");
  const { version, notModified, payload } = await getDeviceConfig(device.organizationId, ifNoneMatch);

  // Heartbeat: bump lastSeenAt + mark online (unless paused).
  const now = new Date();
  await db
    .update(deviceTable)
    .set({ lastSeenAt: now, ...(device.status === "paused" ? {} : { status: "online" }) })
    .where(eq(deviceTable.id, device.id));

  if (notModified) {
    return new NextResponse(null, { status: 304, headers: { ETag: `"${version}"` } });
  }
  return NextResponse.json(payload, {
    status: 200,
    headers: { ETag: `"${version}"`, "Cache-Control": "no-cache" },
  });
}
