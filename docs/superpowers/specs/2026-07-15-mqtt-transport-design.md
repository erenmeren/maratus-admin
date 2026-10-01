# MQTT Device Transport — Design

**Date:** 2026-07-15
**Status:** Approved (brainstorm complete)
**Scope:** Full cloud implementation + the MQTT contract the firmware must
implement. Firmware implementation is planned separately in a maratus-firmware
session with this document as input.
**Supersedes:** the "MQTT/push explicitly rejected" constraint in
`2026-07-12-adaptive-polling-design.md`. That spec's night-window mechanism is
now obsolete for MQTT-capable firmware; the HTTP polling path itself stays as
the fallback transport.

## Problem & goal

Devices poll `GET /api/device/commands` every 12 s while idle. Consequences:

1. **Trigger latency:** a `show_qr` trigger waits 0–12 s (avg ~6 s) before the
   device renders it. This is the primary motivation — the customer is
   standing at the till.
2. **Cost:** ~7,200 invocations/device/day on Vercel + always-hot Neon,
   scaling linearly with fleet size (~14.4 M/day at 2,000 devices).

Goal: sub-second trigger delivery, with idle HTTP traffic reduced ~96%
(7,200 → ~300 invocations/device/day), without breaking old firmware or
adding a hard dependency on a single external service.

## Decisions made

| Decision | Choice |
|---|---|
| Motivation priority | Instant triggering first; cost second |
| Scope | **Full MQTT**: command payload, ack, and presence over MQTT |
| Broker | **EMQX Cloud Serverless, Frankfurt (eu-central-1)** |
| Fallback | HTTP polling path **stays**; device falls back to it whenever MQTT is disconnected; old firmware keeps working forever |
| Latency to Türkiye | Istanbul→Frankfurt RTT ~45–70 ms — negligible inside a sub-second budget; no provider offers a Türkiye region, so all options are equal here |

## Architecture

```
Trigger API (Vercel)
  ├─▶ deviceCommand row in DB (pending)      — DB stays the source of record/billing
  └─▶ EMQX HTTP Publish API: d/{deviceId}/cmd (QoS 1, full command payload)

Device (ESP32, esp-mqtt)
  ├─ persistent TLS connection, subscribed to d/{deviceId}/cmd (idle traffic ~0)
  ├─ on command: render QR → publish d/{deviceId}/ack (QoS 1)
  └─ every 5 min: lightweight heartbeat d/{deviceId}/hb (includes fw version)

EMQX → Vercel bridge (Data Integration webhooks, shared-secret header)
  ├─ ack messages      → POST /api/mqtt/ack       → command acked/failed + credit settle/release
  ├─ hb messages       → POST /api/mqtt/heartbeat → lastSeenAt + firmwareVersion (+ pending-command republish)
  └─ connect/disconnect events (incl. LWT) → POST /api/mqtt/presence → instant online/offline
```

Vercel, Neon, the trigger API surface, and the credit ledger are unchanged.
The broker is a delivery channel only — no state of record lives in EMQX.

## MQTT contract (firmware-facing)

### Authentication

- Connect with `clientId = deviceId`, `username = deviceId`,
  `password = JWT` over TLS (port 8883).
- The JWT is minted by the cloud and delivered in the `/api/device/config`
  response as a new `mqtt` block:

```jsonc
"mqtt": {
  "host": "xxxx.eu-central-1.emqxsl.com",
  "port": 8883,
  "clientId": "<deviceId>",
  "username": "<deviceId>",
  "password": "<JWT — 30-day expiry, refreshed on every config fetch>"
}
```

- JWT claims carry the ACL: the device may **subscribe only** to
  `d/{deviceId}/cmd` and **publish only** to `d/{deviceId}/ack` and
  `d/{deviceId}/hb`. A leaked device credential cannot observe or spoof other
  devices.
- The existing device-key model is untouched; the JWT is a derived,
  short-lived ticket for the MQTT session only. HTTP endpoints keep using the
  bearer device key.
- **Assumption to verify first in planning:** EMQX Serverless supports JWT
  auth with ACL claims. Plan B if not: provision a per-device username/password
  in EMQX's built-in auth database via the EMQX management API at claim time
  (and delete it on revoke).

### Topics

All per-device, QoS 1, no retain:

| Topic | Direction | Payload |
|---|---|---|
| `d/{id}/cmd` | cloud → device | `{ commandId, type, action, payload }` — identical shape to today's poll-response command object |
| `d/{id}/ack` | device → cloud | `{ commandId, ok, result? }` — identical to today's HTTP ack body |
| `d/{id}/hb` | device → cloud | `{ version }` — every 5 minutes |

### Sessions & delivery semantics

- Non-clean session with ~1 h session expiry + QoS 1: commands published while
  the device is briefly offline are queued by the broker and delivered on
  reconnect.
- Command lifecycle over MQTT simplifies to `pending` → `acked`/`failed`
  (set by the ack webhook). The HTTP poll path keeps its `delivered`
  intermediate state exactly as today.
