# Interactive Settings Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the instant swipe-up-to-Settings jump with a finger-tracking bottom-sheet that follows the finger and snaps open or springs back on release.

**Architecture:** A full-screen sheet container parented to `lv_layer_top()` slides up tracking the finger, driven entirely on the LVGL/UI thread (event callbacks + `lv_anim`). A pure, host-tested `gesture_snap()` decides open-vs-dismiss on release. The existing PIN-gated `run_settings_flow()` runs once the sheet is open; in the final task its controls render *into* the sheet so there is no screen-swap.

**Tech Stack:** ESP32-P4, ESP-IDF 5.5, LVGL 9.3, C11. Pure logic host-tested via `tools/cfg-harness` (`make test`); UI feel verified on hardware (HIL).

## Global Constraints

- Repo: **maratus-firmware**. Work on branch **`feat/swipe-up-settings`** (already holds the swipe-detect work + `gesture.c`). Do NOT commit on `main`.
- Build: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build` (ESP-IDF **5.5**, not 6.x).
- Host tests: `cd tools/cfg-harness && make test` → must end `ALL TESTS PASSED`.
- Pure gesture logic lives in `components/devcfg/gesture.{c,h}` with **no LVGL / no float** deps (host-testable), mirroring `sleep_policy.c`.
- LVGL callbacks stay **passive**: they set flags / move objects only — no network, no `esp_restart`, no cloud calls (mirrors `ui_settings.c` discipline).
- All cross-thread flags are `volatile` and consumed under `lvgl_port_lock(0)`, mirroring the existing `ui_consume_*` functions.
- Screen is **720×720**. Use `SCREEN_H = 720`.
- Commit message footer on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Pure snap decision (`gesture_snap`)

**Files:**
- Modify: `components/devcfg/include/gesture.h`
- Modify: `components/devcfg/gesture.c`
- Modify: `tools/cfg-harness/test_cfg.c`

**Interfaces:**
- Consumes: nothing (extends existing `gesture.c`).
- Produces:
  ```c
  typedef enum { SNAP_DISMISS = 0, SNAP_OPEN = 1 } snap_decision_t;
  // revealed_px: how far the sheet was pulled up from the bottom (0..screen_h).
  // flick_up_velocity: upward release velocity in px/s (downward clamps to 0 by caller).
  // open_fraction_pct: % of screen_h that auto-opens (e.g. 40).
  // flick_threshold: px/s upward flick that opens regardless of distance.
  snap_decision_t gesture_snap(int revealed_px, int screen_h,
                               int flick_up_velocity,
                               int open_fraction_pct, int flick_threshold);
  ```

- [ ] **Step 1: Write the failing test**

Add to `tools/cfg-harness/test_cfg.c` (near `test_gesture_swipe_up`), then add the call in `main()`:
```c
static void test_gesture_snap(void) {
    // short drag, no flick -> dismiss (100/720 = 14%)
    assert(gesture_snap(100, 720, 0, 40, 1200) == SNAP_DISMISS);
    // >=40% revealed -> open (300/720 = 41.7%)
    assert(gesture_snap(300, 720, 0, 40, 1200) == SNAP_OPEN);
    // exactly 40% -> open (288/720 = 40%)
    assert(gesture_snap(288, 720, 0, 40, 1200) == SNAP_OPEN);
    // fast upward flick under 40% -> open
    assert(gesture_snap(120, 720, 2000, 40, 1200) == SNAP_OPEN);
    // slow flick under 40% -> dismiss
    assert(gesture_snap(120, 720, 500, 40, 1200) == SNAP_DISMISS);
    // no movement -> dismiss
    assert(gesture_snap(0, 720, 0, 40, 1200) == SNAP_DISMISS);
    printf("test_gesture_snap OK\n");
}
```
Add `test_gesture_snap();` to `main()` after `test_gesture_swipe_up();`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/cfg-harness && make clean && make test`
Expected: compile error / FAIL — `gesture_snap` undefined and `SNAP_*` unknown.

