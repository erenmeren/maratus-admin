# Firmware M7 — Device Policies Design

**Date:** 2026-06-21
**Status:** Approved (design)
**Repo:** implementation in `maratus-firmware` (ESP-IDF 5.5 C + LVGL v9, ESP32-P4 Waveshare board); spec lives in maratus-admin as the cross-cutting record.
**Depends on:** the cloud Device Settings feature (shipped 2026-06-21) — `/api/device/config` already delivers everything this milestone consumes. No cloud changes.

## Overview

The cloud Device Settings page lets a tenant set org-wide device policies (QR visible duration, screen brightness, sleep on/off + inactivity timeout, on-device Settings PIN), and the cloud already delivers them in the `/api/device/config` payload. **Today the firmware ignores all of them except QR duration** (already honored via M5c-2). M7 makes the firmware consume and honor the rest.

QR visible duration is already done (M5c-2 reads `config.qrTimeoutSeconds`, which the cloud now overlays from the `qrVisibleSeconds` column — no firmware change needed). M7 covers the remaining three settings, as one milestone in three independently flashable/HW-verifiable phases:

- **Phase A — Brightness:** apply `device.brightness` to the LCD backlight.
- **Phase B — Sleep/wake:** inactivity → display off; wake on touch or on a printed receipt.
- **Phase C — PIN-gated Settings page:** long-press → SHA-256 PIN gate → device info + Wi-Fi setup + Test print + Reboot.

## The cloud contract (already live)

`GET /api/device/config` (device-key authed, TLS, ETag-versioned) returns, in addition to existing brand/config fields:

```json
"device": {
  "brightness": 100,
  "sleep": { "enabled": false, "timeoutSeconds": 300 },
  "settingsPasswordHash": null,
  "settingsPasswordSalt": null
}
```

- `brightness` 10–100 (cloud-clamped). `sleep.timeoutSeconds` 30–3600. `settingsPasswordHash` = `sha256(salt + pin)` (64 hex chars) or null when unset; `settingsPasswordSalt` paired. A change to any of these bumps the config ETag, so the device re-pulls on its next poll; saving also broadcasts the existing `config-changed` command. `config.qrTimeoutSeconds` is the QR duration (unchanged contract).

## 1. Config model + parsing (shared foundation)

**Files:** `components/devcfg/include/device_config.h`, `components/devcfg/cfg_parse.c`, host tests in `tools/cfg-harness/`.

Extend `device_config_t` with a `device` sub-struct:

```c
struct {
    int  brightness;                 // 10..100
    struct { bool enabled; int timeout_seconds; } sleep;  // timeout 30..3600
    char settings_password_hash[65]; // sha256 hex (64) + NUL; "" when unset
    char settings_password_salt[33]; // salt + NUL; "" when unset
} device;
```

Parse the new `device` block in `cfg_parse_json` with cJSON, mirroring the existing `qr_timeout_seconds` block (lines ~142–145). Defensive clamping on-device: brightness → 10–100, timeout → 30–3600. Missing/null `device` block → defaults `{brightness:100, sleep:{false,300}, hash:"", salt:""}`. Hash/salt copied as bounded strings (`copy_str`). NVS caching + ETag round-trip already work once the fields are in the struct (raw JSON is persisted and reparsed at boot).

**Host-tested** (cfg-harness `make test`): parse a payload with a full `device` block; assert clamping, defaults on missing block, and hash/salt copy.

## 2. Phase A — Brightness

**Files:** `main/app_state.c` (config-apply path + boot cached-config path).

`bsp_display_brightness_set(int duty)` (0–100, Waveshare BSP) already exists; it's called once at boot (`app_main.c:92`). Add a runtime apply:

1. In the poll-loop config-apply block (`app_state.c`, right after `ui_set_config(...)`): `bsp_display_brightness_set(cfg->device.brightness)`.
2. In the boot cached-config path: apply the cached brightness so the panel is correct before the first network fetch.

When asleep (Phase B), the apply must not turn the backlight back on — guard with the display-power state (apply brightness only when awake; sleep/wake owns the backlight). HW-verify: change brightness in admin → panel dims/brightens within a poll cycle (~12s).

## 3. Phase B — Sleep / wake

**Files:** `main/app_state.c`, `components/ui/ui.c` (activity flag + wake helpers), host test for the decision function.

State:
- `s_last_activity_ms` — wall/uptime ms of last activity.
- `s_display_asleep` — bool, single-writer (poll task).

Activity sources (each updates `s_last_activity_ms`):
- **Any touch.** Add an activity flag set on `LV_EVENT_PRESSED` in `ui.c` (distinct from the existing `s_tap_requested`/CLICKED flag used for test-ingest), consumed by the poll task via `ui_consume_activity()`.
- **Receipt/state transitions** — `render_job` publishing PROCESSING/QR (a print job) counts as activity.

Decision (pure, host-tested):
```c
bool should_sleep(uint32_t now, uint32_t last_activity,
                  int timeout_s, bool enabled, dev_state_t state);
// true iff enabled && state==DEV_IDLE && (now - last_activity) >= timeout_s*1000
```

Loop integration: the existing fine-grained idle slice (~500ms, used by the countdown auto-return) also evaluates `should_sleep`. On true → `bsp_display_backlight_off()`, set `s_display_asleep`.