- Duplicate delivery is harmless: the ack transition is status-guarded in the
  DB (second ack is a no-op), and the firmware must not re-process a
  `commandId` it has already handled (firmware rule).

### Fallback rule (firmware)

Whenever the MQTT connection is not in `CONNECTED` state, the device polls
the existing HTTP endpoint every 15 s and sends acks over HTTP; when the
connection is established, polling stops. Each command therefore travels over
exactly one transport.

## Cloud changes

### New module: `lib/mqtt.ts`

- `publishCommand(deviceId, cmd)` — publish via the **EMQX HTTP Publish API**
  (never a live MQTT connection from a serverless function), with a short
  retry.
- `mintDeviceMqttJwt(deviceId)` — signs the connection JWT with
  `MQTT_JWT_SECRET`, embedding the ACL claims.
- Webhook signature/secret verification helper.
- **Feature flag = env presence.** If the EMQX env vars are absent, every
  function is a no-op, the config route omits the `mqtt` block, and behavior
  is byte-for-byte today's.

### Touched routes

- `app/api/v1/devices/[deviceId]/trigger/route.ts` — after enqueuing the
  command row, publish it. On publish failure the row simply stays `pending`;
  self-healing below.
- `app/api/mqtt/ack/route.ts` (new) — validates the shared secret, then runs
  the same settle/release logic as the HTTP ack route. The credit/ack logic
  is extracted into a shared helper used by both routes.
- `app/api/mqtt/heartbeat/route.ts` (new) — bumps `lastSeenAt` +
  `firmwareVersion`; additionally, if the device has `pending` commands older
  than ~1 minute, republishes them. This bounds a lost publish to one
  heartbeat interval — commands cannot be silently lost.
- `app/api/mqtt/presence/route.ts` (new) — connect → `online` + `lastSeenAt`;
  disconnect/LWT → `offline` (a `paused` device stays paused). The existing
  health cron remains as the reconciler for missed disconnect webhooks.
- `app/api/device/config/route.ts` — adds the `mqtt` block when enabled.
- No DB migration: existing tables and statuses suffice.

### Environment

`EMQX_API_URL`, `EMQX_API_KEY`, `EMQX_API_SECRET`, `EMQX_WEBHOOK_SECRET`,
`MQTT_JWT_SECRET`, `MQTT_BROKER_HOST` — added to `lib/env.ts` (all optional
as a group) and `.env.example`. EMQX console setup (JWT auth, the three
Data Integration webhooks, TLS listener) is documented as a runbook in
`docs/runbooks/`.

## Error handling summary

| Failure | Behavior |
|---|---|
| EMQX fully down | Devices detect disconnect → HTTP polling at 15 s; system degrades to today's behavior, nothing breaks |
| Publish fails (transient) | Short retry in `publishCommand`; if still failing, row stays `pending` and the next heartbeat republishes |
| Ack webhook lost | QoS 1 + EMQX webhook retries; ultimate backstop is the existing lazy expired-hold reconciliation in `lib/credits.ts` |
| Missed disconnect event | Health cron reconciles stale `lastSeenAt` → offline, as today |
| Old firmware | Never sees the `mqtt` config block; polls forever; fully supported |

## Cost reality

- EMQX Serverless free tier ≈ 1M session-minutes/month ≈ **~23 always-on
  devices for $0** — today's fleet fits comfortably.
- At 2,000 devices: ~86M session-min/month ≈ **roughly $150–200/month**
  (verify against current EMQX pricing during planning). In exchange, Vercel
  invocations drop from ~14.4M/day to ~0.6M/day and Neon loses its
  always-hot pressure. Net win at scale, ~zero added cost today.

## Rollout (non-breaking, in order)

1. Ship cloud changes — no-op without env, zero behavior change.
2. Create the EMQX account, configure auth + webhooks (runbook), add prod
   env vars; validate end-to-end with the desk test device (b580).
3. maratus-firmware session: esp-mqtt milestone using this contract; HIL; then
   OTA to the fleet.
4. Old firmware is never affected.

## Testing

- Unit: JWT minting (claims/expiry), all three webhook handlers (secret
  rejection, ack idempotency, paused-device presence, heartbeat republish).
- Integration: script that posts fake ack/hb/presence payloads to the local
  endpoints, and a live check publishing through a real EMQX trial instance.
- HIL (firmware session): end-to-end trigger latency measurement — target
  < 1 s from API 202 to QR on screen; fallback drill (kill MQTT, verify
  polling resumes; restore, verify polling stops).

## Out of scope

- Firmware implementation details (esp-mqtt task architecture) — separate
  maratus-firmware plan.
- Retiring the HTTP polling endpoints (kept indefinitely as fallback).
- Admin UI "transport" indicator (nice-to-have; revisit after rollout).
- Org-visible latency SLAs or per-tenant broker isolation.
