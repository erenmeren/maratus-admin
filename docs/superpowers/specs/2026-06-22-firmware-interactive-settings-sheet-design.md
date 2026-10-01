# Firmware: Interactive Settings Sheet (finger-tracking swipe-up)

**Date:** 2026-06-22
**Repo:** maratus-firmware (ESP32-P4, LVGL 9.3, ESP-IDF 5.5)
**Status:** Design — approved, pending spec review → implementation plan
**Supersedes:** the swipe-up entry shipped on `feat/swipe-up-settings` (detect-on-release, instant screen swap). That branch's pure `gesture_is_swipe_up()` + host test are reused; its instant-jump presentation is replaced by this interactive sheet.

## Problem

The just-shipped swipe-up opens Settings by detecting an upward swipe **on release** and then instantly swapping to the settings screen. It works but feels unpolished — there is no visual continuity between the gesture and the screen change. The user wants the screen to **track the finger**: a Settings surface that slides up under the finger in real time and snaps open or springs back on release, like a phone bottom-sheet.

## Goal

Replace the instant swap with an **interactive bottom-sheet**:

- A Settings panel that follows the finger 1:1 as it is dragged up from anywhere on the idle screen.
- On release, a pure decision snaps it **fully open** (past ~40% revealed, or a fast upward flick) or **dismisses** it (springs back down), with a smooth `lv_anim` glide either way.
- When fully open, the existing PIN-gated settings logic takes over **inside the same panel** — no second screen-swap, no flash.
- A plain tap still triggers the existing test-print path (no regression).

Non-goals: changing the settings menu contents, PIN verification, sleep/wake (M7), or the cloud contract. This is presentation only.

## Architecture

### Layering & threading

The sheet is a single container parented to **`lv_layer_top()`**, drawn above whatever per-state screen the config-driven render engine has loaded. It is created lazily when a drag begins and destroyed on dismiss.

The **entire drag + snap animation runs on the LVGL/UI thread** (event callbacks + `lv_anim` + `lv_timer`), independent of the ~12 s poll loop. This is essential for smoothness — the animation must not wait on a poll cycle. The poll loop (`poll_task` in `main/app_state.c`) is involved only once the sheet is fully open, to run the existing blocking settings logic.

### Gesture state machine (UI thread)

Driven by event callbacks on the active screen object (registered in `build_screen()` / `build_splash()` alongside the current handlers):

- **`LV_EVENT_PRESSED`** — record the press-start point (`lv_indev_get_point`); reset drag state.
- **`LV_EVENT_PRESSING`** — compute `upwardDelta = startY − currentY`. While not yet dragging, if `upwardDelta` exceeds a small **slop (~12 px)**, enter *dragging*: create the sheet (if absent) and from then on set `sheet.y = clamp(screen_h − upwardDelta, 0, screen_h)` on every event so it tracks the finger. Track the last sample (point + tick) for flick velocity.
- **`LV_EVENT_RELEASED`** — if dragging, call the pure `gesture_snap()` decision → animate to **open** (`y → 0`) or **dismiss** (`y → screen_h`, then destroy). Suppress the trailing `CLICKED` (as the current swipe does).
- A press that never crosses the slop is a normal tap → falls through to the existing `on_screen_click` → test-print.

### The sheet (performance + seamless polish)

What tracks the finger is a **lightweight opaque panel**, not the live controls:

- Brand-colored background, rounded top corners, a centered **grab-handle pill** at the top, and a "Settings" title.
- Dragging moves only this cheap panel each frame — the 12-button PIN keypad is **not** repositioned per frame.
- On snap-**open** (panel settled at `y = 0`), the real controls **fade in** (~150 ms) onto the *same* panel: the **PIN keypad** if a device PIN is set, otherwise the **menu** (Wi-Fi Setup / Test print / Reboot / Close). Same container → no screen-swap flash; reads as one continuous motion.
- On **dismiss**, the panel glides down and is destroyed.

### Integration with `run_settings_flow()`

`run_settings_flow()` keeps owning PIN-verify → menu → action dispatch, but is refactored to **populate and drive controls inside the open sheet** rather than building and `lv_screen_load`-ing its own screen. `ui_settings.c`'s builders (`ui_settings_show_pin`, `ui_settings_show_menu`) gain a **parent parameter** so they attach to the sheet's content area. PIN gating, constant-time `sha256(salt+pin)` verify, and all menu actions are unchanged. When the flow finishes (Close / action complete), the sheet animates down and is destroyed, returning to idle.

