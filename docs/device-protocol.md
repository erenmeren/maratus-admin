# Ditto Device Protocol

All device endpoints authenticate with the device key:
`Authorization: Bearer <deviceKey>` (issued once at claim). Optional header
`X-Device-Version: <semver>` reports the app/firmware version (stored as the device firmware version, shown on the device detail page).

## POST /api/ingest
Upload a rendered receipt (multipart `file`, or JSON `{ image: base64 }`).
Returns `{ token, url }`. Also acts as a heartbeat.

## GET /api/device/commands
Poll for pending commands. Recommended interval: 30–60s. Response:
`{ "commands": [ { "id": "cmd_…", "type": "reboot" | "refresh" | "identify" } ] }`.
Returned commands are marked **delivered**. This call is also a heartbeat
(updates last-seen + version).

## POST /api/device/commands/ack
Body: `{ "commandId": "cmd_…", "ok": true|false, "result": "optional string" }`.
Marks the command `acked` (ok) or `failed`.

## Commands
- `reboot` — restart the device.
- `refresh` — re-pull config/branding.
- `identify` — briefly flash the screen to locate the kiosk.

A device that does not poll `GET /api/device/commands` cannot receive commands;
remote control requires firmware support for this loop.