- [ ] **Step 3: Implement**

Append to `components/devcfg/include/gesture.h` (above the `#endif`/end; it currently has no include guard — keep the existing `#pragma once`):
```c
typedef enum { SNAP_DISMISS = 0, SNAP_OPEN = 1 } snap_decision_t;

snap_decision_t gesture_snap(int revealed_px, int screen_h,
                             int flick_up_velocity,
                             int open_fraction_pct, int flick_threshold);
```
Append to `components/devcfg/gesture.c`:
```c
snap_decision_t gesture_snap(int revealed_px, int screen_h,
                             int flick_up_velocity,
                             int open_fraction_pct, int flick_threshold) {
    if (flick_up_velocity >= flick_threshold) return SNAP_OPEN;
    if (revealed_px * 100 >= screen_h * open_fraction_pct) return SNAP_OPEN;
    return SNAP_DISMISS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools/cfg-harness && make test`
Expected: `test_gesture_snap OK` and `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add components/devcfg/include/gesture.h components/devcfg/gesture.c tools/cfg-harness/test_cfg.c
git commit -m "feat(devcfg): gesture_snap() pure open/dismiss decision

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Interactive sheet mechanics (`ui_sheet`) + drag wiring

Delivers a draggable bottom-sheet that tracks the finger and snaps open/closed. On snap-open it hands off to the existing settings flow, which for THIS task still loads its own PIN/menu screen (the sheet is destroyed at the handoff — a brief swap that Task 4 removes). HIL-verifiable: the sheet tracks the finger and snaps.

**Files:**
- Create: `components/ui/ui_sheet.c`
- Modify: `components/ui/include/ui.h`
- Modify: `components/ui/CMakeLists.txt` (add `ui_sheet.c` to SRCS)
- Modify: `components/ui/ui.c` (replace the swipe-on-release handlers with drag handlers)
- Modify: `main/app_state.c` (poll_task consumes sheet-open instead of swipeup)

**Interfaces:**
- Consumes: `gesture_snap()` (Task 1).
- Produces (add to `ui.h`, replacing the `ui_consume_swipeup` declaration from the prior branch):
  ```c
  // Drive the interactive Settings sheet from the active screen's touch events.
  // All run on the LVGL thread (callbacks already hold the port lock).
  void ui_sheet_on_press(int x, int y);     // finger down at (x,y)
  void ui_sheet_on_pressing(int x, int y);  // finger moved to (x,y) while down
  void ui_sheet_on_release(void);           // finger up -> snap decision

  // True (once) when the sheet has finished animating fully open. Cleared on read.
  // Consumed by poll_task to run the settings flow. Takes the port lock.
  bool ui_consume_sheet_open(void);

  // Animate the sheet back down and destroy it (called when settings flow exits).
  // Takes the port lock.
  void ui_sheet_close(void);
  ```

- [ ] **Step 1: Remove the old swipe-on-release path in `ui.c`**

In `components/ui/ui.c`, delete the swipe-detect statics/callbacks added on the prior branch (`s_swipeup`, `s_press_x/s_press_y/s_press_valid/s_suppress_click`, `on_screen_release`, and the `gesture_is_swipe_up` use) **except keep** `on_screen_press`/`on_screen_click`/`s_tap_requested`/`s_activity`/`s_suppress_click`. Replace the press/click/release block with drag-forwarding handlers:
```c
static volatile bool s_suppress_click = false;   // eat the CLICKED that ends a drag

static void on_screen_press(lv_event_t *e) {
    (void)e;
    s_activity = true;
    s_suppress_click = false;
    lv_indev_t *indev = lv_indev_active();
    if (indev) { lv_point_t p; lv_indev_get_point(indev, &p); ui_sheet_on_press(p.x, p.y); }
}

static void on_screen_pressing(lv_event_t *e) {
    (void)e;
    lv_indev_t *indev = lv_indev_active();
    if (indev) { lv_point_t p; lv_indev_get_point(indev, &p); ui_sheet_on_pressing(p.x, p.y); }
}

