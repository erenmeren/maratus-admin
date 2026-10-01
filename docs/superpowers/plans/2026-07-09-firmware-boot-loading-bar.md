# Firmware Boot Loading Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a staged loading bar + status label to the device boot splash, and gate the idle screen on first successful cloud contact (with a 25 s offline fallback).

**Architecture:** Firmware-chrome extension of the existing splash in `components/ui` (new `ui_boot_progress(boot_stage_t)` API). `main/app_main.c` advances stages at real boot milestones and no longer renders idle early; `main/app_state.c` arms a boot gate and releases it on the first poll 200 (or a 25 s timeout → cached idle). Spec: maratus-admin `docs/superpowers/specs/2026-07-09-firmware-boot-loading-bar-design.md`.

**Tech Stack:** ESP-IDF 5.5 (C), LVGL v9 (`lv_bar`), FreeRTOS tasks, existing `font_cache` / `esp_lvgl_port` lock pattern.

## Global Constraints

- **Repo:** ALL code changes in `/Users/eren/Projects/maratus-firmware` (NOT maratus-admin). Work on branch `feat/boot-loading-bar` off `main`.
- **Toolchain:** ESP-IDF 5.5 — every build is `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`. Expected: `Project build complete.` No 5.4/6.x.
- **LVGL thread-safety:** any LVGL object access goes through `lvgl_port_lock(0)` / `lvgl_port_unlock()` (existing pattern in `ui.c`).
- **Copy (exact, ASCII three dots — the embedded Open Sans subset may lack U+2026):** `Starting up...`, `Loading saved settings...`, `Connecting to Wi-Fi...`, `Contacting Maratus...`, `Ready`, `Starting offline...`.
- **Stage → percent:** STARTING 10, CONFIG 25, WIFI 40, CLOUD 70, READY 100, OFFLINE = label-only (bar untouched).
- **Timings:** gate timeout 25 000 ms (from `app_state_run()` start), READY hold 300 ms, OFFLINE hold 1000 ms.
- No new components, no admin/config-schema changes, no host-test harness for LVGL UI (verification = clean build + HIL).

---

### Task 1: `ui` component — boot progress chrome on the splash

**Files:**
- Modify: `components/ui/include/ui.h` (new enum + function, after `ui_render_state` declaration ~line 23)
- Modify: `components/ui/ui.c` (statics ~line 44, `build_splash` ~line 462, `build_screen` fallback ~line 481, `ui_init` ~line 532, `ui_render_state` ~line 546, new `ui_boot_progress`)

**Interfaces:**
- Consumes: existing `font_cache_get(int size, bool bold)`, `lvgl_port_lock/unlock`, splash chrome.
- Produces (Tasks 2 & 3 rely on these exact names):
  ```c
  typedef enum {
      BOOT_STARTING,   // 10%  "Starting up..."
      BOOT_CONFIG,     // 25%  "Loading saved settings..."
      BOOT_WIFI,       // 40%  "Connecting to Wi-Fi..."
      BOOT_CLOUD,      // 70%  "Contacting Maratus..."
      BOOT_READY,      // 100% "Ready"
      BOOT_OFFLINE,    // label-only "Starting offline..."
  } boot_stage_t;

  void ui_boot_progress(boot_stage_t stage);
  ```

- [ ] **Step 1: Declare the API in `ui.h`**

Insert after the `ui_render_state` declaration (line 23):

```c
// --- Boot progress (splash chrome) -----------------------------------------
// Stages of the boot loading bar shown on the built-in splash. The bar/label
// only exist on the boot splash; ui_boot_progress is a safe no-op on any
// other screen.
typedef enum {
    BOOT_STARTING,   // 10%  "Starting up..."
    BOOT_CONFIG,     // 25%  "Loading saved settings..."
    BOOT_WIFI,       // 40%  "Connecting to Wi-Fi..."
    BOOT_CLOUD,      // 70%  "Contacting Maratus..."
    BOOT_READY,      // 100% "Ready"
    BOOT_OFFLINE,    // label-only: "Starting offline..."
} boot_stage_t;

// Animate the splash bar to the stage's percent and set its status label.
// Takes the LVGL port lock; no-op when the boot splash is not active.
void ui_boot_progress(boot_stage_t stage);
```

- [ ] **Step 2: Add statics + stage table in `ui.c`**

After the `s_cd_*` statics block (after line 44):

