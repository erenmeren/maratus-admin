# M6b — OTA firmware update

**Date:** 2026-06-20
**Status:** Approved (design); implementation plan(s) to follow.
**Repos:** maratus-admin (cloud: publish + manifest + admin UI) + maratus-firmware (OTA client).
Completes the M6 section of `2026-06-14-maratus-firmware-design.md` (provisioning shipped in
M6a/M6a-2).

## Goal

Publish a firmware build from the dashboard; devices update over-the-air — **both**
automatically on their poll cadence **and** on an admin-issued command — with **rollback
safety**. The partition table is already A/B-capable (`factory` + `ota_0` + `ota_1` +
`otadata`, 2 MB each, ~486 KB headroom; `esp_https_ota` available).

## Decisions (locked during brainstorming)

1. **Trigger = both.** The device auto-checks the manifest on its poll cadence AND an admin
   can force an immediate update via a `firmware-update` command. Both run the same OTA path.
2. **Publish = admin UI upload.** A platform-admin page uploads the `.bin`; the server
   computes SHA-256, stores it in R2, and records a release row.
3. **Version compare = simple `!=`** (publishing is the intent; no semver on-device). The
   latest published release is the fleet target.
4. **Rollback enabled.** `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`; mark-valid only after a
   healthy post-OTA check-in; auto-revert on boot failure.
5. **Out of scope:** per-device/channel/cohort targeting, staged rollouts, delta updates,
   anti-rollback version fuses.

## Architecture overview

```
  admin (platform)                         device (poll loop / on command)
  ────────────────                         ──────────────────────────────
  upload maratus-firmware.bin (vN+1)
   → server sha256 + putObject(R2)
   → insert firmwareRelease row (latest)
                                           1. GET /api/device/firmware (device-key) ──┐
                                              ← { version, url(presigned R2), sha256,  │
                                                  size }   (or empty if none)          │
                                           2. if version != running (or forced):       │
                                              esp_https_ota(url) → verify → set boot ──┘
                                              → reboot (new image: pending-verify)
                                           3. healthy check-in (GET /commands 200)
                                              → esp_ota_mark_app_valid (cancel rollback)
                                              → reports x-device-version = vN+1
  device.firmwareVersion updated from the x-device-version header on the next poll.
```

## Cloud (maratus-admin)

### Data model — `firmwareRelease` table
New table (one Drizzle migration):
- `id` (pk, `id("fwr")`), `version` (text, **unique**), `r2Key` (text),
  `sha256` (text, hex), `sizeBytes` (integer), `createdAt` (timestamp),
  `createdByUserId` (text). "Latest" = the row with the newest `createdAt`.
- `device.firmwareVersion` already exists and is updated from the `x-device-version` header
  on each poll (existing behavior) — no schema change there.

### Publish (platform-admin only)
- A **"Firmware"** admin page (`app/(admin)/admin/firmware/…`) listing releases + an upload
  form (version string + `.bin` file).
- Server action / route handler (`requirePlatformAdmin`): accept multipart upload of the
  `.bin` (~1.5 MB), compute SHA-256, `putObject(firmwareStorageKey(version), bytes,
  "application/octet-stream")`, insert the `firmwareRelease` row. Reject a duplicate version.
- `lib/storage.ts`: add `firmwareStorageKey(version)` → `firmware/<version>/maratus-firmware.bin`.

### Manifest endpoint — `GET /api/device/firmware`
- `app/api/device/firmware/route.ts`, **device-key auth** (reuse `authenticateDevice`,
  like `/commands`). Doubles as a heartbeat is NOT required (commands already does that).
- Look up the latest `firmwareRelease`. None → `204` (or `200 {}`). Else →
  `200 { version, url, sha256, size }` where `url` = `presignedGetUrl(r2Key, 600)` (10-min TTL;
  a 1.5 MB OTA download is seconds, but allow slack).
- Pure decision helper `latestFirmwareManifest(release | null)` (DB-free) → unit-tested.

### Command + admin UI
- `firmware-update` already needs to exist in the `deviceCommand` `type` enum — confirm/add it
  (the enum currently has `reboot`/`refresh`/`identify`/`config-changed`). Add `firmware-update`.
