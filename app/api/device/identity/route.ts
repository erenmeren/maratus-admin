// GET /api/device/identity — device-key auth. The one thing a device cannot learn
// over MQTT: which device it is, and where the broker is. Both are needed to open
// the MQTT connection in the first place, so this stays on HTTPS alongside the
// claim bootstrap. Called once per device lifetime — and again only if NVS is
// wiped — never on a timer.

import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/device-auth";
import { buildMqttConfigBlock } from "@/lib/mqtt";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) return NextResponse.json({ error: "Unknown or missing device key" }, { status: 401 });
  const mqtt = await buildMqttConfigBlock(device.id);
  return NextResponse.json({ deviceId: device.id, mqtt: mqtt ?? null });
}
