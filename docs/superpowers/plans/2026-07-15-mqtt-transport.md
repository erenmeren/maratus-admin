# MQTT Device Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver device commands over MQTT (EMQX Cloud Serverless) for sub-second trigger latency and ~96% less idle HTTP traffic, while the existing HTTP polling path stays as a transparent fallback.

**Architecture:** The trigger API keeps writing the `deviceCommand` row to Postgres (unchanged source of record + billing), and additionally publishes the command to EMQX via its HTTP Publish API. Devices hold a persistent MQTT session; their acks, heartbeats, and connect/disconnect (LWT) events flow back through EMQX Data-Integration webhooks into three new Vercel endpoints that reuse the existing credit-settlement logic. Everything is gated behind env presence — with the EMQX vars absent, the code is a byte-for-byte no-op and old firmware keeps polling.

**Tech Stack:** Next.js 16 (App Router, `runtime = "nodejs"`), Drizzle over neon-http, `jose` for JWT minting, zod for env + payload validation, vitest for unit tests.

## Global Constraints

- **Additive & non-breaking.** No DB migration. No change to existing HTTP endpoints' behavior. Old firmware (no `mqtt` config block) must keep working forever.
- **Feature flag = env presence.** If the EMQX env group is absent, `mqttEnabled()` is `false`: the config route omits the `mqtt` block, `publishCommand` is a no-op, and the three webhook routes return `503`. Default behavior is identical to today.
- **DB is the source of record.** EMQX is a delivery channel only; never store state of record in the broker. Billing/credit transitions happen exactly once, in the DB, guarded by status.
- **Test pattern (match the repo):** pure, testable logic lives in `lib/*.ts` with a colocated `lib/*.test.ts` (vitest `include` is `lib/**/*.test.ts` only — route handlers are NOT unit-tested here). Route files stay thin and are verified manually with `curl`.
- **Run tests with:** `npm test` (= `vitest run`). Run a single file with `npx vitest run lib/<file>.test.ts`.
- **Money/credits:** a trigger command with `billing === "included"` must NEVER move credits on ack; `billing` of `"credits"` or `null` (legacy) does. This rule already lives in the HTTP ack route and MUST be preserved by the shared helper.
- **Commit after every task.** Conventional-commit messages, `feat:` / `refactor:` / `chore:` / `docs:` as appropriate.

---

## File Structure

**New files:**
- `lib/mqtt.ts` — all pure MQTT helpers: `mqttEnabled`, `mintDeviceMqttJwt`, `buildMqttConfigBlock`, `buildPublishRequest`, `verifyWebhookSecret`, and the three payload parsers. The only impure function is `publishCommand` (does the network fetch), kept here but thin.
- `lib/mqtt.test.ts` — unit tests for every pure function above.
- `lib/trigger-ack.ts` — `applyTriggerAck(...)`: the shared credit settle/release logic extracted from the HTTP ack route, so both the HTTP ack route and the MQTT ack webhook call one implementation.
- `lib/trigger-ack.test.ts` — unit tests for the billing-branch decision (`shouldMoveCredits`).
- `app/api/mqtt/ack/route.ts` — EMQX ack webhook → `applyTriggerAck`.
- `app/api/mqtt/heartbeat/route.ts` — EMQX heartbeat webhook → bump `lastSeenAt` + version + republish stale pending commands.
- `app/api/mqtt/presence/route.ts` — EMQX connect/disconnect (LWT) webhook → online/offline.
- `docs/runbooks/emqx-setup.md` — console setup runbook (JWT auth, TLS listener, 3 webhooks).

**Modified files:**
- `lib/env.ts` — add the optional EMQX env group.
- `.env.example` — document the new vars.
- `app/api/v1/devices/[deviceId]/trigger/route.ts` — publish after enqueue.
- `app/api/device/commands/ack/route.ts` — replace inline settle logic with `applyTriggerAck`.
- `app/api/device/config/route.ts` — attach the `mqtt` block when enabled.
- `package.json` — add `jose` as a direct dependency.

---

### Task 1: Environment configuration for EMQX

**Files:**
- Modify: `lib/env.ts:52` (append inside `envSchema`, before the closing `})`)
- Modify: `.env.example` (append a new section)