```c
static lv_obj_t  *s_boot_bar;          // splash progress bar (NULL off-splash)
static lv_obj_t  *s_boot_lbl;          // splash status label (NULL off-splash)

typedef struct { int pct; const char *label; } boot_stage_info_t;
static const boot_stage_info_t BOOT_STAGES[] = {
    [BOOT_STARTING] = { 10,  "Starting up..." },
    [BOOT_CONFIG]   = { 25,  "Loading saved settings..." },
    [BOOT_WIFI]     = { 40,  "Connecting to Wi-Fi..." },
    [BOOT_CLOUD]    = { 70,  "Contacting Maratus..." },
    [BOOT_READY]    = { 100, "Ready" },
    [BOOT_OFFLINE]  = { -1,  "Starting offline..." },   // label-only
};
```

- [ ] **Step 3: Build the bar + label on the splash**

Change `build_splash` to take a flag (the config-fallback splash must NOT show a dead bar), and add the two widgets after the title:

```c
static lv_obj_t *build_splash(bool with_progress) {
    font_cache_begin_pass();
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(scr, lv_color_hex(MARATUS_GREEN), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_t *title = lv_label_create(scr);
    lv_label_set_text(title, "Maratus");
    lv_obj_set_style_text_color(title, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_text_font(title, font_cache_get(64, /*bold*/ true), LV_PART_MAIN);
    lv_obj_center(title);
    if (with_progress) {
        lv_obj_t *bar = lv_bar_create(scr);
        lv_obj_set_size(bar, 320, 8);
        lv_bar_set_range(bar, 0, 100);
        lv_bar_set_value(bar, 0, LV_ANIM_OFF);
        lv_obj_set_style_radius(bar, 4, LV_PART_MAIN);
        lv_obj_set_style_radius(bar, 4, LV_PART_INDICATOR);
        lv_obj_set_style_bg_color(bar, lv_color_white(), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(bar, LV_OPA_30, LV_PART_MAIN);          // track: white @ ~25%
        lv_obj_set_style_bg_color(bar, lv_color_white(), LV_PART_INDICATOR);
        lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, LV_PART_INDICATOR);  // indicator: solid white
        lv_obj_align(bar, LV_ALIGN_CENTER, 0, 80);
        lv_obj_t *lbl = lv_label_create(scr);
        lv_label_set_text(lbl, "");
        lv_obj_set_style_text_color(lbl, lv_color_white(), LV_PART_MAIN);
        lv_obj_set_style_text_opa(lbl, LV_OPA_80, LV_PART_MAIN);
        lv_obj_set_style_text_font(lbl, font_cache_get(20, false), LV_PART_MAIN);
        lv_obj_align_to(lbl, bar, LV_ALIGN_OUT_BOTTOM_MID, 0, 14);
        s_boot_bar = bar;
        s_boot_lbl = lbl;
    }
    lv_obj_add_flag(scr, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(scr, on_screen_click,   LV_EVENT_CLICKED,  NULL);
    lv_obj_add_event_cb(scr, on_screen_press,   LV_EVENT_PRESSED,  NULL);
    lv_obj_add_event_cb(scr, on_screen_release, LV_EVENT_RELEASED, NULL);
    return scr;
}
```

Update the three call sites:
- `build_screen` line 481: `if (!s_cfg || !s_cfg->valid) return build_splash(false);` (config-fallback splash — no bar)
- `ui_init` line 532: `s_active = build_splash(true);` (boot splash)
- `ui_render_state` line 555: `lv_obj_t *scr = (st == DEV_BOOT) ? build_splash(true) : build_screen(screen);`

- [ ] **Step 4: Clear the statics on every re-render (write-after-free guard)**

In `ui_render_state`, alongside the existing per-screen static clears (after `s_status_dot = NULL;` line 548):

```c
    s_boot_bar = NULL;   // cleared each render; build_splash(true) reinstalls
    s_boot_lbl = NULL;
```

(`build_splash` runs after these clears in the same locked section, so the DEV_BOOT path re-populates them.)

- [ ] **Step 5: Implement `ui_boot_progress`**

Add near `ui_render_state` in `ui.c`:

```c
void ui_boot_progress(boot_stage_t stage) {
    if ((unsigned)stage > BOOT_OFFLINE) return;   // enum may be unsigned; single-sided guard
    lvgl_port_lock(0);
    if (s_boot_bar && s_boot_lbl) {
        const boot_stage_info_t *si = &BOOT_STAGES[stage];
        if (si->pct >= 0) lv_bar_set_value(s_boot_bar, si->pct, LV_ANIM_ON);
        lv_label_set_text(s_boot_lbl, si->label);
    }
    lvgl_port_unlock();
}
```

- [ ] **Step 6: Build**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: `Project build complete.` (warnings-as-errors clean; no unused-symbol warnings for the new statics)

- [ ] **Step 7: Commit**

```bash
cd /Users/eren/Projects/maratus-firmware
git add components/ui/include/ui.h components/ui/ui.c
git commit -m "feat(ui): boot splash progress bar + ui_boot_progress stage API"
```

---

