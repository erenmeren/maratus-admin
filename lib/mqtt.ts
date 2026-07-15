// lib/mqtt.ts
// EMQX / MQTT device transport helpers. Pure and testable except publishCommand,
// which performs the single outbound HTTP publish. Everything gates on
// mqttEnabled(): with the EMQX env group absent, the whole module is inert and
// the device transport falls back to HTTP polling.

import { env } from "@/lib/env";

export type MqttCommand = {
  commandId: string;
  type: string;
  action: string | null;
  payload: unknown;
};

/** True only when every required EMQX var is present. */
export function mqttEnabled(): boolean {
  return Boolean(
    env.EMQX_API_URL &&
      env.EMQX_API_KEY &&
      env.EMQX_API_SECRET &&
      env.EMQX_WEBHOOK_SECRET &&
      env.MQTT_BROKER_HOST,
  );
}

/** The `mqtt` block for /api/device/config, or null when disabled. The device
 *  authenticates to the broker with its own device key as the MQTT password
 *  (username = deviceId), so no secret is carried here. */
export async function buildMqttConfigBlock(deviceId: string): Promise<{
  host: string;
  port: number;
  clientId: string;
  username: string;
} | null> {
  if (!mqttEnabled()) return null;
  return {
    host: env.MQTT_BROKER_HOST as string,
    port: Number(env.MQTT_BROKER_PORT ?? 8883),
    clientId: deviceId,
    username: deviceId,
  };
}

/** Build the EMQX HTTP Publish API request for a device command (QoS 1). */
export function buildPublishRequest(
  deviceId: string,
  cmd: MqttCommand,
): { url: string; headers: Record<string, string>; body: string } {
  const base = (env.EMQX_API_URL as string).replace(/\/$/, "");
  const auth = Buffer.from(`${env.EMQX_API_KEY}:${env.EMQX_API_SECRET}`).toString("base64");
  return {
    url: `${base}/publish`,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic: `d/${deviceId}/cmd`,
      qos: 1,
      payload_encoding: "plain",
      payload: JSON.stringify(cmd),
    }),
  };
}

function emqxAuthUsersBase(): string {
  return `${(env.EMQX_API_URL as string).replace(/\/$/, "")}/authentication/password_based:built_in_database/users`;
}

function emqxAuthHeader(): string {
  return `Basic ${Buffer.from(`${env.EMQX_API_KEY}:${env.EMQX_API_SECRET}`).toString("base64")}`;
}

/** Provision (or update) the device's built-in-DB MQTT credential. Idempotent:
 *  a 409 (user exists) updates the password via PUT. No-op false when disabled. */
export async function provisionDeviceMqtt(deviceId: string, mqttPassword: string): Promise<boolean> {
  if (!mqttEnabled()) return false;
  const usersUrl = emqxAuthUsersBase();
  const headers = { Authorization: emqxAuthHeader(), "Content-Type": "application/json" };
  try {
    const res = await fetch(usersUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: deviceId, password: mqttPassword, is_superuser: false }),
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return true;
    if (res.status === 409) {
      const upd = await fetch(`${usersUrl}/${deviceId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ password: mqttPassword }),
        signal: AbortSignal.timeout(2000),
      });
      if (!upd.ok) {
        console.error("mqtt provision failed", { deviceId, status: upd.status });
      }
      return upd.ok;
    }
    console.error("mqtt provision failed", { deviceId, status: res.status });
    return false;
  } catch (err) {
    console.error("mqtt provision failed", { deviceId, err });
    return false;
  }
}

/** Delete the device's built-in-DB MQTT credential. 404 (already gone) is
 *  treated as success. No-op false when disabled. */
export async function deprovisionDeviceMqtt(deviceId: string): Promise<boolean> {
  if (!mqttEnabled()) return false;
  try {
    const res = await fetch(`${emqxAuthUsersBase()}/${deviceId}`, {
      method: "DELETE",
      headers: { Authorization: emqxAuthHeader() },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok && res.status !== 404) {
      console.error("mqtt deprovision failed", { deviceId, status: res.status });
    }
    return res.ok || res.status === 404;
  } catch (err) {
    console.error("mqtt deprovision failed", { deviceId, err });
    return false;
  }
}

/** Publish a command to the device's cmd topic. No-op + false when disabled or on failure. */
export async function publishCommand(deviceId: string, cmd: MqttCommand): Promise<boolean> {
  if (!mqttEnabled()) return false;
  const { url, headers, body } = buildPublishRequest(deviceId, cmd);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // fall through to retry / return false
    }
  }
  return false;
}

/** Constant-ish check that the webhook carries our shared secret. */
export function verifyWebhookSecret(req: Request): boolean {
  const configured = env.EMQX_WEBHOOK_SECRET;
  if (!configured) return false;
  return req.headers.get("x-emqx-webhook-secret") === configured;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

export function parseAckPayload(
  raw: unknown,
): { commandId: string; ok: boolean; result: string | null } | null {
  if (!isObject(raw)) return null;
  const commandId = raw.commandId;
  if (typeof commandId !== "string" || commandId.length === 0) return null;
  return {
    commandId,
    ok: raw.ok === true,
    result: typeof raw.result === "string" ? raw.result : null,
  };
}

export function parseHeartbeatPayload(raw: unknown): { version: string | null } | null {
  if (!isObject(raw)) return null;
  return { version: typeof raw.version === "string" ? raw.version : null };
}

export function parsePresencePayload(
  raw: unknown,
): { deviceId: string; connected: boolean } | null {
  if (!isObject(raw)) return null;
  const clientid = raw.clientid;
  const event = raw.event;
  if (typeof clientid !== "string" || clientid.length === 0) return null;
  if (event === "client.connected") return { deviceId: clientid, connected: true };
  if (event === "client.disconnected") return { deviceId: clientid, connected: false };
  return null;
}
