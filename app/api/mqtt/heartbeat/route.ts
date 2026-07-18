// POST /api/mqtt/heartbeat — EMQX webhook fired by device hb messages.
// Bumps lastSeenAt + firmware version and republishes any pending command older
// than ~1 minute, bounding a lost publish to one heartbeat interval.

import { NextResponse } from "next/server";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand } from "@/lib/db/schema";
import { mqttEnabled, verifyWebhookSecret, parseHeartbeatPayload, publishCommand } from "@/lib/mqtt";

export const runtime = "nodejs";

const REPUBLISH_AFTER_MS = 60_000;
// Stop resending a command that has gone this long without an ack. Without an
// upper bound, a command whose ack never lands (e.g. a config-changed that the
// device applied but whose ack was lost) is republished on every heartbeat
// forever, making the device re-fetch its config every ~5 min indefinitely.
const REPUBLISH_UNTIL_MS = 15 * 60_000;

export async function POST(req: Request) {
  if (!mqttEnabled()) return NextResponse.json({ error: "MQTT disabled" }, { status: 503 });
  if (!verifyWebhookSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Read as text first so a malformed body can be logged (the EMQX rule's body
  // template is easy to misconfigure — surface the actual payload on rejection).
  const bodyText = await req.text();
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    console.error("[mqtt/heartbeat] malformed body:", bodyText.slice(0, 300));
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  const hb = parseHeartbeatPayload(raw);
  if (!hb) {
    console.error("[mqtt/heartbeat] invalid payload:", bodyText.slice(0, 300));
    return NextResponse.json({ error: "Invalid heartbeat payload" }, { status: 400 });
  }
  const clientid = (raw as { clientid?: unknown }).clientid;
  if (typeof clientid !== "string" || clientid.length === 0) {
    console.error("[mqtt/heartbeat] missing clientid:", bodyText.slice(0, 300));
    return NextResponse.json({ error: "Invalid heartbeat payload" }, { status: 400 });
  }

  // Image-render diagnostics (temporary): surface the device's last asset-fetch
  // status + image render state so a "logo won't show" issue can be pinned to
  // fetch vs decode/render from the runtime logs.
  if (hb.afetch !== null || hb.aimg !== null || hb.cfgimg !== null) {
    console.log(
      `[mqtt/heartbeat] ${clientid} afetch=${hb.afetch} aimg=${hb.aimg} cfgimg=${hb.cfgimg} cfgstat=${hb.cfgstat} cfgparse=${hb.cfgparse}`,
    );
  }

  const now = new Date();
  const [dev] = await db
    .update(deviceTable)
    .set({
      lastSeenAt: now,
      ...(hb.version ? { firmwareVersion: hb.version } : {}),
      // Remote memory-soak telemetry: store the latest free-internal-DRAM reading
      // and track the lowest-ever (worst-case concurrent-TLS peak) atomically.
      ...(hb.heap !== null
        ? {
            lastHeapFree: hb.heap,
            minHeapFree: sql`LEAST(COALESCE(${deviceTable.minHeapFree}, ${hb.heap}), ${hb.heap})`,
          }
        : {}),
      ...(hb.fonts !== null ? { lastFontSlots: hb.fonts } : {}),
      // Atomic in-DB decision: never resurrect a paused device, even under
      // concurrent writes (no stale JS-side status read driving this write).
      status: sql`CASE WHEN ${deviceTable.status} = 'paused' THEN ${deviceTable.status} ELSE 'online' END`,
    })
    .where(eq(deviceTable.id, clientid))
    .returning({ id: deviceTable.id });
  if (!dev) return NextResponse.json({ error: "Unknown device" }, { status: 404 });

  // Republish stale pending commands so a lost publish self-heals — but only
  // within a bounded age window, so an un-acked command can't loop forever.
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
        gt(deviceCommand.createdAt, new Date(now.getTime() - REPUBLISH_UNTIL_MS)),
      ),
    );
  for (const cmd of stale) {
    await publishCommand(dev.id, { commandId: cmd.id, type: cmd.type, action: cmd.action, payload: cmd.payload });
  }

  return NextResponse.json({ ok: true, republished: stale.length });
}