### Task 2: `app_main` — stage milestones + deferred idle render

**Files:**
- Modify: `main/app_main.c:99-124` (steps 2–3) and the pre-`app_state_run()` block (~line 147)

**Interfaces:**
- Consumes (from Task 1): `ui_boot_progress(boot_stage_t)`, enum values `BOOT_STARTING/BOOT_CONFIG/BOOT_WIFI/BOOT_CLOUD`.
- Produces: app_main no longer renders `DEV_IDLE`/`DEV_BOOT` at step 2b — the splash from `ui_init()` stays up through boot; `app_state_run()` (Task 3) owns the idle render. First-boot Wi-Fi-setup path re-renders `DEV_BOOT` before the gate.

- [ ] **Step 1: Advance to STARTING after `ui_init()`**

Replace lines 99–100:

```c
    // 2) Build + show the boot splash (ui takes the LVGL lock internally).
    ui_init();
    ui_boot_progress(BOOT_STARTING);
```

- [ ] **Step 2: Load cached config WITHOUT rendering idle (step 2b)**

Replace the body of step 2b (lines 102–114) — `ui_set_config` still happens so the eventual idle render uses the cache, but the render is deferred to the gate release:

```c
    // 2b) Load any cached config (before Wi-Fi) so the eventual idle render can
    // use it. The screen STAYS on the boot splash until app_state releases the
    // boot gate (first cloud 200, or the offline timeout).
    // device_config_t is ~67KB; keep it out of internal .bss (PSRAM, CPU-read only, no DMA).
    static device_config_t *g_cfg = NULL;
    g_cfg = heap_caps_calloc(1, sizeof(*g_cfg), MALLOC_CAP_SPIRAM);
    if (g_cfg) {
        cloud_config_load_cached(g_cfg);
        ui_set_config(g_cfg);
        ESP_LOGI(TAG, "cached config loaded (valid=%d)", g_cfg->valid);
    } else {
        ESP_LOGE(TAG, "g_cfg PSRAM alloc failed; continuing without cached config");
    }
    ui_boot_progress(BOOT_CONFIG);
```

- [ ] **Step 3: Advance to WIFI and remember the setup hand-off (step 3)**

Replace lines 116–124:

```c
    // 3) Wi-Fi: connect with stored/Kconfig creds, else run on-screen setup (first boot).
    net_init();
    ui_boot_progress(BOOT_WIFI);
    bool ran_wifi_setup = false;
    if (appcfg_has_wifi_creds() ||
        (appcfg_wifi_ssid()[0] && strcmp(appcfg_wifi_ssid(), "changeme") != 0)) {
        net_connect(appcfg_wifi_ssid(), appcfg_wifi_password());
    } else {
        wifi_setup_run();          // replaces the splash with the Wi-Fi setup UI
        ran_wifi_setup = true;
    }
    ESP_LOGI(TAG, "Wi-Fi connected=%d", net_is_connected());
```

