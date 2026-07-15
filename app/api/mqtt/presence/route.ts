// POST /api/mqtt/presence — EMQX client.connected / client.disconnected (incl.
// LWT) webhook. Flips the device online/offline instantly. The health cron
// remains the reconciler for any missed disconnect event.

import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { mqttEnabled, verifyWebhookSecret, parsePresencePayload } from "@/lib/mqtt";

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
  const presence = parsePresencePayload(raw);
  if (!presence) return NextResponse.json({ error: "Invalid presence payload" }, { status: 400 });

  const now = new Date();
  // Atomic in-DB decision: never resurrect a paused device, even under
  // concurrent writes (no stale JS-side status read driving this write).
  const [dev] = presence.connected
    ? await db
        .update(deviceTable)
        .set({
          status: sql`CASE WHEN ${deviceTable.status} = 'paused' THEN ${deviceTable.status} ELSE 'online' END`,
          lastSeenAt: now,
        })
        .where(eq(deviceTable.id, presence.deviceId))
        .returning({ id: deviceTable.id })
    : await db
        .update(deviceTable)
        .set({
          status: sql`CASE WHEN ${deviceTable.status} = 'paused' THEN ${deviceTable.status} ELSE 'offline' END`,
        })
        .where(eq(deviceTable.id, presence.deviceId))
        .returning({ id: deviceTable.id });
  if (!dev) return NextResponse.json({ error: "Unknown device" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