Wake:
- **Touch while asleep** → restore `bsp_display_brightness_set(cfg->device.brightness)` + `bsp_display_backlight_on()`, clear `s_display_asleep`, reset `s_last_activity_ms`, and **consume the touch as wake-only** (do NOT fire test-ingest for that touch).
- **Receipt printed while asleep** → the PROCESSING/QR transition wakes the display and shows the QR (chosen behavior: a print job must be visible).
- `sleep.enabled == false` → never sleep; keep the backlight on at the configured brightness.

Sleep only engages in `DEV_IDLE`, so it never blanks a live receipt/QR. After the QR countdown auto-returns to idle, the inactivity timer restarts.

HW-verify: enable sleep (short timeout) → screen off after timeout → touch wakes (no spurious ingest) → print a receipt while asleep → wakes + shows QR.

## 4. Phase C — PIN-gated Settings page

**Files:** new `components/ui/ui_settings.c` (+ header), reuse `components/ui/ui_wifi.c`, `main/app_state.c` (long-press wiring, state coordination), host test for PIN verify.

Entry:
- `LV_EVENT_LONG_PRESSED` on the idle screen opens the Settings flow. (Long-press chosen over corner-taps: discoverable, low accidental-trigger risk; touch is the only input.)

Gate:
- If `settings_password_hash` is non-empty: show an on-screen **numeric keypad** (new screen in `ui_settings.c`). On submit, compute `sha256(salt + entered_pin)` via **mbedtls** (`mbedtls/sha256.h`, enabled by default in IDF) and **constant-time compare** to the stored hash. Correct → Settings menu. Incorrect → "Incorrect PIN", clear the entry, allow retry (no lockout in M7).
- If the hash is empty (no PIN set): open the Settings menu directly (ungated).

Settings menu (LVGL screen):
- **Device info (read-only):** device name, device ID, firmware version (`CONFIG_MARATUS_FW_VERSION`), Wi-Fi SSID + RSSI, IP address, online status. Fields not already exposed get small accessors (`net_get_ssid` / `net_get_rssi` / `net_get_ip`) added to the `net` component as needed.
- **Buttons:** **Wi-Fi setup** (reuse the existing `ui_wifi` provisioning screen), **Test print** (run the existing self-test ingest path), **Reboot** (`esp_restart()`), **Close** (return to idle).

PIN verify is a pure function (`settings_pin_verify(pin, hash, salt)`), **host-tested** against vectors generated with the same `sha256(salt+pin)` scheme the cloud uses.

Interaction precedence on the idle screen:
- Asleep + any touch → wake only.
- Awake + long-press → open Settings.
- Awake + short tap → existing test-ingest behavior (unchanged).

While the Settings/Wi-Fi screens or the keypad are open, sleep is suspended (treated as activity / non-idle).

## 5. Testing

- **Host (cfg-harness `make test`):** device-block parser (clamp + defaults + hash/salt copy), `should_sleep` decision table, `settings_pin_verify` against known vectors, brightness clamp.
- **On-device HIL, per phase:**
  - A: brightness change from admin reflected on the panel.
  - B: sleep after timeout; wake on touch (no spurious ingest); wake on receipt (QR shown).
  - C: long-press entry; correct + incorrect PIN; each Settings action (Wi-Fi setup, Test print, Reboot, Close); ungated entry when no PIN set.

## 6. Build / flash

ESP-IDF 5.5 (`. ~/.espressif/v5.5/esp-idf/export.sh`), `idf.py set-target esp32p4 && idf.py build`; after first managed-component fetch run `./tools/patch-deps.sh`. Flash via the USB-to-UART port (`idf.py -p <port> flash`). Read logs with `python tools/read-console.py` (not `idf.py monitor` — its DTR/RTS forces download mode on this board).

## Decisions (resolved)

- All three settings in **one milestone**, three phased HW-verifiable slices.
- Sleep = **screen sleep** (backlight off, CPU keeps polling); **wakes on touch or on a printed receipt**; engages only while idle.
- Settings page = **device info + Wi-Fi setup + Test print + Reboot**, entered by **long-press**, gated by **SHA-256** PIN (constant-time compare), ungated when no PIN set.
- Incorrect PIN simply retries (no lockout in M7).
- Existing debug short-tap → test-ingest stays as-is.
- Brightness/sleep clamped defensively on-device even though the cloud already clamps.

## Out of scope / deferred

- PIN attempt lockout / backoff.
- Deep sleep (CPU power-down) — rejected; the device must stay reachable for receipts and commands.
- Removing the debug short-tap test-ingest path (separate cleanup).
- Per-device (non-org-wide) overrides.

## Files touched (firmware)

- `components/devcfg/include/device_config.h` — `device` sub-struct
- `components/devcfg/cfg_parse.c` — parse `device` block
- `components/ui/ui.c` — `LV_EVENT_PRESSED` activity flag, `ui_consume_activity`, long-press entry hook, wake helpers
- `components/ui/ui_settings.c` (new) — keypad + Settings menu screens
- `components/net/` — `net_get_ssid`/`net_get_rssi`/`net_get_ip` accessors (as needed)
- `main/app_state.c` — brightness apply, sleep/wake loop logic, long-press → settings, state coordination
- `main/app_main.c` — boot cached-brightness apply
- `tools/cfg-harness/` — host tests for parser, `should_sleep`, `settings_pin_verify`
