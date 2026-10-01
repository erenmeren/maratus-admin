# M5c-1: live clock, wifi, spinner + state→screen mapping

**Date:** 2026-06-17
**Status:** Approved (design)
**Repos:** maratus-firmware (device) + maratus-admin (config payload)
**Parent spec:** `2026-06-15-device-config-driven-ui-design.md` (M5a/b/c), branch `docs/m5-config-driven-ui-spec`

## Problem

M5a/M5b made the device render branding screens from config (text, colors, logo,
icons). The remaining "dynamic" object types — `clock`, `wifi`, `spinner`,
`countdown`, `pairingCode`, `steps` — still render as faint placeholder outlines
(`render_placeholder`). M5c makes them live. The device also has **no time
source** (no SNTP) and the screen-selection logic is scattered across
`app_state.c`/`render_job.c` as ad-hoc `ui_show(...)` calls.

## Scope (M5c-1)

This pass: **clock** (with SNTP + timezone), **wifi**, **spinner**. `qr` is
already live (M3/M5a).

**Already in place (no work needed) — verified in firmware:** the state→screen
mapping is done. `screen_for_state(dev_state_t)→dev_screen_t` exists in
`components/devcfg/render_geom.c` (pure, host-tested as `test_map`),
`ui_render_state()` wraps it, and all call sites (`app_main.c`,
`render_job.c`, `app_state.c`) already use `ui_render_state(...)` /
`ui_set_qr_url(...)` — there are no scattered `ui_show(...)` calls. M5c-1 simply
renders live widgets inside these already-correct screens.

**Deferred:**
- `countdown` → M5c-2 (needs a duration source; lower visibility).
- `pairingCode` + `steps` → land with **M6 provisioning** (the pairing code is
  device-generated during provisioning; steps are setup-flow instructions).

## Decisions

1. **Timezone: admin sends a POSIX TZ string.** The branding editor stores an
   IANA name (e.g. `America/New_York`) from the curated ~19-zone list in
   `lib/timezones.ts`. `getDeviceConfig` converts IANA→POSIX (e.g.
   `EST5EDT,M3.2.0,M11.1.0`) via a bounded lookup map and puts the POSIX string
   in the payload's `clockTimezone`. The device just does `setenv("TZ", …);
   tzset()`. No on-device tz database; DST-correct. The branding clock controls
   (timezone + `clock24h`) **do** drive the device clock.
2. **Clock shows time from SNTP, not a hand-set value.** The editor picks the
   zone + 12h/24h format; the device gets the real current time over the network.
   Until the first SNTP sync the clock renders a placeholder (`--:--`).
3. **Wifi widget = live RSSI.** The device shows its actual signal (0–4 bars from
   `esp_wifi_sta_get_rssi`). The branding `wifiLevel` slider is **preview-only**
   (a tenant can't know a given printer's real reception). It is used at most as
   the initial value before the first RSSI read.
4. **Spinner is pure animation** (`lv_spinner`), no data input.
5. **In-place widget updates, not screen rebuilds.** Live widgets are real LVGL
   objects updated through a small per-active-screen widget registry + LVGL
   timers. Rebuilding the whole screen each tick (flicker/churn) is rejected.
6. **State→screen mapping is already a pure table** (`screen_for_state`, M5a) —
   M5c-1 reuses it as-is, no change.

## Components

### 1. Admin — IANA→POSIX timezone (`maratus-admin`)

- New `lib/posix-tz.ts`: `IANA_TO_POSIX: Record<string,string>` covering every
  zone in `lib/timezones.ts`, plus `ianaToPosix(iana: string): string` returning
  the POSIX TZ (fallback `"UTC0"` for an unknown/missing zone).
- `lib/data.ts#getDeviceConfig`: when building the payload, convert the stored
  IANA `clockTimezone` to POSIX via `ianaToPosix` so the payload (and thus the
  device's `clock_timezone`) carries POSIX.
- `computeConfigVersion`/ETag stays keyed on the **stored** config (IANA); POSIX
  is a deterministic derivation, so version stability is unaffected.
- Tests (`lib/posix-tz.test.ts`): every `lib/timezones.ts` value maps to a
  non-empty POSIX string; unknown → `"UTC0"`; a spot-check of a DST zone
  (`America/New_York`) and a non-DST zone (`Asia/Kolkata`, `UTC`).

### 2. Firmware — `time_sync` (new, small) (`maratus-firmware`)

- `time_sync_start()`: start `esp_netif_sntp` (pool.ntp.org) once Wi-Fi is up
  (called from the existing post-connect path).
- On config apply: `setenv("TZ", cfg->clock_timezone, 1); tzset();` (POSIX string
  from the payload). Invalid/empty → `"UTC0"`.
- `time_is_synced()` → bool (true after the first successful SNTP update). Backs
  the clock placeholder logic.
- The RTC keeps running across network loss, so the clock keeps ticking offline
  after the first sync.

### 3. Firmware — live widgets in `ui.c`

Replace the placeholder branches in `build_screen`'s object switch:
- `OBJ_CLOCK` → a label registered in the widget registry; a 1 Hz `lv_timer`
  formats `localtime(now)` per `clock_24h` and the per-object
  `clock_show_date`/`clock_show_weekday`, styled `brand_fg` + `font_cache_get`.
  Renders `--:--` (no date) until `time_is_synced()`.
- `OBJ_WIFI` → an N-bar indicator (4 bars); current level from a stored
  `s_wifi_level` updated by `ui_set_wifi_level`.
- `OBJ_SPINNER` → `lv_spinner` (built-in arc animation), `brand_accent`.

### 4. Firmware — widget registry + setters

- Per-active-screen handles (`s_clock_lbl`, `s_clock_timer`, `s_wifi_obj`,
  `s_spinner_obj`, `s_wifi_level`) cleared to NULL under the LVGL lock on each
  `build_screen` — the exact pattern already used for `s_status_dot`, so a
  setter/timer never touches a freed object across a screen swap.
- `ui_set_wifi_level(int level0to4)`: clamps, stores, repaints the wifi widget
  if present (locked).
- The clock `lv_timer` is parented/tracked so it's deleted with the screen (no
  orphaned timer firing on a deleted label).