**Interfaces:**
- Consumes: nothing.
- Produces: `env.EMQX_API_URL`, `env.EMQX_API_KEY`, `env.EMQX_API_SECRET`, `env.EMQX_WEBHOOK_SECRET`, `env.MQTT_JWT_SECRET`, `env.MQTT_BROKER_HOST`, `env.MQTT_BROKER_PORT` — all `string | undefined` except port which defaults. Consumed by `lib/mqtt.ts` (Task 2).

- [ ] **Step 1: Add the env vars**

In `lib/env.ts`, immediately before the line `});` that closes `envSchema` (currently line 53), add:

```ts
  // ---- EMQX / MQTT device transport ----
  // All optional as a group. Absent → MQTT is disabled and the device transport
  // falls back to HTTP polling (mqttEnabled() in lib/mqtt.ts gates on these).
  // EMQX Cloud Serverless HTTP API base, e.g. https://xxxx.eu-central-1.emqxsl.com:8443/api/v5
  EMQX_API_URL: z.string().optional(),
  // EMQX API key/secret (created in the EMQX console → API Keys).
  EMQX_API_KEY: z.string().optional(),
  EMQX_API_SECRET: z.string().optional(),
  // Shared secret the EMQX Data-Integration webhooks send back to us in the
  // `x-emqx-webhook-secret` header. We reject any webhook that doesn't match.
  EMQX_WEBHOOK_SECRET: z.string().optional(),
  // HS256 signing secret for the short-lived per-device MQTT connection JWT.
  MQTT_JWT_SECRET: z.string().optional(),
  // The broker host the device connects to over TLS (mqtts://<host>:<port>),
  // e.g. xxxx.eu-central-1.emqxsl.com — delivered to the device in config.
  MQTT_BROKER_HOST: z.string().optional(),
  MQTT_BROKER_PORT: z.coerce.number().default(8883),
```

- [ ] **Step 2: Verify it still parses**

Run: `npx vitest run lib/timezones.test.ts`
Expected: PASS (any lib test triggers `getEnv()` against your `.env.local`; a green run proves the schema still validates with the new optional fields absent).

- [ ] **Step 3: Document the vars in `.env.example`**

Append to `.env.example`:

```bash
# ---- EMQX / MQTT device transport (optional) ----
# Absent → MQTT disabled, devices use HTTP polling. See docs/runbooks/emqx-setup.md.
EMQX_API_URL="https://xxxx.eu-central-1.emqxsl.com:8443/api/v5"
EMQX_API_KEY="your-emqx-api-key"
EMQX_API_SECRET="your-emqx-api-secret"
EMQX_WEBHOOK_SECRET="openssl rand -base64 32"
MQTT_JWT_SECRET="openssl rand -base64 32"
MQTT_BROKER_HOST="xxxx.eu-central-1.emqxsl.com"
MQTT_BROKER_PORT="8883"
```

- [ ] **Step 4: Commit**

```bash
git add lib/env.ts .env.example
git commit -m "chore(mqtt): add optional EMQX/MQTT environment config"
```

---

### Task 2: Pure MQTT helpers (`lib/mqtt.ts`) — TDD

**Files:**
- Create: `lib/mqtt.ts`
- Test: `lib/mqtt.test.ts`
- Modify: `package.json` (add `jose`)

**Interfaces:**
- Consumes: `env` from `@/lib/env` (Task 1).
- Produces (consumed by Tasks 3–8):
  - `mqttEnabled(): boolean`
  - `mintDeviceMqttJwt(deviceId: string): Promise<string>`
  - `buildMqttConfigBlock(deviceId: string): Promise<{ host: string; port: number; clientId: string; username: string; password: string } | null>`
  - `buildPublishRequest(deviceId: string, cmd: MqttCommand): { url: string; headers: Record<string,string>; body: string }`
  - `verifyWebhookSecret(req: Request): boolean`
  - `parseAckPayload(raw: unknown): { commandId: string; ok: boolean; result: string | null } | null`
  - `parseHeartbeatPayload(raw: unknown): { version: string | null } | null`
  - `parsePresencePayload(raw: unknown): { deviceId: string; connected: boolean } | null`
  - `type MqttCommand = { commandId: string; type: string; action: string | null; payload: unknown }`

- [ ] **Step 1: Add the `jose` dependency**