static void on_screen_release(lv_event_t *e) {
    (void)e;
    ui_sheet_on_release();   // ui_sheet sets s_suppress via ui.c? No: see note
}

static void on_screen_click(lv_event_t *e) {
    (void)e;
    if (s_suppress_click) { s_suppress_click = false; return; }
    s_tap_requested = true;
}
```
Note: to let `ui_sheet_on_release()` suppress the trailing tap, add a tiny accessor used by `ui_sheet` — declare `void ui_suppress_next_click(void);` in `ui.c` (file-local is impossible across files, so expose it):
in `ui.c` add and export via `ui.h`:
```c
// ui.c
void ui_suppress_next_click(void) { s_suppress_click = true; }
```
```c
// ui.h
void ui_suppress_next_click(void);   // called by ui_sheet when a drag ends in a swipe
```
`ui_sheet_on_release()` calls `ui_suppress_next_click()` when it began a drag.

- [ ] **Step 2: Register the three handlers on every screen**

In `build_screen()` and `build_splash()` (`ui.c`), the event registration becomes:
```c
    lv_obj_add_event_cb(scr, on_screen_click,    LV_EVENT_CLICKED,  NULL);
    lv_obj_add_event_cb(scr, on_screen_press,    LV_EVENT_PRESSED,  NULL);
    lv_obj_add_event_cb(scr, on_screen_pressing, LV_EVENT_PRESSING, NULL);
    lv_obj_add_event_cb(scr, on_screen_release,  LV_EVENT_RELEASED, NULL);
```
Add `#include "gesture.h"` (already present) and `#include "ui.h"` self-include is fine.

- [ ] **Step 3: Implement `ui_sheet.c`**

