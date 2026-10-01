# Adaptive Device Polling — Design (Proposed)

**Date:** 2026-07-12
**Status:** Proposed — implementation lives mostly in maratus-firmware; run a
firmware-session brainstorm before planning. This document pins the cloud
contract and the honest cost math so that session starts from facts.

## Problem

Every device polls `GET /api/device/commands` every 12 s while idle
(`maratus-firmware/main/app_state.c` → `POLL_IDLE_MS 12000`), 24/7 —
~7,200 invocations/device/day regardless of activity. Infra cost scales with
fleet size (see the dual-track pricing spec): at 2,000 devices that is
~14.4 M invocations/day (~167 req/s sustained) on Vercel + always-hot Neon.
Cutting idle polling is the single margin lever that needs no pricing or
product change.

## Constraints

- Perceived trigger latency during business hours must not regress: a trigger
  enqueued while the store is open must render within ~12 s as today.
- Worst-case latency during slow-poll windows equals the slow interval —
  acceptable off-hours, but the window must be conservative by default.
- No new transport (HTTP polling stays; MQTT/push explicitly rejected in the
  original device-architecture decisions).
- Old firmware keeps working: cloud changes must be additive; absent config →
  12 s behavior unchanged.

## Mechanism

**Server-driven interval.** The cloud already owns per-device context
(store → `store.timezone`) and the device already fetches
`/api/device/config`. Add to the config payload's `device` block:

```jsonc
"pollIdleSeconds": 12,   // what the device should use while idle
```

computed server-side per request:

- **Night window (default):** 00:00–06:00 in the device's store timezone →
  60 s; otherwise 12 s. Pool devices (no store) use UTC.
- **Org override (later, optional):** quiet-hours range on the Device
  Settings page; out of scope for v1.

**Firmware:** replace the `POLL_IDLE_MS` constant with a value refreshed from
config (clamped 5–120 s; default 12 when the field is absent — old cloud
compatibility), and additionally poll at the slow rate **whenever the display
is asleep** (`screenSleepEnabled` orgs) — sleep already means "nobody is
standing at the till". Backoff behavior on errors unchanged.

## Honest cost math (per device per day, idle)

| Policy | Polls/day | Cut vs today |
|---|---|---|
| Today: 12 s always | 7,200 | — |
| Night 00–06 @ 60 s | 5,760 | 20% |
| Night + screen-asleep @ 60 s (sleep ~12 h typical retail) | ~4,000–4,400 | ~40–45% |
| Above + open-hours 15 s instead of 12 s | ~3,300–3,700 | ~50–55% |

The "50–70%" figure quoted in the pricing spec is reachable only with the
full stack (night + sleep-aware + modest daytime relaxation) or a longer
night window; the default v1 (night-only) is a 20% cut with zero perceptible
change. Recommend shipping night + sleep-aware (≈40–45%) and revisiting the
daytime interval with latency data.

## Delivery plan sketch (for the future firmware session)

1. Cloud: compute + serve `pollIdleSeconds` in `/api/device/config`
   (pure helper + tests; store timezone lookup exists).
2. Firmware: config-driven interval + sleep-aware slow poll (host-testable
   pure logic where possible), HIL on the desk devices.
3. Verify: serial logs showing interval transitions at the window edges and
   on display sleep/wake; cloud-side invocation-rate before/after on the
   Vercel dashboard.

## Out of scope

- Long-polling / server push / MQTT.
- Per-store custom business hours UI.
- Command-triggered wake (impossible over pull without shortening the
  interval).