Handoff: the UI thread sets a `s_sheet_open` flag when the open animation completes; `poll_task` consumes it (replacing the current `ui_consume_swipeup()` check) and runs `run_settings_flow()` against the already-open sheet.

## Components & units

1. **`gesture_snap()`** — pure, host-tested decision (extends `components/devcfg/gesture.c`):
   `snap_decision_t gesture_snap(int revealed_px, int screen_h, int flick_up_velocity)` → `SNAP_OPEN` | `SNAP_DISMISS`. Opens if `revealed_px >= screen_h * 40 / 100` **or** `flick_up_velocity >= FLICK_THRESHOLD`. No LVGL/float deps.
2. **`ui_sheet`** (new `components/ui/ui_sheet.c` + header, or a section of `ui.c`) — the interactive sheet: create/destroy, drag-to-y, snap animation, grab-handle/title chrome, fade-in of content, and the `s_sheet_open` handoff flag with its `ui_consume_*` accessor. Owns the new PRESSING/RELEASED drag callbacks.
3. **`ui_settings.c`** — builders take a parent parameter; otherwise unchanged.
4. **`app_state.c`** — `poll_task` runs `run_settings_flow()` on the sheet-open handoff flag instead of the old swipe flag.

Boundaries: pure gesture math (host-testable) is isolated from LVGL; the sheet component owns all animation/rendering; the settings *logic* stays in `run_settings_flow`/`ui_settings`; the poll loop only orchestrates the post-open blocking flow.

## Constants (tunable, all in one place)

- `DRAG_SLOP_PX` ≈ 12 — distance before a press becomes a drag (vs a tap).
- `SNAP_OPEN_FRACTION` = 40 (% of screen height revealed to auto-open).
- `FLICK_THRESHOLD` — upward velocity (px/tick) that opens regardless of distance.
- `SNAP_ANIM_MS` ≈ 220 — glide duration; `CONTENT_FADE_MS` ≈ 150.
- Reuses `SWIPE_UP_MIN_PX` semantics only conceptually; the sheet replaces the binary threshold with continuous tracking.

## Error handling & edge cases

- **Tap vs drag:** slop gate guarantees a tap (no movement) still test-prints; only a deliberate upward drag opens the sheet.
- **Tap suppression:** the `CLICKED` that ends a drag is swallowed (existing `s_suppress_click` mechanism).
- **Sleep/wake (M7):** a drag is touch activity → wakes the screen via the existing `ui_consume_activity` path; the 800 ms wake-guard already prevents the waking touch from triggering ingest. The sheet must not be draggable in the same gesture that merely wakes a sleeping screen — first touch wakes, sheet drag requires a fresh press (document + verify on HIL).
- **Concurrency:** drag/animation run under the LVGL port lock on the UI thread; the `s_sheet_open` handoff flag is `volatile` and consumed under the lock, mirroring `ui_consume_*`.
- **Mid-drag receipt:** if a receipt arrives while dragging (rare), the receipt state change wins; the sheet is dismissed/destroyed. Verify on HIL.
- **Dismiss cleanup:** animation completion callback destroys the sheet and clears all sheet pointers to avoid use-after-free across renders (same discipline as the M5a status-dot fix).

## Testing

- **Host (cfg-harness):** `gesture_snap()` cases — below-threshold short drag → dismiss; ≥40% → open; fast flick under 40% → open; downward/none → dismiss. Plus the existing `gesture_is_swipe_up` tests remain.
- **HIL (board):** drag tracks finger smoothly; snap-open past 40% and via flick; spring-back under threshold; grab-handle + fade-in look right; PIN keypad appears on a locked device and verifies; menu actions work; tap still test-prints; long-press does nothing; interplay with sleep/wake. A **tuning pass** on the constants (slop, fraction, flick, anim ms) is expected after the first flash — feel can only be judged on hardware.

## Rollout

Branch `feat/swipe-up-settings` (already holds the swipe-detect work) extends into the interactive sheet, or a fresh `feat/settings-sheet` branched from it. Subagent-driven implementation, pure logic host-tested first, then flash + tune + HIL-verify, then merge to maratus-firmware `main` with a BUILD.md entry (HW-verified convention, per M7).