Run: `npm install jose`
Expected: `jose` appears under `dependencies` in `package.json`. (It's already present transitively via better-auth; installing makes it a direct, version-pinned dep.)

- [ ] **Step 2: Write the failing tests**

Create `lib/mqtt.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run lib/mqtt.test.ts`
Expected: FAIL — `Cannot find module './mqtt'`.

- [ ] **Step 4: Implement `lib/mqtt.ts`**

Create `lib/mqtt.ts`:

```ts
// lib/mqtt.ts
// EMQX / MQTT device transport helpers. Pure and testable except publishCommand,
// which performs the single outbound HTTP publish. Everything gates on
// mqttEnabled(): with the EMQX env group absent, the whole module is inert and
// the device transport falls back to HTTP polling.

import { SignJWT } from "jose";
import { env } from "@/lib/env";

export type MqttCommand = {
  commandId: string;
  type: string;
  action: string | null;
  payload: unknown;
};

const JWT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days; refreshed on every config fetch.

/** True only when every required EMQX var is present. */
export function mqttEnabled(): boolean {
  return Boolean(
    env.EMQX_API_URL &&
      env.EMQX_API_KEY &&
      env.EMQX_API_SECRET &&
      env.EMQX_WEBHOOK_SECRET &&
      env.MQTT_JWT_SECRET &&
      env.MQTT_BROKER_HOST,
  );
}

function jwtKey(): Uint8Array {
  return new TextEncoder().encode(env.MQTT_JWT_SECRET as string);
}

/** Sign a short-lived connection JWT scoped to this device's topics (EMQX ACL claims). */
export async function mintDeviceMqttJwt(deviceId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    acl: {
      sub: [`d/${deviceId}/cmd`],
      pub: [`d/${deviceId}/ack`, `d/${deviceId}/hb`],
    },
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(deviceId)
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_TTL_SECONDS)
    .sign(jwtKey());
}

/** The `mqtt` block for /api/device/config, or null when disabled. */
export async function buildMqttConfigBlock(deviceId: string): Promise<{
  host: string;
  port: number;
  clientId: string;
  username: string;
  password: string;
} | null> {
  if (!mqttEnabled()) return null;
  return {
    host: env.MQTT_BROKER_HOST as string,
    port: Number(env.MQTT_BROKER_PORT ?? 8883),
    clientId: deviceId,
    username: deviceId,
    password: await mintDeviceMqttJwt(deviceId),
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

/** Publish a command to the device's cmd topic. No-op + false when disabled or on failure. */
export async function publishCommand(deviceId: string, cmd: MqttCommand): Promise<boolean> {
  if (!mqttEnabled()) return false;
  const { url, headers, body } = buildPublishRequest(deviceId, cmd);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers, body });
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/mqtt.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 6: Commit**

```bash
git add lib/mqtt.ts lib/mqtt.test.ts package.json package-lock.json
git commit -m "feat(mqtt): pure EMQX transport helpers (JWT, publish, webhook parsing)"
```

---

### Task 3: Shared trigger-ack settlement (`lib/trigger-ack.ts`) — TDD refactor

**Why:** The HTTP ack route (`app/api/device/commands/ack/route.ts:31-38`) has the credit settle/release decision inline. The MQTT ack webhook needs the exact same logic. Extract it once so both call it — DRY, and the money rule lives in one place.

**Files:**
- Create: `lib/trigger-ack.ts`
- Test: `lib/trigger-ack.test.ts`
- Modify: `app/api/device/commands/ack/route.ts`

**Interfaces:**
- Consumes: `settleHold`, `releaseHold` from `@/lib/credits`; `creditCostForAction` from `@/lib/trigger-actions`.
- Produces:
  - `shouldMoveCredits(cmd: { type: string | null; billing: string | null }): boolean` — pure.
  - `applyTriggerAck(cmd: AckedCommand, ok: boolean): Promise<void>` — impure; runs settle/release.
  - `type AckedCommand = { id: string; type: string | null; action: string | null; organizationId: string; deviceId: string; billing: string | null }`

- [ ] **Step 1: Write the failing test for the pure decision**

Create `lib/trigger-ack.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldMoveCredits } from "./trigger-ack";

