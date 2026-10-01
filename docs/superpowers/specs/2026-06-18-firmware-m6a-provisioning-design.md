# M6a — On-screen device provisioning (claim flow)

**Date:** 2026-06-18
**Status:** Approved (design); implementation plan to follow.
**Repos:** maratus-admin (cloud) + maratus-firmware (device). Continues the M6 section of
`2026-06-14-maratus-firmware-design.md`.

## Goal

A fresh device with no device key shows a **pairing code on its setup screen**. The
merchant types that code into the dashboard and picks a store. The device polls the
cloud, receives its device key **once**, stores it in NVS, and activates — with **no
hand-pasted keys**.

This slice is **claim-flow only**. Wi-Fi credentials still come from `sdkconfig`
(Kconfig) — on-screen Wi-Fi is a later slice (M6a-2).

## Decisions (locked during brainstorming)

1. **Device-first provisioning** (per the M6 spec): the *device* generates the
   pairing code, not the admin.
2. **Scope = claim flow only**; on-screen Wi-Fi deferred.
3. **`claimDevice` becomes create-or-bind**: supports both a device-generated code
   (no pre-existing row → create) and the legacy admin "Add device" pre-seeded row
   (→ bind). Both models coexist.
4. **Code format stays human-typeable `XXXX-XXXX`** (reuse the existing
   `pairingCode()` generator) — the merchant reads it off the screen and types it.
5. **One-time key delivery via a nullable column** (`device.pendingDeviceKey`),
   cleared on the device's first successful fetch. TTL/expiry deferred.

## Architecture overview

```
  fresh device (no key in NVS)                      dashboard (merchant)
  ────────────────────────────                      ────────────────────
  1. gen XXXX-XXXX code → NVS
  2. show SETUP screen (code + steps)
  3. poll GET /api/device/claim?code= ── pending ──> (waiting)
                                                      4. merchant types code + picks store
                                                         claimDevice(code, store):
                                                           create-or-bind row,
                                                           mint key, store hash,
                                                           pendingDeviceKey = rawKey,
                                                           KEEP pairingCode
  5. poll … ── {status:claimed, deviceKey} ──────────  (row now has pendingDeviceKey)
     store key in NVS;
     cloud nulls pendingDeviceKey + pairingCode (consume, deliver once)
  6. re-init cloud auth → DEV_IDLE (active)
```

## Cloud (maratus-admin)

### Data model
- Add nullable column **`device.pendingDeviceKey: text`** — the raw device key, held
  only between claim and the device's first fetch. New Drizzle migration
  (`db:generate` + `db:migrate`). No other schema changes (`pairingCode`,
  `deviceKeyHash`, `claimedAt`, `storeId` already exist).

