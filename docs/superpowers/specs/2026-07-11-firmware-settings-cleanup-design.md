# Firmware Settings Screen Cleanup — Design

**Date:** 2026-07-11
**Repo:** `maratus-firmware` (all changes; this spec lives in maratus-admin as the cross-cutting record)
**Scope:** Six targeted fixes to the on-device Settings screens. No general redesign — layout, palette, and interaction patterns stay as they are.

## Background

The on-device Settings flow (swipe-up → optional PIN → menu → About / Device settings / Wi-Fi / Restart) lives in `components/ui/ui_settings.c` (passive UI) and `main/app_state.c` (`run_settings_flow` orchestrator). The user reported six concrete problems after the Wi-Fi screen redesign shipped (2026-07-11, `eb16b48` + `a419ffa`).

## Changes

### 1. Remove the top-right info block on the Settings menu

`build_settings_info()` (`main/app_state.c`) renders a 4-line "Firmware / Wi-Fi / IP / Status" block into `s_menu_info_lbl`, top-right of the menu. The menu card rows start at y≈92 and overlap this text. The same facts are already shown, better, on the About screen.

**Fix:** delete the block entirely —

- `ui_settings_show_menu`: remove `s_menu_info_lbl` creation (and the static, its reset in `ui_settings_reset`).
- Remove the public `ui_settings_set_info()` API, `s_info_text`, and the `f_info` font pick.
- `main/app_state.c`: remove `build_settings_info()` and both call sites (menu entry + post-Wi-Fi refresh), and the now-unused `info[160]` buffer.

The "Settings" title stands alone in the header. No information is lost — About covers it.

### 2. Remove "Print listener" from About

`build_about_info()` (`main/app_state.c`) still appends a hardcoded `"Print listener\tListening"` row — vestigial from the printer/ESC-POS era.

**Fix:** delete that line from the format string. In `ui_settings_show_about`, drop `"Listening"` from the green-dot value comparison (now dead), and update the stale comment that lists the About facts.

### 3. Sleep chip selection must update visually

Tapping a "Sleep after" chip latches `s_dev_sl` and the orchestrator persists it (`devset_set_sleep` + `overrides_save`), but the screen is never re-rendered, so the tapped chip never turns accent-filled. The "Use device settings" switch already solves this by re-rendering.

**Fix:** in `run_settings_flow`'s device-settings loop, after a consumed sleep change, re-render exactly like the switch path does:

```c
if (g_dev.use_device && ui_settings_consume_sleep(&e)) {
    devset_set_sleep(&g_dev, e); overrides_save(); s_last_activity_ms = now_ms();
    ui_settings_show_device(scr, g_dev.use_device,
        devset_eff_brightness(&g_dev, cfg->device.brightness),
        devset_eff_sleep(&g_dev, cloud_sleep_encoded(cfg)));
}
```

Alternative considered: restyle chips in place inside the LVGL callback (smoother, no rebuild) — rejected for now because it requires keeping chip pointers as statics and diverges from the established re-render pattern; the rebuild is already user-visible on the switch and acceptable.

### 4. Wi-Fi setup ✕ (exit chip) reboots the device — bug

Entering **Network & Wi-Fi** from Settings and tapping the top-right ✕ restarts the device. There is no intentional `esp_restart()` on that path (`wifi_setup_run` simply returns on `ui_wifi_consume_exit()`), so this is a crash → panic reboot.

**Fix approach:** root-cause on hardware via systematic debugging — capture the panic backtrace over serial while reproducing (enter Wi-Fi setup from Settings, tap ✕). Prime suspects, in order:

1. **Font-cache eviction during the return animation.** After `wifi_setup_run` returns, `ui_settings_show_menu(scr)` runs a new `font_cache_begin_pass()` and then `lv_screen_load_anim(scr, MOVE_TOP, 220, …)` animates while the old Wi-Fi screen is still being rendered — if any Wi-Fi-screen font got evicted by the menu build, its labels reference a destroyed font mid-animation.
2. Screen-lifecycle ordering in the `UI_SET_WIFI` case (menu rebuilt into `scr` while `s_wscreen` is still the active screen).

Fix whatever the backtrace shows; the expected behavior is: ✕ → slide back to the Settings menu, Wi-Fi connection and stored credentials untouched. If the root cause is the eviction race, the likely shape of the fix is deleting the Wi-Fi screen (or loading the menu without animation) before the menu's font pass — decided by evidence, not guessed in advance.

### 5. Remove the ✕ icon from the Close button

The bottom Close button on the menu renders `LV_SYMBOL_CLOSE` + "Close" in an `exit_row` flex container.

**Fix:** delete the icon label and the flex container; create the "Close" label directly on the button and `lv_obj_center` it. Behavior (latches `UI_SET_CLOSE`) unchanged.

### 6. Remove the › chevron from the Restart device row

Every menu row gets a right chevron, but Restart is an action, not navigation.

**Fix:** add a `bool chevron` field to the menu `rows[]` table — `true` for Network & Wi-Fi, Device settings, About; `false` for Restart device. Skip the chevron label when false.

## Not in scope

- Any layout/spacing/typography changes beyond the six items.
- The About row labeled `Online` (label/value both status-ish) — left as is.
- The Restart row's "Reboots in ~30s" subtitle.

## Testing & verification

- `idf.py build` clean (ESP-IDF 5.5 env).
- Item 4: reproduce with serial monitor attached, capture the panic backtrace, fix, then verify ✕ returns to the menu repeatedly (≥3 entries/exits) without reboot and without dropping Wi-Fi.
- Items 1, 2, 5, 6: visual HIL check on the desk device (Printer b580).
- Item 3: tap each sleep chip; the tapped chip fills accent immediately and the value persists across a Settings re-entry.
- Regression: PIN gate (if configured), About back button, brightness slider live-preview + commit, Restart action, swipe-up entry, and trigger-abort mid-flow all still work.