describe("shouldMoveCredits", () => {
  it("moves credits for a credit-billed trigger", () => {
    expect(shouldMoveCredits({ type: "trigger", billing: "credits" })).toBe(true);
  });
  it("moves credits for a legacy (null billing) trigger", () => {
    expect(shouldMoveCredits({ type: "trigger", billing: null })).toBe(true);
  });
  it("does NOT move credits for a plan-included trigger", () => {
    expect(shouldMoveCredits({ type: "trigger", billing: "included" })).toBe(false);
  });
  it("does NOT move credits for a non-trigger command", () => {
    expect(shouldMoveCredits({ type: "reboot", billing: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/trigger-ack.test.ts`
Expected: FAIL — `Cannot find module './trigger-ack'`.

- [ ] **Step 3: Implement `lib/trigger-ack.ts`**

Create `lib/trigger-ack.ts`:

```ts
// lib/trigger-ack.ts
// Single home for the "did this trigger ack move credits?" decision and the
// settle/release side effect. Shared by the HTTP ack route and the MQTT ack
// webhook so the money rule exists in exactly one place.

import { settleHold, releaseHold } from "@/lib/credits";
import { creditCostForAction } from "@/lib/trigger-actions";

export type AckedCommand = {
  id: string;
  type: string | null;
  action: string | null;
  organizationId: string;
  deviceId: string;
  billing: string | null;
};

/** A credit-billed trigger moves credits on ack; "included" and non-triggers do not.
 *  Null billing = legacy credit-held row → treated as "credits". */
export function shouldMoveCredits(cmd: { type: string | null; billing: string | null }): boolean {
  return cmd.type === "trigger" && cmd.billing !== "included";
}

/** Settle (success) or release (failure) the credit hold for an acked trigger. */
export async function applyTriggerAck(cmd: AckedCommand, ok: boolean): Promise<void> {
  if (!shouldMoveCredits(cmd)) return;
  const cost = creditCostForAction((cmd.action ?? "show_qr") as "show_qr");
  if (ok) {
    await settleHold({ organizationId: cmd.organizationId, commandId: cmd.id, cost, deviceId: cmd.deviceId });
  } else {
    await releaseHold({ organizationId: cmd.organizationId, commandId: cmd.id, cost, deviceId: cmd.deviceId });
  }
}
```

- [ ] **Step 4: Run to verify the pure test passes**

Run: `npx vitest run lib/trigger-ack.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor the HTTP ack route to use the helper**

In `app/api/device/commands/ack/route.ts`, replace the import block and the inline settle logic.

Change the imports (currently lines 6-7):

```ts
import { settleHold, releaseHold } from "@/lib/credits";
import { creditCostForAction } from "@/lib/trigger-actions";
```

to:

```ts
import { applyTriggerAck } from "@/lib/trigger-ack";
```

Then replace the settle block (currently lines 32-38):

```ts
  // Included (plan-covered) triggers never move credits; null billing = legacy credit-held rows.
  if (cmd && cmd.type === "trigger" && cmd.billing !== "included") {
    const cost = creditCostForAction((cmd.action ?? "show_qr") as "show_qr");
    if (body.ok) await settleHold({ organizationId: cmd.organizationId, commandId: cmd.id, cost, deviceId: cmd.deviceId });
    else await releaseHold({ organizationId: cmd.organizationId, commandId: cmd.id, cost, deviceId: cmd.deviceId });
  }
```

with:

```ts
  if (cmd) await applyTriggerAck(cmd, body.ok === true);
```

(The `.returning({...})` on the update already selects `id, type, action, organizationId, deviceId, billing` — exactly the `AckedCommand` shape. Leave it unchanged.)

- [ ] **Step 6: Verify the whole suite + typecheck still pass**

Run: `npm test`
Expected: PASS (all lib tests green, including the new ones).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/trigger-ack.ts lib/trigger-ack.test.ts app/api/device/commands/ack/route.ts
git commit -m "refactor(mqtt): extract shared applyTriggerAck used by HTTP + MQTT acks"
```

---

### Task 4: Publish on trigger

**Files:**
- Modify: `app/api/v1/devices/[deviceId]/trigger/route.ts`

**Interfaces:**
- Consumes: `publishCommand` from `@/lib/mqtt` (Task 2).
- Produces: nothing new; on success the command is now also on the wire.

- [ ] **Step 1: Import `publishCommand`**

In `app/api/v1/devices/[deviceId]/trigger/route.ts`, add to the imports (after the `id` import on line 11):

```ts
import { publishCommand } from "@/lib/mqtt";
```

- [ ] **Step 2: Publish after the row is committed**

Replace the final success return (currently line 96, `return apiJson(body, 202);`) with:

```ts
  // Best-effort publish over MQTT. The DB row is already the source of record;
  // if this fails (or MQTT is disabled), the device gets the command via HTTP
  // polling and/or the heartbeat republish, so we never block the 202 on it.
  await publishCommand(deviceId, {
    commandId,
    type: "trigger",
    action: v.action,
    payload: v.payload,
  });

  return apiJson(body, 202);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification (MQTT disabled path)**

With no EMQX env vars set, confirm the trigger endpoint behaves exactly as before: `publishCommand` returns `false` immediately and the endpoint returns 202. If you have a local trigger smoke script, run it; otherwise this is covered by the existing trigger flow being unchanged. Confirm `npm test` is still green (no regression):

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/devices/[deviceId]/trigger/route.ts
git commit -m "feat(mqtt): publish trigger commands over MQTT after enqueue"
```

---

### Task 5: MQTT ack webhook route

**Files:**
- Create: `app/api/mqtt/ack/route.ts`

**Interfaces:**
- Consumes: `verifyWebhookSecret`, `parseAckPayload` from `@/lib/mqtt`; `applyTriggerAck` from `@/lib/trigger-ack`; `db`, `deviceCommand` from schema.
- Produces: `POST /api/mqtt/ack`.

- [ ] **Step 1: Implement the route**

Create `app/api/mqtt/ack/route.ts`:

```ts
// POST /api/mqtt/ack — EMQX Data-Integration webhook for device command acks.
// Mirrors app/api/device/commands/ack/route.ts but authenticates via the shared
// webhook secret (the device already proved itself to the broker via JWT).

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deviceCommand } from "@/lib/db/schema";
import { mqttEnabled, verifyWebhookSecret, parseAckPayload } from "@/lib/mqtt";
import { applyTriggerAck } from "@/lib/trigger-ack";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!mqttEnabled()) return NextResponse.json({ error: "MQTT disabled" }, { status: 503 });
  if (!verifyWebhookSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  const ack = parseAckPayload(raw);
  if (!ack) return NextResponse.json({ error: "Invalid ack payload" }, { status: 400 });

  const now = new Date();
  const nextStatus = ack.ok ? "acked" : "failed";
  // Guard on "pending" OR "delivered": MQTT commands stay pending (never marked
  // delivered), while a command that also went out over HTTP polling may be
  // delivered. Either way, the first ack wins; a duplicate is a no-op.
  const [cmd] = await db
    .update(deviceCommand)
    .set({ status: nextStatus, ackedAt: now, result: ack.result })
    .where(and(eq(deviceCommand.id, ack.commandId), eq(deviceCommand.status, "pending")))
    .returning({
      id: deviceCommand.id,
      type: deviceCommand.type,
      action: deviceCommand.action,
      organizationId: deviceCommand.organizationId,
      deviceId: deviceCommand.deviceId,
      billing: deviceCommand.billing,
    });

  if (cmd) await applyTriggerAck(cmd, ack.ok);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

With EMQX env vars temporarily set in `.env.local` and the dev server running (`npm run dev`), simulate a webhook (replace `<cmd_id>` with a real pending trigger command id and `<secret>` with `EMQX_WEBHOOK_SECRET`):

```bash
curl -i -X POST http://localhost:3000/api/mqtt/ack \
  -H "content-type: application/json" \
  -H "x-emqx-webhook-secret: <secret>" \
  -d '{"commandId":"<cmd_id>","ok":true,"result":"rendered"}'
```

Expected: `200 {"ok":true}`; the command row flips to `acked` and (if credit-billed) the hold settles. A wrong/absent secret returns `401`; no env → `503`.

- [ ] **Step 4: Commit**

```bash
git add app/api/mqtt/ack/route.ts
git commit -m "feat(mqtt): ack webhook route settling credits via shared helper"
```

---

### Task 6: MQTT heartbeat webhook route (with stale-command republish)

**Files:**
- Create: `app/api/mqtt/heartbeat/route.ts`

**Interfaces:**
- Consumes: `mqttEnabled`, `verifyWebhookSecret`, `parseHeartbeatPayload`, `publishCommand` from `@/lib/mqtt`; `db`, `device`, `deviceCommand` from schema; drizzle ops.
- Produces: `POST /api/mqtt/heartbeat`. Body carries the deviceId (EMQX includes `clientid`), so read it from the payload.

- [ ] **Step 1: Implement the route**

Create `app/api/mqtt/heartbeat/route.ts`:

```ts
// POST /api/mqtt/heartbeat — EMQX webhook fired by device hb messages.
// Bumps lastSeenAt + firmware version and republishes any pending command older
// than ~1 minute, bounding a lost publish to one heartbeat interval.

import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand } from "@/lib/db/schema";
import { mqttEnabled, verifyWebhookSecret, parseHeartbeatPayload, publishCommand } from "@/lib/mqtt";

export const runtime = "nodejs";

const REPUBLISH_AFTER_MS = 60_000;

export async function POST(req: Request) {
  if (!mqttEnabled()) return NextResponse.json({ error: "MQTT disabled" }, { status: 503 });
  if (!verifyWebhookSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  const hb = parseHeartbeatPayload(raw);
  const clientid = (raw as { clientid?: unknown }).clientid;
  if (!hb || typeof clientid !== "string" || clientid.length === 0) {
    return NextResponse.json({ error: "Invalid heartbeat payload" }, { status: 400 });
  }

  const now = new Date();
  const [dev] = await db
    .update(deviceTable)
    .set({
      lastSeenAt: now,
      ...(hb.version ? { firmwareVersion: hb.version } : {}),
      // Do not resurrect a paused device.
    })
    .where(eq(deviceTable.id, clientid))
    .returning({ id: deviceTable.id, status: deviceTable.status });
  if (!dev) return NextResponse.json({ error: "Unknown device" }, { status: 404 });

  // Mark online unless paused (separate set to keep the enum-narrowing simple).
  if (dev.status !== "paused") {
    await db.update(deviceTable).set({ status: "online" }).where(eq(deviceTable.id, dev.id));
  }

  // Republish stale pending commands so a lost publish self-heals.
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
      ),
    );
  for (const cmd of stale) {
    await publishCommand(dev.id, { commandId: cmd.id, type: cmd.type, action: cmd.action, payload: cmd.payload });
  }

  return NextResponse.json({ ok: true, republished: stale.length });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

```bash
curl -i -X POST http://localhost:3000/api/mqtt/heartbeat \
  -H "content-type: application/json" \
  -H "x-emqx-webhook-secret: <secret>" \
  -d '{"clientid":"<device_id>","version":"2.13.0"}'
```

Expected: `200 {"ok":true,"republished":N}`; the device's `lastSeenAt` bumps, `firmwareVersion` updates, status becomes `online` (unless paused). Unknown device → `404`.

- [ ] **Step 4: Commit**

```bash
git add app/api/mqtt/heartbeat/route.ts
git commit -m "feat(mqtt): heartbeat webhook with stale-command republish"
```

---

### Task 7: MQTT presence webhook route (online/offline + LWT)

**Files:**
- Create: `app/api/mqtt/presence/route.ts`

**Interfaces:**
- Consumes: `mqttEnabled`, `verifyWebhookSecret`, `parsePresencePayload` from `@/lib/mqtt`; `db`, `device` from schema.
- Produces: `POST /api/mqtt/presence`.

- [ ] **Step 1: Implement the route**

Create `app/api/mqtt/presence/route.ts`:

```ts
// POST /api/mqtt/presence — EMQX client.connected / client.disconnected (incl.
// LWT) webhook. Flips the device online/offline instantly. The health cron
// remains the reconciler for any missed disconnect event.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { mqttEnabled, verifyWebhookSecret, parsePresencePayload } from "@/lib/mqtt";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!mqttEnabled()) return NextResponse.json({ error: "MQTT disabled" }, { status: 503 });
  if (!verifyWebhookSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  const presence = parsePresencePayload(raw);
  if (!presence) return NextResponse.json({ error: "Invalid presence payload" }, { status: 400 });

  const now = new Date();
  const [dev] = await db
    .select({ status: deviceTable.status })
    .from(deviceTable)
    .where(eq(deviceTable.id, presence.deviceId))
    .limit(1);
  if (!dev) return NextResponse.json({ error: "Unknown device" }, { status: 404 });

  // A paused device stays paused regardless of transport connection state.
  if (dev.status === "paused") return NextResponse.json({ ok: true, skipped: "paused" });

  if (presence.connected) {
    await db.update(deviceTable).set({ status: "online", lastSeenAt: now }).where(eq(deviceTable.id, presence.deviceId));
  } else {
    await db.update(deviceTable).set({ status: "offline" }).where(eq(deviceTable.id, presence.deviceId));
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

```bash
# connect
curl -i -X POST http://localhost:3000/api/mqtt/presence \
  -H "content-type: application/json" -H "x-emqx-webhook-secret: <secret>" \
  -d '{"event":"client.connected","clientid":"<device_id>"}'
# disconnect (LWT)
curl -i -X POST http://localhost:3000/api/mqtt/presence \
  -H "content-type: application/json" -H "x-emqx-webhook-secret: <secret>" \
  -d '{"event":"client.disconnected","clientid":"<device_id>"}'
```

Expected: connect → status `online`; disconnect → status `offline`; a paused device is untouched (`{"ok":true,"skipped":"paused"}`).

- [ ] **Step 4: Commit**

```bash
git add app/api/mqtt/presence/route.ts
git commit -m "feat(mqtt): presence webhook for instant online/offline via LWT"
```

---

### Task 8: Attach the `mqtt` block to device config

**Files:**
- Modify: `app/api/device/config/route.ts`

**Interfaces:**
- Consumes: `buildMqttConfigBlock` from `@/lib/mqtt` (Task 2).
- Produces: the config payload gains an `mqtt` field when enabled. Old firmware ignores unknown fields; absent when disabled.

- [ ] **Step 1: Import and attach**

In `app/api/device/config/route.ts`, add the import (after line 9):

```ts
import { buildMqttConfigBlock } from "@/lib/mqtt";
```

Then, in the non-304 branch, attach the block. Replace the final return (currently lines 30-33):

```ts
  return NextResponse.json(payload, {
    status: 200,
    headers: { ETag: `"${version}"`, "Cache-Control": "no-cache" },
  });
```

with:

```ts
  const mqtt = await buildMqttConfigBlock(device.id);
  return NextResponse.json(
    { ...payload, ...(mqtt ? { mqtt } : {}) },
    { status: 200, headers: { ETag: `"${version}"`, "Cache-Control": "no-cache" } },
  );
```

Note: the `mqtt` block carries a freshly-minted JWT and must not participate in the ETag/304 short-circuit — leave the 304 branch (lines 27-29) untouched. Because the JWT changes each request, the practical effect is that a device sending `If-None-Match` still gets 304 for the *display* config (its ETag is computed from `payload` only) and refreshes the JWT on the next full 200; the device refreshes its JWT well before the 30-day expiry via periodic full config fetches. This is intentional and acceptable.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

With EMQX env set, fetch config as a device (replace `<device_key>`):

```bash
curl -s http://localhost:3000/api/device/config \
  -H "authorization: Bearer <device_key>" | python3 -m json.tool
```

Expected: the JSON includes an `mqtt` object with `host`, `port`, `clientId`, `username`, and a `password` that is a 3-segment JWT. With EMQX env removed, the `mqtt` key is absent and the rest of the payload is unchanged.

- [ ] **Step 4: Commit**

```bash
git add app/api/device/config/route.ts
git commit -m "feat(mqtt): serve per-device mqtt connection block in device config"
```

---

### Task 9: EMQX setup runbook

**Files:**
- Create: `docs/runbooks/emqx-setup.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/emqx-setup.md` documenting the one-time console setup so the cloud code can be activated. Cover exactly these steps:

```markdown
# EMQX Cloud Serverless — Setup Runbook

One-time setup to activate the MQTT device transport. Until these steps are
done and the env vars are set, the cloud runs in HTTP-polling mode (no-op).

## 1. Create the deployment
- EMQX Cloud → Serverless → region **eu-central-1 (Frankfurt)**.
- Note the connection host (`xxxx.eu-central-1.emqxsl.com`) → `MQTT_BROKER_HOST`.
- TLS listener is on port **8883** → `MQTT_BROKER_PORT`.

## 2. API key (for HTTP publish)
- Console → API Keys → create. → `EMQX_API_KEY` / `EMQX_API_SECRET`.
- The HTTP API base (`https://<host>:8443/api/v5`) → `EMQX_API_URL`.

## 3. JWT authentication
- Console → Access Control → Authentication → add **JWT**.
- Algorithm **HS256**, secret = `MQTT_JWT_SECRET` (`openssl rand -base64 32`).
- Enable ACL-from-JWT so the `acl.{sub,pub}` claims are enforced.
- **Verify EMQX Serverless supports JWT auth + ACL claims on your plan.**
  If not, fall back to per-device username/password provisioned via the
  built-in-database authenticator at device-claim time (Plan B in the spec) —
  this changes `mintDeviceMqttJwt`/`buildMqttConfigBlock` and the claim flow.

## 4. Data-Integration webhooks (broker → cloud)
Create three HTTP-action webhooks, each sending header
`x-emqx-webhook-secret: <EMQX_WEBHOOK_SECRET>`:
- **ack:** rule `SELECT payload, clientid FROM "d/+/ack"` → POST `<APP_URL>/api/mqtt/ack`,
  body = the message payload JSON.
- **heartbeat:** rule `SELECT payload, clientid FROM "d/+/hb"` → POST
  `<APP_URL>/api/mqtt/heartbeat`, body = `{"clientid": clientid, ...payload}`.
- **presence:** events `client.connected`, `client.disconnected` → POST
  `<APP_URL>/api/mqtt/presence`, body includes `event` and `clientid`.

## 5. Set env vars
Set all `EMQX_*` / `MQTT_*` vars in Vercel (prod) and `.env.local` (local),
then redeploy. Validate with the desk device (b580): trigger via the public
API and confirm the QR renders in < 1 s, then kill the broker connection and
confirm HTTP polling resumes.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/emqx-setup.md
git commit -m "docs(mqtt): EMQX Cloud setup runbook"
```

---

### Task 10: Full-suite verification & memory

**Files:** none (verification).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — including `lib/mqtt.test.ts` and `lib/trigger-ack.test.ts`.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed (the new routes compile; no env is read at build time that would fail).

- [ ] **Step 3: Confirm the no-op default**

With no EMQX env vars set, confirm: `/api/device/config` omits `mqtt`; a trigger returns 202 and enqueues as before; the three `/api/mqtt/*` routes return `503`. This proves the change is inert by default and safe to merge ahead of the firmware and EMQX account.

- [ ] **Step 4: Update project memory**

Add a memory entry noting: MQTT transport cloud side implemented (spec + plan dated 2026-07-15), gated on EMQX env, HTTP polling retained as fallback, DB unchanged; remaining = EMQX account setup (runbook) + maratus-firmware esp-mqtt milestone + HIL latency/fallback drill. Cross-link `[[credits-device-trigger]]` and `[[trigger-only-device-teardown]]`.

---

## Self-Review Notes

- **Spec coverage:** JWT auth + ACL (Task 2 `mintDeviceMqttJwt`), topics/QoS1 (Task 2 `buildPublishRequest`, all routes), publish-on-trigger (Task 4), ack→credit settle (Tasks 3+5), heartbeat + republish self-heal (Task 6), presence/LWT (Task 7), config `mqtt` block (Task 8), env flag no-op (every task), fallback = HTTP path untouched (Tasks 4–8 leave existing routes intact), broker setup incl. Plan-B JWT caveat (Task 9). Cost math, latency, and firmware contract are in the spec; firmware impl is explicitly out of scope.
- **DB:** no migration; the plan reuses existing `device`/`deviceCommand` columns and statuses.
- **Type consistency:** `AckedCommand` (Task 3) matches the `.returning({...})` shape in both ack routes; `MqttCommand` (Task 2) is used identically in Tasks 4 and 6.
- **Fallback correctness:** MQTT commands are guarded on `status = "pending"` in the ack webhook; the HTTP poll path still uses its `pending → delivered → acked` transitions. First ack wins on either transport; duplicates are no-ops.