### 5. Firmware — state→screen mapping (ALREADY DONE, no change)

`screen_for_state(dev_state_t)→dev_screen_t` (`components/devcfg/render_geom.c`,
host-tested as `test_map`) and `ui_render_state()` already exist, and every call
site uses them. M5c-1 makes no change here — listed only to confirm the live
widgets render inside the correct already-routed screens.

### 6. Firmware — RSSI poll

- In the existing poll task (or a light dedicated timer), read
  `esp_wifi_sta_get_rssi` periodically, bucket to 0–4 (e.g. ≥-55→4, -65→3,
  -75→2, -85→1, else 0), and call `ui_set_wifi_level`. Initial value = config
  `wifi_level` until the first read.

## Data flow

Wi-Fi up → `time_sync_start` (SNTP) + first RSSI read. Config apply →
`setenv(TZ)` + `ui_set_wifi_level`. Clock `lv_timer` ticks `localtime` each
second. State change → `ui_render_state(state)` → `ui_screen_for_state` →
`build_screen` with live widgets registered.

## Error / edge handling

- SNTP not yet synced → clock placeholder `--:--`.
- Network loss after sync → RTC keeps ticking; wifi widget drops toward 0 bars as
  RSSI reads fail/weaken.
- Missing/invalid POSIX TZ → `"UTC0"`.
- A screen with no clock/wifi/spinner object → registry handles stay NULL;
  setters/timers are no-ops.

## Testing

- **Host (`tools/cfg-harness`):** add a pure clock-format helper
  (`format_clock(struct tm, bool h24, bool date, bool weekday) → string`) and
  unit-test it off-device (12h/24h, with/without date+weekday, midnight/noon
  edges). The state→screen mapping is already covered by the existing `test_map`.
- **Admin (vitest):** `lib/posix-tz.test.ts` as above.
- **Hardware:** clock ticks in the tenant timezone and flips 12h/24h when the
  branding setting changes; wifi bars track real signal; spinner animates on the
  processing screen; all states route to the right screen; receipt/QR flow
  unaffected.

## Out of scope

- `countdown`, `pairingCode`, `steps` widgets (later milestones).
- Manual time-setting UI (time comes from SNTP).
- A branding-editor note that the wifi slider is preview-only (optional UX
  follow-up; not required for the device to be correct).
- Full IANA timezone coverage (the curated list is intentional).
