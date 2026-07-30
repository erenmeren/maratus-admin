# Ditto Device Protocol

MQTT (EMQX) carries everything after bootstrap: commands, acks, heartbeat,
presence, and config/OTA delivery. Only two HTTPS routes survive, and both
exist because a device needs them *before* it can open an MQTT connection.
There is no HTTP polling and no fallback transport — if MQTT is unreachable,
the device is unreachable.

## HTTPS bootstrap

### GET /api/device/claim?code=&lt;pairing-code&gt;&serial=&lt;efuse-mac&gt;
Unauthenticated, rate-limited (per-code and per-IP). A device on its setup
screen polls this until claimed. A device whose serial was pre-allocated in
the factory registry self-claims zero-touch on first contact — no code entry.
Responses:
- `{ "status": "pending" }` — not claimed yet, keep polling.
- `{ "status": "claimed", "deviceKey": "...", "deviceId": "...", "mqtt": {...} | null }`
  — the raw device key, delivered **once**. Only its SHA-256 hash is stored
  server-side after this; a device that loses it must re-provision.
- `{ "status": "claimed" }` — already claimed and the key already delivered;
  no key on this response.

`mqtt` is the same block described below, included here so a freshly claimed
device never needs a separate identity round trip. It is `null` when the
EMQX env group isn't configured.

### GET /api/device/identity
`Authorization: Bearer <deviceKey>`. Returns:
```json
{ "deviceId": "...", "mqtt": { "host": "...", "port": 8883, "clientId": "...", "username": "..." } }
```
`clientId` and `username` are both the device's own id; the device
authenticates to the broker with its device key as the MQTT password, so no
separate broker secret is issued. This route also **re-provisions the EMQX
credential on every call** — the one repair path for a credential that
claim-time provisioning missed. The device calls it at first boot, again if
NVS is wiped, and again after 6 consecutive MQTT connect failures. Never on
a timer.

HTTPS is also used for presigned R2 asset fetches (branding images) and the
firmware binary download (`esp_https_ota`) — MQTT only ever carries the
manifest pointing at that binary, never the binary itself.

## MQTT topics

| Topic | Direction | Purpose |
|---|---|---|
| `d/{deviceId}/cmd` | down (device subscribes) | Commands from the cloud |
| `d/{deviceId}/ack` | up | Command acknowledgements |
| `d/{deviceId}/hb` | up | Heartbeat |
| `d/{deviceId}/cfg/get` | up | "send me my config" request |

The device authenticates to the broker as `clientId = username = deviceId`,
password = its device key. EMQX Data-Integration webhooks forward the
upstream traffic to the cloud: `POST /api/mqtt/ack`, `/heartbeat`,
`/config-request`, plus `client.connected` / `client.disconnected` presence
events (including LWT) to `POST /api/mqtt/presence`. Every webhook checks an
`x-emqx-webhook-secret` header against a shared secret, and reads device
identity from the broker-authenticated `x-device-id` header — never from a
device-supplied body field.

## Commands (`d/{deviceId}/cmd`)

Envelope:
```json
{ "commandId": "cmd_...", "type": "...", "action": "..." | null, "payload": ... }
```

| type | action | payload | meaning |
|---|---|---|---|
| `reboot` | — | — | Restart the device. |
| `refresh` | — | — | Re-request config now (device re-publishes to `cfg/get`). |
| `identify` | — | — | Blink the idle screen's online-status dot a few times, to locate the device. |
| `config-changed` | — | full config (see below) | Pushed proactively on a branding/device-settings save, or in answer to a `cfg/get` request. |
| `firmware-update` | — | `{ version, url, sha256, size }` | OTA manifest; `url` is a presigned R2 URL for the binary, valid 600s. |
| `trigger` | `"show_qr"` | `{ url }` | Render a QR pointing at `url`. |
| `pin` | — | `{ url: string \| null }` | Set/clear the device's pinned override URL. |

`reboot`, `refresh`, `identify`, and `firmware-update` are the only types an
operator can enqueue manually (from the admin/tenant UI); `trigger`,
`config-changed`, and `pin` are system-originated only.

The `config-changed` payload is the device's full display config — brand
colors/tokens, the printer screen layout with image URLs presigned fresh for
300s, device settings (brightness, sleep, settings PIN), the resolved pinned
URL (if any), and the `mqtt` broker block. It is **always the complete
config**, not a diff and not version-gated: every claimed device gets the
full payload on every push. Config and OTA payloads are built fresh at
publish time and never persisted on the `deviceCommand` row, because their
URLs are short-lived — a stale row is rebuilt (not replayed) if it needs to
be republished.

A command that goes unacknowledged is republished on the next heartbeat
(after ~60s, up to ~15 minutes old), except a `trigger`, which expires
instead — a QR is for the customer standing at the counter *now*, so a late
delivery would show a stranger's code.

## Config request (`cfg/get`)

The device publishes an empty JSON object (`{}`) to `d/{deviceId}/cfg/get`
once per MQTT connection — on boot and on every reconnect — to ask for its
current config immediately rather than waiting for the next heartbeat. It
never polls on a timer. The cloud answers by publishing a fresh
`config-changed` command on `cmd`.

## Ack (`d/{deviceId}/ack`)

```json
{ "commandId": "cmd_...", "ok": true, "result": "optional string" }
```
`ok: true` marks the command `acked`; anything else marks it `failed`. A
`trigger` ack settles or releases the credit hold reserved when it was
enqueued. Acks are scoped server-side to the acking device's own commands —
`commandId` alone is device-supplied and not trusted for that.

## Heartbeat (`d/{deviceId}/hb`)

```json
{ "version": "0.18.0", "heap": 123456, "fonts": 4, "afetch": 0, "aimg": 0, "cfgimg": 0, "cfgstat": 0, "cfgparse": 0 }
```
`version` is the running firmware version — reported here, not in an HTTP
header. `heap` is free internal DRAM (bytes) and `fonts` is font-cache slots
in use; `afetch`/`aimg`/`cfgimg`/`cfgstat`/`cfgparse` are image-render
diagnostics and may be negative (e.g. a TLS error code). A heartbeat also
bumps the device's last-seen/online status and drives the republish and OTA
reconcile described above.

A device that stops sending heartbeats and MQTT presence goes offline (the
daily health cron is the backstop reconciler for any missed disconnect
event); a device that never opens an MQTT connection cannot receive commands
at all.
