// POST /api/mqtt/config-request — EMQX webhook fired when a device publishes to
// d/{id}/cfg/get (once per boot/reconnect). The cloud answers by publishing the
// device's full, freshly-presigned config on its cmd topic. This replaces
// GET /api/device/config: the device asks over MQTT and never over HTTP.

import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
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
    })
    .from(deviceTable)
    .where(eq(deviceTable.id, deviceId))
    .limit(1);
  // A device row can disappear while its EMQX credential survives:
  // deprovisionDeviceMqtt is best-effort (lib/mqtt.ts). A 404 here would repeat
  // on every boot/reconnect of that ghost client and risk EMQX deactivating a
  // rule that serves the whole fleet — so log it and answer 200.
  if (!dev) {
    console.warn("[mqtt/config-request] unknown device (stale EMQX credential?):", deviceId);
    return NextResponse.json({ ok: true, unknownDevice: true });
  }

  await recordWebhookPing("config-request", dev.id);

  // A request also proves liveness — the device just published to the broker.
  const now = new Date();
  // Atomic in-DB decision: never resurrect a paused device, even under
  // concurrent writes (no stale JS-side status read driving this write).
  await db
    .update(deviceTable)
    .set({
      lastSeenAt: now,
      status: sql`CASE WHEN ${deviceTable.status} = 'paused' THEN ${deviceTable.status} ELSE 'online' END`,
    })
    .where(eq(deviceTable.id, dev.id));

  // Row first (payload NULL — never store the presigned config), then publish.
  // If the publish fails the row stays pending and the heartbeat republish
  // rebuilds it, so a lost answer self-heals within one heartbeat.
  //
  // Fail-open like recordWebhookPing: building a config touches several tables
  // and presigns R2 URLs, and EMQX deactivates a rule whose endpoint keeps
  // failing. A throw here would cost the fleet its config channel, while
  // answering 200 costs one boot's config — the device asks again next boot and
  // the heartbeat republish covers the pending row in the meantime.
  let published = false;
  try {
    const commandId = genId("cmd");
    await db.insert(deviceCommand).values({
      id: commandId,
      deviceId: dev.id,
      organizationId: dev.organizationId,
      type: "config-changed",
      status: "pending",
    });
    published = await publishConfigCommand(dev, commandId);
  } catch (err) {
    console.error("[mqtt/config-request] answer failed (device retries next boot)", {
      deviceId: dev.id,
      err,
    });
  }

  return NextResponse.json({ ok: true, published });
}