```c
#include "ui.h"
#include <stdint.h>
#include "lvgl.h"
#include "esp_lvgl_port.h"
#include "gesture.h"
#include "device_config.h"

// Interactive Settings bottom-sheet. Lives on lv_layer_top(), above whatever
// branding screen is loaded. Drag/animation run on the LVGL thread; poll_task
// only learns "fully open" via ui_consume_sheet_open().

#define SCREEN_H            720
#define SHEET_DRAG_SLOP_PX  12      // movement before a press becomes a drag
#define SHEET_OPEN_PCT      40      // % revealed that auto-opens
#define SHEET_FLICK_PX_S    1200    // upward flick (px/s) that opens regardless
#define SHEET_ANIM_MS       220     // snap glide duration

extern const uint32_t MARATUS_GREEN;  // defined in ui.c; or hardcode 0x1F8A4C

static lv_obj_t      *s_sheet;          // full-screen container, NULL when absent
static bool           s_dragging;       // crossed the slop this gesture
static int            s_press_y;        // gesture start y
static int            s_prev_y;         // last sampled y (for velocity)
static uint32_t       s_prev_tick;      // last sample tick (ms)
static int            s_vel_up;         // last computed upward velocity px/s
static volatile bool  s_open;           // set when open animation completes

static int sheet_brand_bg(void) {
    extern const device_config_t *ui_current_cfg(void);  // small getter added in ui.c
    const device_config_t *c = ui_current_cfg();
    return (c && c->valid) ? (int)c->brand_bg : (int)0x101418;
}

static void build_sheet(void) {
    if (s_sheet) return;
    s_sheet = lv_obj_create(lv_layer_top());
    lv_obj_remove_style_all(s_sheet);
    lv_obj_set_size(s_sheet, 720, SCREEN_H);
    lv_obj_set_y(s_sheet, SCREEN_H);                 // start fully below the screen
    lv_obj_set_style_bg_color(s_sheet, lv_color_hex(sheet_brand_bg()), 0);
    lv_obj_set_style_bg_opa(s_sheet, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(s_sheet, 28, 0);
    lv_obj_clear_flag(s_sheet, LV_OBJ_FLAG_SCROLLABLE);

    // Grab-handle pill
    lv_obj_t *grip = lv_obj_create(s_sheet);
    lv_obj_remove_style_all(grip);
    lv_obj_set_size(grip, 120, 8);
    lv_obj_set_style_radius(grip, 4, 0);
    lv_obj_set_style_bg_color(grip, lv_color_white(), 0);
    lv_obj_set_style_bg_opa(grip, LV_OPA_40, 0);
    lv_obj_align(grip, LV_ALIGN_TOP_MID, 0, 18);

    // Title
    lv_obj_t *title = lv_label_create(s_sheet);
    lv_label_set_text(title, "Settings");
    lv_obj_set_style_text_color(title, lv_color_white(), 0);
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 44);
}

static void destroy_sheet(void) {
    if (s_sheet) { lv_obj_delete(s_sheet); s_sheet = NULL; }
    s_dragging = false;
}

static void open_anim_done(lv_anim_t *a) { (void)a; s_open = true; }
static void close_anim_done(lv_anim_t *a) { (void)a; destroy_sheet(); }

static void animate_to(int target_y, lv_anim_completed_cb_t done) {
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, s_sheet);
    lv_anim_set_values(&a, lv_obj_get_y(s_sheet), target_y);
    lv_anim_set_duration(&a, SHEET_ANIM_MS);
    lv_anim_set_exec_cb(&a, (lv_anim_exec_xcb_t)lv_obj_set_y);
    lv_anim_set_path_cb(&a, lv_anim_path_ease_out);
    lv_anim_set_completed_cb(&a, done);
    lv_anim_start(&a);
}

void ui_sheet_on_press(int x, int y) {
    (void)x;
    s_press_y = y; s_prev_y = y; s_prev_tick = lv_tick_get();
    s_dragging = false; s_vel_up = 0;
}

void ui_sheet_on_pressing(int x, int y) {
    (void)x;
    int up = s_press_y - y;                       // positive = moved up
    if (!s_dragging) {
        if (up < SHEET_DRAG_SLOP_PX) return;      // still a potential tap
        s_dragging = true;
        build_sheet();
    }
    int reveal = up; if (reveal < 0) reveal = 0; if (reveal > SCREEN_H) reveal = SCREEN_H;
    lv_obj_set_y(s_sheet, SCREEN_H - reveal);

    uint32_t now = lv_tick_get();
    uint32_t dt = now - s_prev_tick;
    if (dt >= 16) {                               // ~1 frame; compute px/s
        s_vel_up = (int)((long)(s_prev_y - y) * 1000 / (long)dt);
        s_prev_y = y; s_prev_tick = now;
    }
}

void ui_sheet_on_release(void) {
    if (!s_dragging) return;
    s_dragging = false;
    ui_suppress_next_click();                     // the trailing CLICKED is part of this drag
    int reveal = SCREEN_H - lv_obj_get_y(s_sheet);
    int vel = s_vel_up > 0 ? s_vel_up : 0;
    if (gesture_snap(reveal, SCREEN_H, vel, SHEET_OPEN_PCT, SHEET_FLICK_PX_S) == SNAP_OPEN) {
        animate_to(0, open_anim_done);
    } else {
        animate_to(SCREEN_H, close_anim_done);
    }
}

bool ui_consume_sheet_open(void) {
    lvgl_port_lock(0);
    bool v = s_open; s_open = false;
    lvgl_port_unlock();
    return v;
}

void ui_sheet_close(void) {
    lvgl_port_lock(0);
    if (s_sheet) animate_to(SCREEN_H, close_anim_done);
    lvgl_port_unlock();
}
```
Add the small getter in `ui.c` (exposes the live config pointer the sheet colors with) and export it in `ui.h`:
```c
// ui.c
const device_config_t *ui_current_cfg(void) { return s_cfg; }
```
```c
// ui.h
const device_config_t *ui_current_cfg(void);
```
If `MARATUS_GREEN` is `#define`d (not a variable) in `ui.c`, drop the `extern` and hardcode the fallback as shown.

