// POST /api/device/commands/ack — device acknowledges a command (device key).
// Body: { commandId: string, ok: boolean, result?: string }

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deviceCommand } from "@/lib/db/schema";
import { authenticateDevice } from "@/lib/device-auth";
import { applyTriggerAck } from "@/lib/trigger-ack";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) return NextResponse.json({ error: "Unknown or missing device key" }, { status: 401 });

  let body: { commandId?: string; ok?: boolean; result?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  if (!body.commandId) return NextResponse.json({ error: "Missing commandId" }, { status: 400 });

  const now = new Date();
  const nextStatus = body.ok ? "acked" : "failed";
  const [cmd] = await db.update(deviceCommand)
    .set({ status: nextStatus, ackedAt: now, result: body.result ?? null })
    .where(and(eq(deviceCommand.id, body.commandId), eq(deviceCommand.deviceId, device.id), eq(deviceCommand.status, "delivered")))
    .returning({ id: deviceCommand.id, type: deviceCommand.type, action: deviceCommand.action, organizationId: deviceCommand.organizationId, deviceId: deviceCommand.deviceId, billing: deviceCommand.billing });
  if (cmd) await applyTriggerAck(cmd, body.ok === true);

  return NextResponse.json({ ok: true });
}
