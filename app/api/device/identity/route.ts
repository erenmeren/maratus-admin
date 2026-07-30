// GET /api/device/identity — device-key auth. The one thing a device cannot learn
// over MQTT: which device it is, and where the broker is. Both are needed to open
// the MQTT connection in the first place, so this stays on HTTPS alongside the
// claim bootstrap. Called once per device lifetime, again if NVS is wiped, and
// again after repeated MQTT connect failures — never on a timer. That last case
// is why this route also doubles as the credential-repair and broker-rediscovery
// path: it is the one place the cloud ever sees a device's raw key again, so it
// is the only place that can rebuild a broker credential a fail-open claim-time
// provision may have missed.

import { NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/device-auth";
import { buildMqttConfigBlock, provisionDeviceMqtt } from "@/lib/mqtt";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) return NextResponse.json({ error: "Unknown or missing device key" }, { status: 401 });

  // Only reachable once authentication has already hashed this same header and
  // matched it to `device` above — re-parse it here (matching authenticateDevice's
  // own parsing) purely to recover the raw key, which authenticateDevice does not
  // return. Claim-time provisioning is fail-open, so a broker hiccup there can
  // leave this device's key rejected by the broker forever, since the raw key is
  // delivered once and only its hash is ever stored. This is the sole place the
  // cloud can still see it, so re-provision on every call: idempotent and cheap.
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const rawKey = match?.[1].trim();
  if (rawKey) {
    const provisioned = await provisionDeviceMqtt(device.id, rawKey);
    if (!provisioned) {
      // Fail-open: the device still needs its id and broker coordinates. If the
      // credential is still wrong, the device's own retry brings it back here.
      console.error("mqtt re-provision failed on identity", { deviceId: device.id });
    }
  }

  const mqtt = await buildMqttConfigBlock(device.id);
  return NextResponse.json({ deviceId: device.id, mqtt: mqtt ?? null });
}
