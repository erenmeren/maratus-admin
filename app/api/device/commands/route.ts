// GET /api/device/commands — device polls for pending commands (device key).
// Doubles as a heartbeat: bumps lastSeenAt + app version, returns + delivers.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand } from "@/lib/db/schema";
import { authenticateDevice } from "@/lib/device-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) return NextResponse.json({ error: "Unknown or missing device key" }, { status: 401 });

  const now = new Date();
  const version = req.headers.get("x-device-version");
  await db
    .update(deviceTable)
    .set({
      lastSeenAt: now,
      ...(device.status === "paused" ? {} : { status: "online" }),
      ...(version ? { appVersion: version } : {}),
    })
    .where(eq(deviceTable.id, device.id));

  const delivered = await db
    .update(deviceCommand)
    .set({ status: "delivered", deliveredAt: now })
    .where(and(eq(deviceCommand.deviceId, device.id), eq(deviceCommand.status, "pending")))
    .returning({ id: deviceCommand.id, type: deviceCommand.type });

  return NextResponse.json({ commands: delivered });
}
