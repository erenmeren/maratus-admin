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
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Both limits sit far above what firmware can legitimately produce, because
// this is the route a stranded device repairs itself through — throttling a
// real device here would be the failure it is meant to fix. The firmware asks
// once per boot and, when MQTT stays down, at most once per ~6 minutes (Task
// D2 pairs a 6-failure count with a 5-minute floor). What the limits do stop
// is a *stolen* device key replayed in a loop: every authenticated call writes
// an EMQX credential, so an unthrottled flood is an amplifier pointed at the
// broker's admin API. checkRateLimit fails open on a DB fault, which keeps the
// repair path alive even when the limiter itself is broken.
const IP_LIMIT = { limit: 60, windowMs: 60_000 };
const DEVICE_LIMIT = { limit: 20, windowMs: 60_000 };

function tooMany(retryAfterMs: number) {
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "retry-after": String(Math.ceil(retryAfterMs / 1000)) } },
  );
}

export async function GET(req: Request) {
  // Before authentication: an unauthenticated caller still costs a device-key
  // hash + lookup, and the 401 path is the one an attacker probing keys hits.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipRl = await checkRateLimit(`identity-ip:${ip}`, IP_LIMIT);
  if (!ipRl.allowed) return tooMany(ipRl.retryAfterMs);

  const device = await authenticateDevice(req);
  if (!device) return NextResponse.json({ error: "Unknown or missing device key" }, { status: 401 });

  // After authentication, before the EMQX write below — the credential
  // re-provision is the expensive side effect this bounds.
  const deviceRl = await checkRateLimit(`identity:${device.id}`, DEVICE_LIMIT);
  if (!deviceRl.allowed) return tooMany(deviceRl.retryAfterMs);

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
