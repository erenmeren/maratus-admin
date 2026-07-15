// POST /api/mqtt/ack — EMQX Data-Integration webhook for device command acks.
// Mirrors app/api/device/commands/ack/route.ts but authenticates via the shared
// webhook secret (the device already proved itself to the broker via JWT).

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deviceCommand } from "@/lib/db/schema";
import { mqttEnabled, verifyWebhookSecret, parseAckPayload } from "@/lib/mqtt";
import { applyTriggerAck } from "@/lib/trigger-ack";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!mqttEnabled()) return NextResponse.json({ error: "MQTT disabled" }, { status: 503 });
  if (!verifyWebhookSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  const ack = parseAckPayload(raw);
  if (!ack) return NextResponse.json({ error: "Invalid ack payload" }, { status: 400 });

  const now = new Date();
  const nextStatus = ack.ok ? "acked" : "failed";
  // Guard on "pending" OR "delivered": MQTT commands stay pending (never marked
  // delivered), while a command that also went out over HTTP polling may be
  // delivered. Either way, the first ack wins; a duplicate is a no-op.
  const [cmd] = await db
    .update(deviceCommand)
    .set({ status: nextStatus, ackedAt: now, result: ack.result })
    .where(and(eq(deviceCommand.id, ack.commandId), eq(deviceCommand.status, "pending")))
    .returning({
      id: deviceCommand.id,
      type: deviceCommand.type,
      action: deviceCommand.action,
      organizationId: deviceCommand.organizationId,
      deviceId: deviceCommand.deviceId,
      billing: deviceCommand.billing,
    });

  if (cmd) await applyTriggerAck(cmd, ack.ok);

  return NextResponse.json({ ok: true });
}
