// lib/mqtt-ping.ts
// Per-channel MQTT webhook liveness. Writes are fail-open: a telemetry row must
// never be the reason a device webhook returns non-200 (EMQX deactivates a rule
// whose endpoint keeps failing).

import { db } from "@/lib/db";
import { mqttWebhookPing } from "@/lib/db/schema";

export const MQTT_CHANNELS = ["ack", "heartbeat", "presence", "config-request"] as const;
export type MqttChannel = (typeof MQTT_CHANNELS)[number];

/** Default staleness window: the device heartbeat is every 5 min, so 20 min is
 *  four missed beats — long enough to avoid false alarms, short enough to catch
 *  a misconfigured rule the same session it was created. */
export const STALE_MINUTES = 20;

export function channelHealth(
  lastAt: Date | null,
  now: Date,
  staleMinutes = STALE_MINUTES,
): "never" | "stale" | "ok" {
  if (!lastAt) return "never";
  return now.getTime() - lastAt.getTime() > staleMinutes * 60_000 ? "stale" : "ok";
}

/** Record that `channel` just received a webhook. Never throws. */
export async function recordWebhookPing(
  channel: MqttChannel,
  deviceId: string | null,
): Promise<void> {
  try {
    await db
      .insert(mqttWebhookPing)
      .values({ channel, lastAt: new Date(), lastDeviceId: deviceId })
      .onConflictDoUpdate({
        target: mqttWebhookPing.channel,
        set: { lastAt: new Date(), lastDeviceId: deviceId },
      });
  } catch (err) {
    console.error("[mqtt-ping] upsert failed", { channel, err });
  }
}

export async function getWebhookPings(): Promise<
  { channel: string; lastAt: Date | null; lastDeviceId: string | null }[]
> {
  return db.select().from(mqttWebhookPing);
}
