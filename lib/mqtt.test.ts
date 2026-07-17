import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// We control env per-test by stubbing the env module.
const ENV: Record<string, string | number | undefined> = {};
vi.mock("@/lib/env", () => ({
  env: new Proxy({}, { get: (_t, p: string) => ENV[p] }),
  getEnv: () => ENV,
}));

import {
  mqttEnabled,
  buildMqttConfigBlock,
  buildPublishRequest,
  publishCommand,
  provisionDeviceMqtt,
  deprovisionDeviceMqtt,
  verifyWebhookSecret,
  parseAckPayload,
  parseHeartbeatPayload,
  parsePresencePayload,
} from "./mqtt";

const FULL = {
  EMQX_API_URL: "https://broker.example.com:8443/api/v5",
  EMQX_API_KEY: "key",
  EMQX_API_SECRET: "secret",
  EMQX_WEBHOOK_SECRET: "hook-secret",
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
    Object.assign(ENV, { ...FULL, MQTT_BROKER_HOST: undefined });
    expect(mqttEnabled()).toBe(false);
  });
});

describe("buildMqttConfigBlock", () => {
  it("returns null when disabled", async () => {
    expect(await buildMqttConfigBlock("dev_1")).toBeNull();
  });
  it("returns host/port/clientId/username when enabled", async () => {
    Object.assign(ENV, FULL);
    const block = await buildMqttConfigBlock("dev_1");
    expect(block).toEqual({
      host: "broker.example.com",
      port: 8883,
      clientId: "dev_1",
      username: "dev_1",
    });
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

describe("publishCommand", () => {
  const cmd = { commandId: "cmd_1", type: "trigger", action: "show_qr", payload: { url: "https://x" } };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false and never calls fetch when disabled", async () => {
    expect(await publishCommand("dev_1", cmd)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns true and calls fetch once when enabled and the request succeeds", async () => {
    Object.assign(ENV, FULL);
    fetchSpy.mockResolvedValue({ ok: true } as Response);
    expect(await publishCommand("dev_9", cmd)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const expected = buildPublishRequest("dev_9", cmd);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(expected.url);
    expect(init).toMatchObject({ method: "POST", headers: expected.headers, body: expected.body });
  });

  it("retries once and returns true when the first attempt rejects but the second succeeds", async () => {
    Object.assign(ENV, FULL);
    fetchSpy.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ ok: true } as Response);
    expect(await publishCommand("dev_9", cmd)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("provisionDeviceMqtt", () => {
  it("is a no-op returning false when disabled", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await provisionDeviceMqtt("dev_1", "pw")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("POSTs a built-in-db user and returns true on ok", async () => {
    Object.assign(ENV, FULL);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", fetchSpy);
    expect(await provisionDeviceMqtt("dev_9", "secret")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://broker.example.com:8443/api/v5/authentication/password_based%3Abuilt_in_database/users");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(opts.body)).toEqual({ user_id: "dev_9", password: "secret", is_superuser: false });
    vi.unstubAllGlobals();
  });
  it("on 409 conflict updates the password via PUT and returns true", async () => {
    Object.assign(ENV, FULL);
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 409 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", fetchSpy);
    expect(await provisionDeviceMqtt("dev_9", "secret2")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, opts] = fetchSpy.mock.calls[1];
    expect(url).toBe("https://broker.example.com:8443/api/v5/authentication/password_based%3Abuilt_in_database/users/dev_9");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toEqual({ password: "secret2" });
    vi.unstubAllGlobals();
  });
});

describe("deprovisionDeviceMqtt", () => {
  it("is a no-op returning false when disabled", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await deprovisionDeviceMqtt("dev_1")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("DELETEs the user and treats 404 as success", async () => {
    Object.assign(ENV, FULL);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    vi.stubGlobal("fetch", fetchSpy);
    expect(await deprovisionDeviceMqtt("dev_9")).toBe(true);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://broker.example.com:8443/api/v5/authentication/password_based%3Abuilt_in_database/users/dev_9");
    expect(opts.method).toBe("DELETE");
    vi.unstubAllGlobals();
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
    expect(parseHeartbeatPayload({ version: "2.13.0" })).toEqual({ version: "2.13.0", heap: null });
    expect(parseHeartbeatPayload({})).toEqual({ version: null, heap: null });
  });
  it("parses free-heap bytes and rounds them", () => {
    expect(parseHeartbeatPayload({ version: "2.13.0", heap: 236480 })).toEqual({
      version: "2.13.0",
      heap: 236480,
    });
    expect(parseHeartbeatPayload({ heap: 200000.7 })).toEqual({ version: null, heap: 200001 });
  });
  it("rejects a non-numeric, negative, or non-finite heap", () => {
    expect(parseHeartbeatPayload({ heap: "lots" })).toEqual({ version: null, heap: null });
    expect(parseHeartbeatPayload({ heap: -5 })).toEqual({ version: null, heap: null });
    expect(parseHeartbeatPayload({ heap: Infinity })).toEqual({ version: null, heap: null });
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