- [ ] **Step 4: Add `ui_sheet.c` to the build**

`components/ui/CMakeLists.txt` SRCS → add `"ui_sheet.c"`.

- [ ] **Step 5: Wire poll_task handoff in `app_state.c`**

Replace the swipe check (currently lines ~294-297):
```c
        if (ui_consume_sheet_open()) {
            run_settings_flow();
            ui_sheet_close();
            continue;
        }
```
(For this task, `run_settings_flow()` is unchanged — it still loads its own PIN/menu screen. Because that screen loads on the base layer *under* the sheet, `run_settings_flow()` must run with the sheet gone: call `ui_sheet_close()` is wrong-order here. Instead, in THIS task destroy the sheet at open: change `open_anim_done` to additionally schedule destroy AFTER poll_task picks it up. Simplest for Task 2: in `run_settings_flow()`'s caller, destroy the sheet immediately before running:)
```c
        if (ui_consume_sheet_open()) {
            ui_sheet_close();      // remove the cover so the PIN/menu screen is visible
            run_settings_flow();
            continue;
        }
```
Task 4 removes this `ui_sheet_close()`-before-flow and renders INTO the sheet instead.

- [ ] **Step 6: Build**

Run: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: success.

- [ ] **Step 7: Host tests still green**

Run: `cd tools/cfg-harness && make test` → `ALL TESTS PASSED`.

- [ ] **Step 8: Commit**

```bash
git add components/ui/ui_sheet.c components/ui/include/ui.h components/ui/CMakeLists.txt components/ui/ui.c main/app_state.c
git commit -m "feat(ui): finger-tracking Settings sheet (snap open/dismiss)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 9: HIL checkpoint (user)**

Flash (`idf.py -p <port> flash`) and verify: dragging up makes the sheet track the finger; past ~40% or a flick it snaps fully open then the settings screen appears; a short drag springs back; a plain tap still test-prints; long-press does nothing. Note any feel issues (slop/fraction/flick/anim ms) for tuning.

---

### Task 3: Settings controls render into a parent (seamless content)

Refactor the PIN/menu builders to attach to a caller-provided parent instead of creating + loading their own screen. This removes the screen-swap so Task 4 can render the controls directly onto the open sheet.

**Files:**
- Modify: `components/ui/ui_settings.c`
- Modify: `components/ui/include/ui.h`

**Interfaces:**
- Produces (changed signatures):
  ```c
  void ui_settings_show_pin(lv_obj_t *parent);   // build keypad into parent (no screen load)
  void ui_settings_show_menu(lv_obj_t *parent);  // build menu into parent (no screen load)
  ```

- [ ] **Step 1: Change `ui_settings_show_pin` to take a parent**

In `ui_settings.c`, replace `void ui_settings_show_pin(void)`'s body: take `lv_obj_t *parent`; build into a child container of `parent` instead of `lv_obj_create(NULL)`; do NOT call `lv_screen_load`. Keep all keypad/title/error/cancel construction identical, parented to the new container. Track it in `s_pin_screen` (now a child container, deleted the same way).
```c
void ui_settings_show_pin(lv_obj_t *parent) {
    lvgl_port_lock(0);
    s_pin_buf[0] = '\0';
    s_pin_submitted = false;
    if (s_pin_screen) { lv_obj_delete(s_pin_screen); s_pin_screen = NULL; }
    s_pin_screen = lv_obj_create(parent);
    lv_obj_remove_style_all(s_pin_screen);
    lv_obj_set_size(s_pin_screen, 720, 720);
    lv_obj_set_pos(s_pin_screen, 0, 0);
    lv_obj_clear_flag(s_pin_screen, LV_OBJ_FLAG_SCROLLABLE);
    /* ... identical title / s_pin_entry_lbl / s_pin_error_lbl / keypad / cancel,
       all parented to s_pin_screen exactly as before ... */
    lvgl_port_unlock();   // NOTE: no lv_screen_load
}
```

- [ ] **Step 2: Change `ui_settings_show_menu` to take a parent**

Same transformation: `void ui_settings_show_menu(lv_obj_t *parent)`, build the `s_menu_screen` container into `parent` (full-size, no style), keep title/info/4 buttons identical, drop `lv_screen_load`.

- [ ] **Step 3: Update declarations in `ui.h`**

```c
void ui_settings_show_pin(lv_obj_t *parent);
void ui_settings_show_menu(lv_obj_t *parent);
```
(`ui.h` already includes `lvgl.h` transitively via consumers; add `#include "lvgl.h"` to `ui.h` if `lv_obj_t` is otherwise undeclared there.)

- [ ] **Step 4: Keep callers compiling**

`run_settings_flow()` in `app_state.c` currently calls these with no args — it will be rewritten in Task 4. To keep THIS task's build green, temporarily pass `lv_layer_top()`:
change `ui_settings_show_pin();` → `ui_settings_show_pin(lv_layer_top());` and the two `ui_settings_show_menu();` → `ui_settings_show_menu(lv_layer_top());`.

- [ ] **Step 5: Build**

Run: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build` → success.

- [ ] **Step 6: Commit**

```bash
git add components/ui/ui_settings.c components/ui/include/ui.h main/app_state.c
git commit -m "refactor(ui): settings screens build into a caller parent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Render settings into the open sheet (no swap) + content fade

The sheet exposes its content area; `run_settings_flow()` builds the PIN/menu into it; the cover-destroy hack from Task 2 is removed so there is no screen-swap.

**Files:**
- Modify: `components/ui/ui_sheet.c`
- Modify: `components/ui/include/ui.h`
- Modify: `main/app_state.c`

**Interfaces:**
- Produces:
  ```c
  // The sheet's content container to build settings controls into (NULL if no sheet).
  lv_obj_t *ui_sheet_content(void);
  ```

- [ ] **Step 1: Expose the sheet content area**

In `ui_sheet.c`, the controls share the sheet container directly (it is already full-size). Add:
```c
lv_obj_t *ui_sheet_content(void) {
    lvgl_port_lock(0);
    lv_obj_t *c = s_sheet;
    lvgl_port_unlock();
    return c;
}
```
Declare in `ui.h`: `lv_obj_t *ui_sheet_content(void);`
Optionally fade content in on open: in `open_anim_done`, after `s_open = true`, the controls don't exist yet (poll_task builds them next); instead fade in within `run_settings_flow` (Step 3) via `lv_obj_fade_in(child, CONTENT_FADE_MS, 0)`.

- [ ] **Step 2: Remove the cover-destroy hack from poll_task**

In `app_state.c` revert Task 2's Step 5 to:
```c
        if (ui_consume_sheet_open()) {
            run_settings_flow();
            continue;
        }
```

- [ ] **Step 3: Rewrite `run_settings_flow()` to use the sheet**

Build the PIN/menu into `ui_sheet_content()`, and close the sheet (animate down) on every exit path instead of `ui_render_state(s_state)`:
```c
static void run_settings_flow(void) {
    const device_config_t *cfg = s_cfg_buf[s_cfg_live];
    ui_settings_action_t act;
    lv_obj_t *sheet = ui_sheet_content();
    if (!sheet) return;                         // sheet vanished (e.g. receipt) — abort

    if (cfg->device.settings_password_hash[0]) {
        ui_settings_show_pin(sheet);
        lv_obj_fade_in(sheet, 150, 0);
        for (;;) {
            char pin[16];
            if (ui_settings_consume_pin(pin, sizeof(pin))) {
                if (settings_pin_verify(pin, cfg->device.settings_password_hash,
                                        cfg->device.settings_password_salt)) {
                    ui_settings_consume_action(&act);
                    break;
                }
                ui_settings_pin_set_error(true);
            }
            if (ui_settings_consume_action(&act) && act == UI_SET_CLOSE) {
                ui_sheet_close();
                return;
            }
            vTaskDelay(pdMS_TO_TICKS(50));
        }
    }

    char info[160];
    build_settings_info(info, sizeof(info));
    ui_settings_set_info(info);
    ui_settings_show_menu(sheet);

    for (;;) {
        if (ui_settings_consume_action(&act)) {
            switch (act) {
                case UI_SET_WIFI:
                    wifi_setup_run();                 // loads its own screen, covers the sheet
                    build_settings_info(info, sizeof(info));
                    ui_settings_set_info(info);
                    ui_settings_show_menu(ui_sheet_content() ? ui_sheet_content() : sheet);
                    break;
                case UI_SET_TEST_PRINT:
                    ui_sheet_close();
                    run_test_ingest();
                    return;
                case UI_SET_REBOOT:
                    esp_restart();
                    break;
                case UI_SET_CLOSE:
                    ui_sheet_close();
                    return;
            }
        }
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
```
Note: `wifi_setup_run()` (existing) does its own `lv_screen_load`, so after returning from Wi-Fi setup the sheet has been covered/destroyed; rebuild the menu into a fresh sheet only if one exists, else `sheet` (it will be re-shown on the base screen — acceptable; Wi-Fi setup is a full-screen sub-flow either way). Keep behavior simple: re-show menu into current content parent.

- [ ] **Step 4: Build**

Run: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build` → success.

- [ ] **Step 5: Host tests green**

Run: `cd tools/cfg-harness && make test` → `ALL TESTS PASSED`.

- [ ] **Step 6: Commit**

```bash
git add components/ui/ui_sheet.c components/ui/include/ui.h main/app_state.c
git commit -m "feat(ui): settings render into the sheet — seamless swipe-up, no screen swap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: HIL verification + tuning (user)**

Flash and verify the full experience: drag tracks the finger; snap-open reveals the PIN keypad (locked device) or menu (no PIN) on the *same* panel with a fade — no flash; PIN verifies; menu actions (Wi-Fi / Test print / Reboot / Close) work; Close glides the sheet down; tap still test-prints; sleep/wake interplay intact. Tune `SHEET_DRAG_SLOP_PX`, `SHEET_OPEN_PCT`, `SHEET_FLICK_PX_S`, `SHEET_ANIM_MS` for feel.

---

### Task 5: Merge + document

- [ ] **Step 1:** With HIL verified, update `BUILD.md` in maratus-firmware with an "Interactive Settings sheet" entry (date, what shipped, the tuned constants), per the HW-verified convention.
- [ ] **Step 2:** Merge `feat/swipe-up-settings` → `main` (`git checkout main && git merge --no-ff`), delete the branch, push.
- [ ] **Step 3:** Update the maratus-admin spec/plan status to "shipped + HW-verified".

## Self-Review

- **Spec coverage:** top-layer sheet (T2), UI-thread animation (T2), lightweight panel tracks finger (T2), `gesture_snap` host-tested (T1), fade-in real controls on same panel/no swap (T3+T4), `run_settings_flow` into sheet (T4), tap-still-prints + suppression (T2), sleep/wake interplay (T4 Step 7 HIL), constants in one place (T2). Covered.
- **Placeholder scan:** none — every step has concrete code/commands. The `wifi_setup_run()` re-show caveat is documented behavior, not a placeholder.
- **Type consistency:** `ui_settings_show_pin/menu(lv_obj_t*)` consistent T3↔T4; `ui_consume_sheet_open`/`ui_sheet_close`/`ui_sheet_content`/`ui_suppress_next_click`/`ui_current_cfg` consistent across tasks; `gesture_snap`/`snap_decision_t` consistent T1↔T2.
- **Known integration risk (flagged for executor):** `ui_sheet` reads `s_cfg` via `ui_current_cfg()` — confirm `s_cfg` is the live pointer in `ui.c`. `wifi_setup_run()` loads its own screen mid-flow; the menu re-show after Wi-Fi is best-effort and verified on HIL.
