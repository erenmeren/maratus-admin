// POST /api/mqtt/ack — EMQX Data-Integration webhook for device command acks.
// Mirrors app/api/device/commands/ack/route.ts but authenticates via the shared
// webhook secret (the device already proved itself to the broker via JWT).

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
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

  const clientid = (raw as { clientid?: unknown }).clientid;
  if (typeof clientid !== "string" || clientid.length === 0) {
    return NextResponse.json({ error: "Invalid ack payload" }, { status: 400 });
  }

  const now = new Date();
  const nextStatus = ack.ok ? "acked" : "failed";
  // Scope by deviceId (from the broker-injected clientid, NOT the payload) so a
  // device can only ack its own commands — commandId alone is device-controlled
  // and would let one device (and its tenant) ack/cancel another's command.
  // Guard on "pending" OR "delivered": a command may already have been marked
  // delivered by an HTTP poll during a transport switch, so an MQTT ack must
  // still be honored in that state. The deviceId scope plus this being a
  // terminal-status transition (pending/delivered -> acked/failed) keeps it
  // idempotent — a second ack over either transport just no-ops.
  const [cmd] = await db
    .update(deviceCommand)
    .set({ status: nextStatus, ackedAt: now, result: ack.result })
    .where(
      and(
        eq(deviceCommand.id, ack.commandId),
        eq(deviceCommand.deviceId, clientid),
        inArray(deviceCommand.status, ["pending", "delivered"]),
      ),
    )
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
