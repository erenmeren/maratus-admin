// POST /api/device/commands/ack — device acknowledges a command (device key).
// Body: { commandId: string, ok: boolean, result?: string }

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deviceCommand } from "@/lib/db/schema";
import { authenticateDevice } from "@/lib/device-auth";

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

  await db
    .update(deviceCommand)
    .set({ status: body.ok ? "acked" : "failed", ackedAt: new Date(), result: body.result ?? null })
    .where(and(eq(deviceCommand.id, body.commandId), eq(deviceCommand.deviceId, device.id)));

  return NextResponse.json({ ok: true });
}
