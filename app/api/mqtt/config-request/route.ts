// POST /api/mqtt/config-request — EMQX webhook fired when a device publishes to
// d/{id}/cfg/get (once per boot/reconnect). The cloud answers by publishing the
// device's full, freshly-presigned config on its cmd topic. This replaces
// GET /api/device/config: the device asks over MQTT and never over HTTP.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand } from "@/lib/db/schema";
import { mqttEnabled, verifyWebhookSecret, parseConfigRequestPayload } from "@/lib/mqtt";
import { publishConfigCommand } from "@/lib/mqtt-push";
import { recordWebhookPing } from "@/lib/mqtt-ping";
import { id as genId } from "@/lib/ids";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!mqttEnabled()) return NextResponse.json({ error: "MQTT disabled" }, { status: 503 });
  if (!verifyWebhookSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Text first so a misconfigured rule body template can be logged verbatim.
  const bodyText = await req.text();
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    console.error("[mqtt/config-request] malformed body:", bodyText.slice(0, 300));
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  // Identity from the AUTHENTICATED username: the x-device-id header set by the
  // rule, else a clientid body field. Never a device-supplied field.
  const headerId = req.headers.get("x-device-id")?.trim();
  const parsed = parseConfigRequestPayload(raw);
  const deviceId = headerId && headerId.length > 0 ? headerId : parsed?.deviceId ?? "";
  if (deviceId.length === 0) {
    console.error("[mqtt/config-request] missing device id:", bodyText.slice(0, 300));
    return NextResponse.json({ error: "Missing device id" }, { status: 400 });
  }

  const [dev] = await db
    .select({
      id: deviceTable.id,
      organizationId: deviceTable.organizationId,
      storeId: deviceTable.storeId,
      pinMode: deviceTable.pinMode,
      pinnedUrl: deviceTable.pinnedUrl,
      status: deviceTable.status,
    })
    .from(deviceTable)
    .where(eq(deviceTable.id, deviceId))
    .limit(1);
  if (!dev) return NextResponse.json({ error: "Unknown device" }, { status: 404 });

  await recordWebhookPing("config-request", dev.id);

  // A request also proves liveness — the device just published to the broker.
  const now = new Date();
  await db
    .update(deviceTable)
    .set({ lastSeenAt: now, ...(dev.status === "paused" ? {} : { status: "online" as const }) })
    .where(eq(deviceTable.id, dev.id));

  // Row first (payload NULL — never store the presigned config), then publish.
  // If the publish fails the row stays pending and the heartbeat republish
  // rebuilds it, so a lost answer self-heals within one heartbeat.
  const commandId = genId("cmd");
  await db.insert(deviceCommand).values({
    id: commandId,
    deviceId: dev.id,
    organizationId: dev.organizationId,
    type: "config-changed",
    status: "pending",
  });
  const published = await publishConfigCommand(dev, commandId);

  return NextResponse.json({ ok: true, published });
}
