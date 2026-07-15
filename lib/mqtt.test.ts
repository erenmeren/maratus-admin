import { describe, it, expect, beforeEach, vi } from "vitest";

// We control env per-test by stubbing the env module.
const ENV: Record<string, string | number | undefined> = {};
vi.mock("@/lib/env", () => ({
  env: new Proxy({}, { get: (_t, p: string) => ENV[p] }),
  getEnv: () => ENV,
}));

import {
  mqttEnabled,
  mintDeviceMqttJwt,
  buildMqttConfigBlock,
  buildPublishRequest,
  verifyWebhookSecret,
  parseAckPayload,
  parseHeartbeatPayload,
  parsePresencePayload,
} from "./mqtt";
import { jwtVerify } from "jose";

const FULL = {
  EMQX_API_URL: "https://broker.example.com:8443/api/v5",
  EMQX_API_KEY: "key",
  EMQX_API_SECRET: "secret",
  EMQX_WEBHOOK_SECRET: "hook-secret",
  MQTT_JWT_SECRET: "jwt-secret-jwt-secret-jwt-secret!",
  MQTT_BROKER_HOST: "broker.example.com",
  MQTT_BROKER_PORT: 8883,
};

beforeEach(() => {
  for (const k of Object.keys(ENV)) delete ENV[k];
});

describe("mqttEnabled", () => {
  it("is false when the group is absent", () => {
    expect(mqttEnabled()).toBe(false);
  });
  it("is true only when all required vars are present", () => {
    Object.assign(ENV, FULL);
    expect(mqttEnabled()).toBe(true);
  });
  it("is false when one required var is missing", () => {
    Object.assign(ENV, { ...FULL, MQTT_JWT_SECRET: undefined });
    expect(mqttEnabled()).toBe(false);
  });
});

describe("mintDeviceMqttJwt", () => {
  it("signs a JWT with the deviceId subject and per-device ACL claims", async () => {
    Object.assign(ENV, FULL);
    const token = await mintDeviceMqttJwt("dev_123");
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(FULL.MQTT_JWT_SECRET),
    );
    expect(payload.sub).toBe("dev_123");
    // EMQX JWT ACL claim shape: acl.{sub|pub} arrays of allowed topics.
    expect(payload.acl).toMatchObject({
      sub: ["d/dev_123/cmd"],
      pub: ["d/dev_123/ack", "d/dev_123/hb"],
    });
    expect(typeof payload.exp).toBe("number");
  });
});

describe("buildMqttConfigBlock", () => {
  it("returns null when disabled", async () => {
    expect(await buildMqttConfigBlock("dev_1")).toBeNull();
  });
  it("returns host/port/clientId/username/password when enabled", async () => {
    Object.assign(ENV, FULL);
    const block = await buildMqttConfigBlock("dev_1");
    expect(block).toMatchObject({
      host: "broker.example.com",
      port: 8883,
      clientId: "dev_1",
      username: "dev_1",
    });
    expect(typeof block!.password).toBe("string");
    expect(block!.password.split(".")).toHaveLength(3); // JWT
  });
});

describe("buildPublishRequest", () => {
  it("targets the EMQX publish endpoint with QoS 1 and the device topic", () => {
    Object.assign(ENV, FULL);
    const cmd = { commandId: "cmd_1", type: "trigger", action: "show_qr", payload: { url: "https://x" } };
    const reqData = buildPublishRequest("dev_9", cmd);
    expect(reqData.url).toBe("https://broker.example.com:8443/api/v5/publish");
    expect(reqData.headers.Authorization).toMatch(/^Basic /);
    expect(reqData.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(reqData.body);
    expect(body).toMatchObject({ topic: "d/dev_9/cmd", qos: 1, payload_encoding: "plain" });
    expect(JSON.parse(body.payload)).toEqual(cmd);
  });
});

describe("verifyWebhookSecret", () => {
  it("accepts a matching header", () => {
    Object.assign(ENV, FULL);
    const req = new Request("https://x", { headers: { "x-emqx-webhook-secret": "hook-secret" } });
    expect(verifyWebhookSecret(req)).toBe(true);
  });
  it("rejects a missing or wrong header", () => {
    Object.assign(ENV, FULL);
    expect(verifyWebhookSecret(new Request("https://x"))).toBe(false);
    expect(verifyWebhookSecret(new Request("https://x", { headers: { "x-emqx-webhook-secret": "nope" } }))).toBe(false);
  });
  it("rejects everything when no secret is configured", () => {
    const req = new Request("https://x", { headers: { "x-emqx-webhook-secret": "" } });
    expect(verifyWebhookSecret(req)).toBe(false);
  });
});

describe("parseAckPayload", () => {
  it("parses a valid ack", () => {
    expect(parseAckPayload({ commandId: "c1", ok: true, result: "done" })).toEqual({ commandId: "c1", ok: true, result: "done" });
  });
  it("defaults result to null and coerces missing ok to false", () => {
    expect(parseAckPayload({ commandId: "c1", ok: false })).toEqual({ commandId: "c1", ok: false, result: null });
  });
  it("rejects payloads without a commandId", () => {
    expect(parseAckPayload({ ok: true })).toBeNull();
    expect(parseAckPayload("nope")).toBeNull();
  });
});

describe("parseHeartbeatPayload", () => {
  it("parses a version and defaults it to null", () => {
    expect(parseHeartbeatPayload({ version: "2.13.0" })).toEqual({ version: "2.13.0" });
    expect(parseHeartbeatPayload({})).toEqual({ version: null });
  });
  it("rejects non-objects", () => {
    expect(parseHeartbeatPayload(null)).toBeNull();
  });
});

describe("parsePresencePayload", () => {
  it("maps EMQX client.connected event", () => {
    expect(parsePresencePayload({ event: "client.connected", clientid: "dev_5" })).toEqual({ deviceId: "dev_5", connected: true });
  });
  it("maps EMQX client.disconnected event", () => {
    expect(parsePresencePayload({ event: "client.disconnected", clientid: "dev_5" })).toEqual({ deviceId: "dev_5", connected: false });
  });
  it("rejects events without a clientid", () => {
    expect(parsePresencePayload({ event: "client.connected" })).toBeNull();
  });
});