### `claimDevice(pairingCode, storeId)` → create-or-bind
`lib/receipts.ts`. Change from "look up existing row, throw if missing, null the code"
to:
- Look up device by `pairingCode`.
  - **Found + unclaimed:** bind (today's behavior) — set `storeId`, mint key, set
    `deviceKeyHash`, `claimedAt`, `status="offline"`.
  - **Found + already claimed:** throw `"Device already claimed"` (unchanged).
  - **Not found:** **create** a new device row in the store's organization
    (`id()`, `name` default, `connectionType="wifi"`, etc.), bound to `storeId`,
    with the same key/hash/claimedAt.
- In all create-or-bind cases also set **`pendingDeviceKey = rawKey`** and **KEEP
  `pairingCode`** (today it nulls it immediately — that must change so the device can
  still poll by code to fetch the key).
- Validate the store belongs to a real org (as today). The new device's
  `organizationId` is derived from the store.
- Still returns the raw key to the caller (legacy hand-paste fallback), but the
  dashboard de-emphasizes it (see UX).
- Unique-constraint violation on insert (two devices generated the same code) →
  surface a `"Pairing code already in use"` error.

### New endpoint `GET /api/device/claim?code=<code>`
`app/api/device/claim/route.ts`. **Unauthenticated** (no Bearer — the device has no
key yet), gated by the high-entropy-enough code, **rate-limited**.
- Missing/empty `code` → `400`.
- No row with that `pairingCode` → `200 {status:"pending"}`.
- Row found, `pendingDeviceKey` set → `200 {status:"claimed", deviceKey:<raw>}`, then
  in the same request **null `pendingDeviceKey` and `pairingCode`** (deliver once,
  consume the code).
- Row found, `pendingDeviceKey` null (already delivered, or hand-paste path) →
  `200 {status:"claimed"}` (no key).
- Rate-limit per code/IP to blunt code-guessing.

### Dashboard UX
- `claimDeviceAction` + `ClaimDeviceDialog`: change the success state from "here's the
  key to paste into the device" to **"Device claimed — it will activate shortly."**
  The raw key is still returned by the action (legacy fallback) but no longer the
  primary instruction.
- The admin "Add device" (`provisionDevice`) path is unchanged and still works
  (create-or-bind binds the pre-seeded row).

## Firmware (maratus-firmware)

### Boot decision
On boot, read the device key from **NVS** (namespace `ditto`, key `device_key`):
- **Present** → normal flow (today): `appcfg_device_key()` returns the NVS key, proceed
  to poll/idle.
- **Absent** → **provisioning mode** (below).
`appcfg_device_key()` reads NVS first, falls back to the Kconfig default.

### Provisioning mode
1. Generate a `XXXX-XXXX` code if none is stored: unambiguous alphabet, `esp_random()`;
   persist in NVS (so it survives reboots until claimed).
2. Connect Wi-Fi (Kconfig creds, as today).
3. Render the **setup screen** (`DEV_SETUP` → `SCREEN_SETUP`). Add `DEV_SETUP` to
   `dev_state_t` and map it in `screen_for_state` if not already present.
4. Run the **claim-poll loop**: `cloud_claim_poll(code, keybuf, len)` →
   `GET /api/device/claim?code=` every few seconds with backoff.
   - `{status:"pending"}` → keep showing setup, keep polling.
   - `{status:"claimed", deviceKey}` → store key in NVS, clear the stored code,
     re-init cloud auth, transition to `DEV_IDLE` (active). A reboot is an acceptable
     simple transition if cleaner than live re-init.

### Widgets (currently placeholders → implement)
- **`OBJ_PAIRING_CODE`**: render the device's code prominently (large, centered),
  driven by a new `ui_set_pairing_code(code)` setter (mirrors `ui_set_qr_url`). Match
  the branding-preview `PairingCodeObject` (label + large mono code).
- **`OBJ_STEPS`**: render the numbered provisioning steps (e.g. "1. Open your Maratus
  dashboard  2. Add a printer  3. Enter this code"). Match the preview `StepsObject`.
- The setup screen's seeded layout already positions logo/title/sub/steps/pairingCode/
  QR. The QR optionally encodes a claim deep-link (`{BASE}/…?code=`) — minor, may be
  left showing the code or omitted in M6a.

### Firmware config / cloud
- New `cloud_claim_poll()` in the `cloud` component: unauthenticated GET (no Bearer),
  parse `{status, deviceKey}` (cJSON, like the config parser).
- NVS helpers to read/write `device_key` and the pending `pairing_code`.

## Security & error handling

- The code is a **capability**: only on the device's physical screen, endpoint
  **rate-limited**, key delivered **once**. `XXXX-XXXX` (~10¹²) entropy is adequate
  given those gates (matches the spec's accepted model).
- Device claim-poll network/HTTP errors → retry with backoff; stay on setup.
- Key already delivered (device re-polls) → `{status:"claimed"}` no key; device already
  has it in NVS and won't re-poll.
- Two devices generate the same code → unique-constraint error on the second claim
  ("code in use"); negligible at this entropy.
- Never-fetched pending key (device offline after claim) → `pendingDeviceKey` +
  `pairingCode` linger. Accepted for M6a; TTL/expiry is a later refinement.
- NVS write failure → log + retry; device stays in provisioning until the key persists.

## Testing

- **Cloud (vitest):**
  - `claimDevice` create-or-bind: creates a new row when no code matches; binds an
    existing pre-seeded row; rejects an already-claimed device; sets
    `pendingDeviceKey` and keeps `pairingCode`.
  - `GET /api/device/claim` state machine: `pending` (no row) → `claimed`+key (after
    claim) → `claimed` no-key (after first fetch); code consumed on delivery.
- **Firmware (cfg-harness host tests):**
  - Pairing-code generator: length/format `XXXX-XXXX`, alphabet excludes ambiguous
    chars, well-distributed.
  - Claim-poll response parser: parses `pending` vs `claimed`+`deviceKey`; rejects
    malformed JSON.
- **Hardware (HIL):** erase NVS → device boots to setup screen showing the code →
  claim in the dashboard with a store → device fetches key, activates, lands on idle →
  a receipt (ESC/POS harness) round-trips → key survives reboot (no re-provision).

## Out of scope (future slices)

- **On-screen Wi-Fi** (SSID scan + on-screen keyboard + Wi-Fi creds → NVS) — M6a-2.
- **OTA** (A/B partitions + `esp_https_ota` + `GET /api/device/firmware`) — M6b.
- Pending-key **TTL/expiry**, device-side **code rotation**, claim-endpoint
  abuse hardening beyond basic rate-limiting.
