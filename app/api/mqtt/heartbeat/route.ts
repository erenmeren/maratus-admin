// POST /api/mqtt/heartbeat — EMQX webhook fired by device hb messages.
// Bumps lastSeenAt + firmware version and republishes any pending command older
// than ~1 minute, bounding a lost publish to one heartbeat interval.

import { NextResponse } from "next/server";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand } from "@/lib/db/schema";
import { mqttEnabled, verifyWebhookSecret, parseHeartbeatPayload, publishCommand } from "@/lib/mqtt";
import {
  republishKindFor,
  publishConfigCommand,
  publishOtaCommand,
  latestFirmwareRelease,
  type PushTarget,
} from "@/lib/mqtt-push";
import { firmwareUpdateAvailable } from "@/lib/device-status";
import { recordWebhookPing } from "@/lib/mqtt-ping";
import { id as genId } from "@/lib/ids";

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
  // Device identity comes from the authenticated MQTT username. Prefer the
  // x-device-id header (lets the EMQX rule forward the raw device payload via
  // ${payload} so every current + future field arrives without a rule edit);
  // fall back to a clientid field in the body for the older rule shape.
  const headerId = req.headers.get("x-device-id")?.trim();
  const bodyId = (raw as { clientid?: unknown }).clientid;
  const clientid =
    headerId && headerId.length > 0
      ? headerId
      : typeof bodyId === "string"
        ? bodyId
        : "";
  if (clientid.length === 0) {
    console.error("[mqtt/heartbeat] missing device id:", bodyText.slice(0, 300));
    return NextResponse.json({ error: "Invalid heartbeat payload" }, { status: 400 });
  }
  await recordWebhookPing("heartbeat", clientid);

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
    .returning({
      id: deviceTable.id,
      organizationId: deviceTable.organizationId,
      storeId: deviceTable.storeId,
      pinMode: deviceTable.pinMode,
      pinnedUrl: deviceTable.pinnedUrl,
      // Post-update value (this same statement just wrote hb.version), so the
      // config push decides on the version the device is running right now.
      firmwareVersion: deviceTable.firmwareVersion,
    });
  // A device row can disappear while its EMQX credential survives:
  // deprovisionDeviceMqtt is best-effort (lib/mqtt.ts). A 404 here would then
  // repeat every five minutes forever and risk EMQX deactivating the rule that
  // carries the WHOLE fleet's liveness — so log it and answer 200.
  if (!dev) {
    console.warn("[mqtt/heartbeat] unknown device (stale EMQX credential?):", clientid);
    return NextResponse.json({ ok: true, unknownDevice: true });
  }

  // Both reconciliation blocks are fail-open, exactly like recordWebhookPing:
  // this is the fleet's liveness channel and its highest-frequency route, and
  // EMQX deactivates a rule whose endpoint keeps failing. A DB or presign
  // failure degrades to "not republished this beat" — the next heartbeat retries
  // — and never turns the heartbeat itself into a 500.
  const republished = await republishStaleCommands(dev, now);
  const otaQueued = hb.version ? await reconcileOta(dev, hb.version, now) : false;

  return NextResponse.json({ ok: true, republished, otaQueued });
}

/**
 * Republish stale pending commands so a lost publish self-heals — but only within
 * a bounded age window, so an un-acked command can't loop forever. Returns how
 * many were resent; 0 when the attempt failed (never throws).
 */
async function republishStaleCommands(dev: PushTarget, now: Date): Promise<number> {
  try {
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
      switch (republishKindFor(cmd.type)) {
        // Payload-carrying commands are REBUILT, never replayed: the config's
        // image URLs are presigned for 300s and the firmware binary's for 600s,
        // so a stored payload is already dead by the time a republish fires.
        case "config":
          await publishConfigCommand(dev, cmd.id);
          break;
        case "ota":
          await publishOtaCommand(dev.id, cmd.id);
          break;
        case "replay":
          await publishCommand(dev.id, {
            commandId: cmd.id,
            type: cmd.type,
            action: cmd.action,
            payload: cmd.payload,
          });
          break;
      }
    }
    return stale.length;
  } catch (err) {
    // Config rebuilds hit the DB and R2 presigning; either can fail transiently.
    console.error("[mqtt/heartbeat] republish failed (retries next beat)", {
      deviceId: dev.id,
      err,
    });
    return 0;
  }
}

/**
 * OTA reconcile: the hb already reports the running version, so the cloud can
 * notice a device that came back from being powered off during a firmware publish
 * and hand it the manifest now. Returns whether a manifest was published; false
 * when nothing was due or the attempt failed (never throws).
 */
async function reconcileOta(
  dev: { id: string; organizationId: string },
  runningVersion: string,
  now: Date,
): Promise<boolean> {
  try {
    const rel = await latestFirmwareRelease();
    if (!firmwareUpdateAvailable(runningVersion, rel?.version ?? null)) return false;
    // Cooldown, not an in-flight check: ANY firmware-update row for this device
    // inside the window blocks another push, whatever its status. The firmware
    // acks a firmware-update BEFORE starting the OTA (it reboots —
    // ditto-firmware components/cloud/commands.c), so "acked" means "download
    // started", not "installed". Gating on pending/delivered alone therefore
    // never engages on a retry: a download that fails (TLS blip, truncated body,
    // presign expiry) would be re-pushed every heartbeat forever — ~288 rows and
    // ~576 MB of R2 egress per device per day, and a forced re-flash loop if a
    // release's typed version doesn't match the binary's own. Reuses the
    // republish window rather than adding a second tunable for the same "we
    // already tried recently" idea. A genuinely new release is unaffected: its
    // immediate push comes from pushFirmwareToFleet.
    const [recentOta] = await db
      .select({ id: deviceCommand.id })
      .from(deviceCommand)
      .where(
        and(
          eq(deviceCommand.deviceId, dev.id),
          eq(deviceCommand.type, "firmware-update"),
          gt(deviceCommand.createdAt, new Date(now.getTime() - REPUBLISH_UNTIL_MS)),
        ),
      )
      .limit(1);
    if (recentOta) return false;

    const commandId = genId("cmd");
    await db.insert(deviceCommand).values({
      id: commandId,
      deviceId: dev.id,
      organizationId: dev.organizationId,
      type: "firmware-update",
      status: "pending",
    });
    return await publishOtaCommand(dev.id, commandId, rel);
  } catch (err) {
    console.error("[mqtt/heartbeat] OTA reconcile failed (retries next beat)", {
      deviceId: dev.id,
      runningVersion,
      err,
    });
    return false;
  }
}
