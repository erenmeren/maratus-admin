// POST /api/mqtt/heartbeat — EMQX webhook fired by device hb messages.
// Bumps lastSeenAt + firmware version and republishes any pending command older
// than ~1 minute, bounding a lost publish to one heartbeat interval.

import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand } from "@/lib/db/schema";
import { mqttEnabled, verifyWebhookSecret, parseHeartbeatPayload, publishCommand } from "@/lib/mqtt";

export const runtime = "nodejs";

const REPUBLISH_AFTER_MS = 60_000;

export async function POST(req: Request) {
  if (!mqttEnabled()) return NextResponse.json({ error: "MQTT disabled" }, { status: 503 });
  if (!verifyWebhookSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  const hb = parseHeartbeatPayload(raw);
  const clientid = (raw as { clientid?: unknown }).clientid;
  if (!hb || typeof clientid !== "string" || clientid.length === 0) {
    return NextResponse.json({ error: "Invalid heartbeat payload" }, { status: 400 });
  }

  const now = new Date();
  const [dev] = await db
    .update(deviceTable)
    .set({
      lastSeenAt: now,
      ...(hb.version ? { firmwareVersion: hb.version } : {}),
      // Do not resurrect a paused device.
    })
    .where(eq(deviceTable.id, clientid))
    .returning({ id: deviceTable.id, status: deviceTable.status });
  if (!dev) return NextResponse.json({ error: "Unknown device" }, { status: 404 });

  // Mark online unless paused (separate set to keep the enum-narrowing simple).
  if (dev.status !== "paused") {
    await db.update(deviceTable).set({ status: "online" }).where(eq(deviceTable.id, dev.id));
  }

  // Republish stale pending commands so a lost publish self-heals.
  const stale = await db
    .select({
      id: deviceCommand.id,
      type: deviceCommand.type,
      action: deviceCommand.action,
      payload: deviceCommand.payload,
    })
    .from(deviceCommand)
    .where(
      and(
        eq(deviceCommand.deviceId, dev.id),
        eq(deviceCommand.status, "pending"),
        lt(deviceCommand.createdAt, new Date(now.getTime() - REPUBLISH_AFTER_MS)),
      ),
    );
  for (const cmd of stale) {
    await publishCommand(dev.id, { commandId: cmd.id, type: cmd.type, action: cmd.action, payload: cmd.payload });
  }

  return NextResponse.json({ ok: true, republished: stale.length });
}