- `components/devices/command-bar.tsx`: add an **"Update firmware"** action (enqueues
  `firmware-update`).
- Device detail page: show **running** (`device.firmwareVersion`) vs **latest published**
  version (read the latest release), so the admin sees whether an update is available.

## Firmware (maratus-firmware)

### New `ota` component
- `ota_check_and_update(bool forced)`:
  1. `cloud_get_firmware(manifest)` → fetch `GET /api/device/firmware`.
  2. If no release, or `manifest.version == appcfg_fw_version()` and not forced → return (no-op).
  3. `esp_https_ota` from `manifest.url` (HTTPS, `esp_crt_bundle_attach`) into the inactive
     OTA partition. **Primary integrity** = the ESP app-image's built-in SHA-256, validated by
     the bootloader at boot (a corrupted/truncated download fails validation → rollback). The
     manifest `sha256` is recorded and MAY be verified against the written image if cheaply
     feasible (e.g. `esp_partition_get_sha256`), but is not the primary guard — do not block the
     plan on a stream-hash mechanism the simple esp_https_ota API doesn't expose.
  4. `esp_ota_set_boot_partition(new)` → `esp_restart()`.
- `cloud_get_firmware()` in the `cloud` component: device-key GET to `/api/device/firmware`,
  parse `{version,url,sha256,size}` (cJSON), handle empty/204.

### Triggers
- **Auto:** in the poll loop (`app_state.c`), call `ota_check_and_update(false)` every Nth
  idle poll (e.g., every ~10 min, not every poll) to limit churn.
- **Command:** add a `firmware-update` case to `commands_handle_body` → `ota_check_and_update(true)`
  (ack first, since the OTA reboots). Also wire `refresh` → config refresh while here (it's in
  the cloud enum but currently treated as unknown) — small consistency fix, optional.

### Rollback safety
- Enable `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y`. On boot of a freshly-OTA'd image (state
  `ESP_OTA_IMG_PENDING_VERIFY`), the app must call
  `esp_ota_mark_app_valid_cancel_rollback()` only after a **healthy check-in** — concretely,
  after the first successful `GET /commands → 200` post-boot. If the new image crashes/boot-loops
  before marking valid, the bootloader reverts to the previous partition.
- On boot, if running from a pending-verify image, the poll loop sets a flag and marks valid on
  the first 200.

### Version reporting
- After the OTA reboot the device reports `x-device-version = <new version>` (already wired via
  `appcfg_fw_version()` ← `CONFIG_MARATUS_FW_VERSION`, baked into the build). The cloud updates
  `device.firmwareVersion` from that header (existing behavior). So the published version string
  MUST match the `CONFIG_MARATUS_FW_VERSION` of the uploaded build.

## Error handling

- Manifest fetch fails / 204 → no-op, retry next cycle.
- `esp_https_ota` download/verify fails → abort, stay on current image, log, retry next cycle
  (no partition switch).
- Presigned URL expired mid-download (rare) → fail → retry (fresh URL next manifest fetch).
- Bad image that boots but is unhealthy → never marked valid → auto-rollback on next reset.
- Duplicate version publish → rejected (unique constraint) with a clear admin error.
- OTA only attempted when Wi-Fi connected.

## Testing

- **Host (cfg-harness):** version-compare (`!=`, equal, empty) + manifest JSON parse
  (`{version,url,sha256,size}` vs empty/malformed).
- **Cloud (vitest):** `latestFirmwareManifest` pure helper; `firmwareStorageKey`; publish
  action validation (duplicate version rejected). Endpoint verified by curl (no release → 204;
  after publish → manifest).
- **Device:** `idf.py build` clean; rollback config present.
- **HIL:** publish vN+1 (built with that version) via the admin page → device auto-updates (and
  test the "Update firmware" button path) → reboots → reports vN+1 → marks valid (survives
  power-cycle). Negative: publish a deliberately-bad image → device fails to boot it → bootloader
  rolls back to vN (still online).

## Out of scope (future)

- Channels / per-device / cohort / staged rollouts; delta (patch) updates; anti-rollback
  security version; auto-publish from CI; signed-image verification beyond the ESP image hash.
