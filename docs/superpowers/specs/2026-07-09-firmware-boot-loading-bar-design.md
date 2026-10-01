# Firmware: Boot Loading Bar

**Date:** 2026-07-09
**Repo:** `maratus-firmware` (spec recorded here in maratus-admin per convention)
**Status:** Approved

## Problem

On power-on the device shows a static splash (Maratus-green background, white
"Maratus" wordmark) and then — if a cached branding config exists — jumps to the
branded idle screen *before* Wi-Fi even associates. Wi-Fi connection, asset
mount, and first cloud contact all happen with no visual feedback. The user
cannot tell whether the device is still starting, stuck on Wi-Fi, or ready.

## Decision summary

- **Boot gate:** the device stays on the splash (with a loading bar) until it
  is actually online — Wi-Fi connected **and** first successful cloud poll —
  instead of showing idle as soon as cached branding loads.
- **Bar style:** determinate, staged progress with a status label under it.
  The bar advances at real boot milestones; no fake animation-only progress.
- **Offline path:** if the device is not online ~25 s after the poll loop
  starts, the label shows "Starting offline…" briefly, then the cached idle
  screen renders and the poll loop keeps retrying in the background (existing
  self-healing behavior). Offline is not treated as an error state.
- **Approach:** firmware-chrome extension of the existing splash (Approach A).
  Not config-driven/brandable (rejected Approach B: cross-repo scope, and the
  config is not loaded during most of boot anyway); not a spinner (rejected
  Approach C: gives no sense of advancement).

## UX

The splash keeps its current look. Two chrome elements are added below the
wordmark:

- **Progress bar:** `lv_bar`, ~320 px wide, 8 px tall, fully rounded. White
  indicator on a white 25 %-opacity track. Value changes are animated
  (`LV_ANIM_ON`) so stage jumps read as smooth fills.
- **Status label:** ~20 px regular, white at ~80 % opacity, centered under the
  bar.

```
┌──────────────────────┐
│                      │
│        Maratus         │   ← existing wordmark (64 px bold)
│                      │
│   ████████░░░░░░     │   ← lv_bar, white on green
│  Connecting to Wi-Fi… │   ← status label
│                      │
└──────────────────────┘
```

### Stages

| Target | Label | Milestone |
|---|---|---|
| 10 % | Starting up… | splash first paint (display + NVS init done) |
| 25 % | Loading saved settings… | cached config loaded from NVS |
| 40 % | Connecting to Wi-Fi… | `net_connect` begins (or Wi-Fi setup hand-off) |
| 70 % | Contacting Maratus… | Wi-Fi has an IP; waiting for first poll 200 |
| 100 % | Ready | first HTTP 200 from the commands poll |

After READY the splash holds a short beat (~300 ms) so the full bar is
perceivable, then the idle screen renders.

Offline fallback: label switches to "Starting offline…" for ~1 s, then the
cached idle screen renders (bar does not fake 100 %).

## Architecture

Small and additive; no new components.

### `components/ui`

- `ui.h` gains:

  ```c
  typedef enum {
      BOOT_STARTING,   // 10%
      BOOT_CONFIG,     // 25%
      BOOT_WIFI,       // 40%
      BOOT_CLOUD,      // 70%
      BOOT_READY,      // 100%
      BOOT_OFFLINE,    // label-only: "Starting offline…"
  } boot_stage_t;

  void ui_boot_progress(boot_stage_t stage);
  ```

- `build_splash()` creates the bar + label and stores handles in per-screen
  statics (`s_boot_bar`, `s_boot_lbl`), cleared in `ui_render_state` alongside
  the existing per-screen statics (same pattern as `s_status_dot` /
  `s_clock_*`) so there is no write-after-free across re-renders.
- `ui_boot_progress` takes the LVGL port lock, animates the bar to the stage
  target and sets the label. It is a **safe no-op when the splash is not the
  active screen** (handles are NULL) — the Wi-Fi setup UI, the pairing/setup
  screen, and any later screen cannot be scribbled on.
- Stage → (percent, label) is a plain lookup table in `ui.c`.

### `main/app_main.c`

- Step 2b no longer renders `DEV_IDLE` early. The boot path stays on
  `DEV_BOOT` (splash) and calls `ui_boot_progress` at each milestone:
  STARTING after `ui_init`, CONFIG after `cloud_config_load_cached`, WIFI
  before `net_connect` / `wifi_setup_run`, CLOUD once `net_is_connected()`.
- `ui_set_config(g_cfg)` still happens immediately (so the eventual idle
  render uses the cached config), but the render is deferred to the gate
  release.
- First-boot path: `wifi_setup_run()` replaces the screen with the existing
  Wi-Fi setup UI (bar hands off via the no-op rule). When it returns
  connected, app_main re-renders `DEV_BOOT` and calls
  `ui_boot_progress(BOOT_CLOUD)` before continuing.
- Unclaimed path (no device key): unchanged destination — after Wi-Fi the
  pairing/setup screen (`DEV_SETUP`) renders as today. The gate applies only
  to the claimed path whose destination is idle.

### `main/app_state.c`

- Owns the gate release. A module flag `s_boot_gate` is set when
  `app_state_run()` starts with the device still in `DEV_BOOT`.
- **Online release:** on the first poll 200 (the same branch that triggers the
  initial config fetch), call `ui_boot_progress(BOOT_READY)`, hold ~300 ms,
  set state to `DEV_IDLE`, render, clear the gate.
- **Offline release:** the poll task's existing 2 s disconnected loop checks
  elapsed time since `app_state_run()` started; at ~25 s it calls
  `ui_boot_progress(BOOT_OFFLINE)`, holds ~1 s, renders `DEV_IDLE`, clears the
  gate. Polling continues unchanged, so connectivity later self-heals.
- Timeout is measured from `app_state_run()` start (not power-on), so a long
  first-boot Wi-Fi setup session does not eat the budget.

## Edge cases

- **Unclaimed device:** gate does not apply; bar covers boot → Wi-Fi, then the
  pairing screen renders (its normal destination).
- **No cached config + offline timeout:** `DEV_IDLE` render already falls back
  to the splash when the config is invalid (existing `build_screen`
  behavior) — acceptable, there is no branding to show.
- **Trigger command on the very first poll:** the gate releases on that same
  200; the trigger callback then renders the QR screen, which wins. Correct —
  a live trigger outranks idle.
- **Wrong creds / AP absent:** the bar sits honestly at "Connecting to
  Wi-Fi…" until the offline fallback fires.
- **Config-changed / OTA commands:** arrive via the same poll loop after the
  gate is released; unaffected.

## Testing & verification

The bar is device-side LVGL UI; the host cfg-harness does not apply. The
stage table is a trivial pure lookup — no host test invented for it.

1. `idf.py build` clean (ESP-IDF 5.5 toolchain per BUILD.md).
2. HIL scenarios:
   - **Normal cold boot:** stages advance in order; idle renders after first
     poll 200; total splash time ≈ Wi-Fi + first poll latency.
   - **Router off:** bar sticks at "Connecting to Wi-Fi…" → ~25 s →
     "Starting offline…" → cached idle; device comes online by itself when
     the router returns.
   - **Unclaimed device:** bar through Wi-Fi stage, then pairing screen.
   - **First boot (no creds):** bar → Wi-Fi setup UI hand-off → after setup,
     splash returns at "Contacting Maratus…" → idle.

## Out of scope

- Brandable/config-driven boot screen (Approach B) — revisit only if tenants
  ask for boot-screen branding.
- Per-stage granular progress within Wi-Fi association or TLS handshake.
- Changes to the admin app, config schema, or `/api/device/config`.