(Steps 3b assets mount and 3c unclaimed-provisioning stay byte-for-byte unchanged — the unclaimed path's destination is the `DEV_SETUP` pairing screen, not idle, so the gate does not apply there.)

- [ ] **Step 4: Return to the splash after Wi-Fi setup + advance to CLOUD (step 4)**

Replace the step-4 comment + `app_state_run()` call (line 147–148):

```c
    // 4) Boot gate: if the Wi-Fi setup UI replaced the splash, bring it back;
    // then wait for first cloud contact (app_state releases the gate to idle).
    if (ran_wifi_setup) ui_render_state(DEV_BOOT);
    if (net_is_connected()) ui_boot_progress(BOOT_CLOUD);
    app_state_run();
```

(If Wi-Fi is still down, the label honestly stays at "Connecting to Wi-Fi..." and Task 3's timeout handles the fallback.)

- [ ] **Step 5: Build**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: `Project build complete.`

- [ ] **Step 6: Commit**

```bash
cd /Users/eren/Projects/maratus-firmware
git add main/app_main.c
git commit -m "feat(boot): advance splash progress at boot milestones; defer idle to the boot gate"
```

---

### Task 3: `app_state` — boot gate arm, online release, offline timeout

**Files:**
- Modify: `main/app_state.c` (constants near `POLL_IDLE_MS` ~line 127, `poll_task` ~lines 427-487, `app_state_run` ~lines 489-504)

**Interfaces:**
- Consumes (from Task 1): `ui_boot_progress`, `BOOT_READY`, `BOOT_OFFLINE`. Existing: `now_ms()`, `s_state`, `ui_render_state`.
- Produces: the only place `DEV_IDLE` is first rendered after boot. Gate is module-internal (no header change).

- [ ] **Step 1: Add gate constants + state**

Next to the poll constants (after `#define POLL_BACKOFF_MIN 2000`, ~line 128):

```c
// Boot gate: stay on the splash until the first successful cloud poll, or
// give up after this long (measured from app_state_run) and start offline.
#define BOOT_GATE_TIMEOUT_MS 25000
#define BOOT_READY_HOLD_MS   300     // let the full bar be perceivable
#define BOOT_OFFLINE_HOLD_MS 1000    // let "Starting offline..." be readable
static bool    s_boot_gate = false;
static int64_t s_boot_start_ms;
```

- [ ] **Step 2: Gate-aware initial state in `poll_task`**

Replace `s_state = DEV_IDLE;` (line 431) with:

```c
    s_state = s_boot_gate ? DEV_BOOT : DEV_IDLE;
```

- [ ] **Step 3: Offline timeout at the top of the poll loop**

Insert as the FIRST statement inside `for (;;) {` (before the input-suppression line 436) — it must run on both the no-network and poll-failed paths:

```c
        // Boot gate fallback: still not online after the timeout → show the
        // cached idle screen and keep retrying in the background (self-heals).
        if (s_boot_gate && now_ms() - s_boot_start_ms >= BOOT_GATE_TIMEOUT_MS) {
            s_boot_gate = false;
            ESP_LOGW(TAG, "boot gate timed out; starting offline");
            ui_boot_progress(BOOT_OFFLINE);
            vTaskDelay(pdMS_TO_TICKS(BOOT_OFFLINE_HOLD_MS));
            s_state = DEV_IDLE;
            ui_render_state(DEV_IDLE);
        }
```

- [ ] **Step 4: Online release in the 200 branch**

Insert right BEFORE `commands_handle_body(body);` (line 455), so a trigger command on the same poll lands after the gate release and its QR render wins:

```c
            if (s_boot_gate) {
                s_boot_gate = false;
                ui_boot_progress(BOOT_READY);
                vTaskDelay(pdMS_TO_TICKS(BOOT_READY_HOLD_MS));
                s_state = DEV_IDLE;
                ui_render_state(DEV_IDLE);   // cached config; the config fetch below re-renders fresh
            }
```

- [ ] **Step 5: Arm the gate in `app_state_run` + PSRAM-failure fallback**

In `app_state_run`, change the alloc-failure early return (lines 494-497) so the device is not stranded on the splash (app_main no longer renders idle):

```c
    if (!s_cfg_buf[0] || !s_cfg_buf[1]) {
        ESP_LOGE(TAG, "config buffer PSRAM alloc failed; running without live config");
        ui_render_state(DEV_IDLE);   // fall back to app_main's cached config; no poll task
        return;
    }
```

And arm the gate just before `xTaskCreate(poll_task, ...)` (line 503):

```c
    s_boot_gate = true;
    s_boot_start_ms = now_ms();
    xTaskCreate(poll_task, "ditto_poll", 8192, NULL, 5, NULL);
```

- [ ] **Step 6: Build**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: `Project build complete.`

- [ ] **Step 7: Commit**

```bash
cd /Users/eren/Projects/maratus-firmware
git add main/app_state.c
git commit -m "feat(boot): boot gate — release to idle on first cloud 200, 25s offline fallback"
```

---

### Task 4: Final verification + HIL checklist

**Files:**
- No code changes. Read-only review of the three commits; HIL doc note only if needed.

**Interfaces:**
- Consumes: the completed Tasks 1-3 on `feat/boot-loading-bar`.
- Produces: a clean build, a reviewed diff, and the HIL checklist handed to the user (hardware verification requires the physical board — do NOT attempt to flash).

- [ ] **Step 1: Full clean build**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: `Project build complete.`

- [ ] **Step 2: Review the whole diff against main**

Run: `cd /Users/eren/Projects/maratus-firmware && git diff main...HEAD --stat && git diff main...HEAD`
Check: only `components/ui/include/ui.h`, `components/ui/ui.c`, `main/app_main.c`, `main/app_state.c` changed; stage copy matches the Global Constraints strings exactly; every LVGL touch is inside `lvgl_port_lock`.

- [ ] **Step 3: Report the HIL checklist (user runs on hardware)**

1. **Normal cold boot** (claimed device, router on): bar fills 10→25→40→70→100 with matching labels, "Ready" holds ~300 ms, branded idle appears after the first poll.
2. **Router off**: bar sticks at "Connecting to Wi-Fi..." → at ~25 s shows "Starting offline..." ~1 s → cached idle; turn the router back on → device comes online by itself (no reboot).
3. **Unclaimed device**: bar through the Wi-Fi stage, then the pairing/setup screen renders as before.
4. **First boot (no creds)**: bar → Wi-Fi setup UI hand-off → after connecting, splash returns at "Contacting Maratus..." → idle.
