# Firmware Wi-Fi Setup Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the first-boot Wi-Fi setup screen as a staged two-panel flow — full-height network list, then a password panel titled with the chosen SSID — fixing the Connect-button overlap and the invisible-selection problem.

**Architecture:** One LVGL screen with two full-screen panels toggled via `LV_OBJ_FLAG_HIDDEN`; all widgets (keyboard included) are created once in `ui_wifi_show()`. The existing passive flag/consume API and the SCAN→LIST→PASSWORD→CONNECT orchestrator state machine are preserved; only a Back branch and a "connecting" view call are added. Zero network-logic changes.

**Tech Stack:** ESP-IDF 5.5, LVGL 9 (`esp_lvgl_port`), `font_cache` (lv_tiny_ttf brand font), FreeRTOS.

**Spec:** `docs/superpowers/specs/2026-07-11-firmware-wifi-screen-redesign-design.md` (maratus-admin repo)

## Global Constraints

- **Repo:** ALL code changes are in **`/Users/eren/Projects/maratus-firmware`** (NOT maratus-admin). Work on branch `feat/wifi-screen-redesign` off `main`.
- **Toolchain:** ESP-IDF **5.5** only — `. ~/.espressif/v5.5/esp-idf/export.sh`. NEVER export `ESP_IDF_VERSION` as a patch version like `5.5.4` (breaks esp_wifi_remote SDIO selection → boot panic; see BUILD.md).
- **The keyboard is untouchable:** same creation call, size `720×280`, `LV_ALIGN_BOTTOM_MID`, no styling. Only its parent (the password panel) and hidden-flag state may change.
- **Passive UI pattern:** LVGL event callbacks set volatile flags ONLY — no network calls, no heavy work. Every public `ui_wifi_*` function takes `lvgl_port_lock(0)` / `lvgl_port_unlock()` internally.
- **Exact copy strings (verbatim):** `Choose your Wi-Fi`, `Scanning...`, `No networks - tap Rescan`, `Other network...`, `Rescan`, `Other network`, `Network name`, `Password`, `Next`, `Connect`, `Connecting...`, `Enter the Wi-Fi password`, `Enter the network name`, `Enter a network name`, `Password must be 8+ characters`, `Couldn't connect - check the password`.
- **Brand:** background `MARATUS_GREEN 0x10A765`, white text, brand font via `font_cache_get(px, bold)`; LVGL symbol glyphs (`LV_SYMBOL_*`) must stay on the DEFAULT font (the brand TTF has no symbol glyphs).
- **No cloud changes.** No signal-strength icons, no lock glyphs (explicitly out of scope).
- Screen is 720×720. Money quote from the spec: password stage = back chip + SSID title + textarea (~480px) and Connect (~180px) **side by side, no overlap**.

---

### Task 1: Rebuild `ui_wifi.c` as a two-panel staged screen + new API

**Files:**
- Modify: `components/ui/ui_wifi.c` (full rewrite, content below)
- Modify: `components/ui/include/ui.h` (Wi-Fi section: 3 new declarations + comment updates)

**Interfaces:**
- Consumes: `font_cache_get(int px, bool bold)`, `font_cache_begin_pass()` (from `components/ui/font_cache.h`); `net_ap_t` (from `ui.h` includes); `lvgl_port_lock/unlock`.
- Produces (Task 2 relies on these exact signatures):
  - `void ui_wifi_show(void)` — builds both panels once, loads screen, starts in the list stage.
  - `void ui_wifi_show_list(void)` — NEW: switch back to the list stage.
  - `void ui_wifi_show_connecting(const char *ssid)` — NEW: password panel with input row/keyboard/back hidden, title = ssid, status `Connecting...` (sets the status itself; callers must NOT also call `ui_wifi_set_status("Connecting...")`).
  - `bool ui_wifi_consume_back(void)` — NEW: one-shot Back-button flag.
  - `void ui_wifi_prompt_ssid(void)` / `void ui_wifi_prompt_password(const char *ssid)` — same signatures; now also switch to the password panel and set title/status/button label. **They overwrite the status line**, so error status must be set AFTER the prompt call (Task 2 reorders one call site).
  - `ui_wifi_set_results` / `ui_wifi_set_status` / `ui_wifi_consume_selection` / `ui_wifi_consume_rescan` / `ui_wifi_consume_connect` — signatures and semantics unchanged.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/eren/Projects/maratus-firmware
git checkout main && git pull --ff-only 2>/dev/null; git checkout -b feat/wifi-screen-redesign
```

- [ ] **Step 2: Replace the entire contents of `components/ui/ui_wifi.c` with:**

```c
#include "ui.h"
#include <string.h>
#include "lvgl.h"
#include "esp_lvgl_port.h"
#include "font_cache.h"

// Bespoke, INTERACTIVE Wi-Fi setup screen (M6a-2; staged redesign 2026-07-11).
// PASSIVE by design: LVGL event callbacks ONLY set volatile flags/indices here
// — no network or heavy work. The orchestrator (wifi_setup_run) pushes data in
// (set_results/set_status/prompt_*/show_*) and polls the consume_* readers,
// mirroring the ui_consume_tap / ui_set_qr_url pattern in ui.c. Every public
// function takes the LVGL port lock internally, matching ui.c's discipline.
//
// TWO STAGES on ONE screen — panels toggled with LV_OBJ_FLAG_HIDDEN, every
// widget (keyboard included) created exactly once in ui_wifi_show():
//   list stage     — title + full-height network list (keyboard hidden)
//   password stage — back chip + network-name title + status line +
//                    textarea/Connect row + keyboard (unchanged 720x280)

#define MARATUS_GREEN 0x10A765

// screen + list-stage widgets
static lv_obj_t *s_wscreen, *s_list_panel, *s_list_sub, *s_list;
// password-stage widgets
static lv_obj_t *s_pw_panel, *s_back, *s_pw_title, *s_pw_status,
                *s_input_row, *s_ta, *s_connect_lbl, *s_kb;

static volatile bool s_sel_pending;       // a list row was tapped
static volatile bool s_sel_manual;        // the tapped row was "Other network..."
static volatile bool s_connect_pending;   // Connect/Next was tapped
static volatile bool s_rescan_pending;    // Rescan was tapped
static volatile bool s_back_pending;      // Back chip was tapped
static volatile int  s_sel_idx;           // index of the tapped scan result (<0 = manual)

static char s_typed_ssid[33];             // SSID captured when entering password mode
static bool s_manual_mode;                // true = textarea holds an SSID, not a password

// --- event callbacks: flags only, no work ---------------------------------
static void list_cb(lv_event_t *e) {
    int idx = (int)(intptr_t)lv_event_get_user_data(e);
    s_sel_idx    = idx;
    s_sel_manual = (idx < 0);
    s_sel_pending = true;
}
static void connect_cb(lv_event_t *e) { (void)e; s_connect_pending = true; }
static void rescan_cb(lv_event_t *e)  { (void)e; s_rescan_pending = true; }
static void back_cb(lv_event_t *e)    { (void)e; s_back_pending = true; }

// --- internal helpers (caller must hold the LVGL port lock) ----------------

// A list row: translucent white card, symbol icon + brand-font text.
// Symbols stay on LVGL's default font (the brand TTF carries no symbol glyphs).
static void add_row(const char *symbol, const char *text, lv_event_cb_t cb, int idx) {
    lv_obj_t *btn = lv_button_create(s_list);
    lv_obj_remove_style_all(btn);
    lv_obj_set_size(btn, lv_pct(100), 64);
    lv_obj_set_style_radius(btn, 12, LV_PART_MAIN);
    lv_obj_set_style_bg_color(btn, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(btn, LV_OPA_10, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(btn, LV_OPA_30, LV_PART_MAIN | LV_STATE_PRESSED); // touch feedback
    lv_obj_set_style_pad_left(btn, 20, LV_PART_MAIN);
    lv_obj_set_style_pad_right(btn, 20, LV_PART_MAIN);
    lv_obj_clear_flag(btn, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(btn, cb, LV_EVENT_CLICKED, (void *)(intptr_t)idx);

    lv_obj_t *ic = lv_label_create(btn);
    lv_label_set_text(ic, symbol);                    // default font: symbol glyphs
    lv_obj_set_style_text_color(ic, lv_color_white(), LV_PART_MAIN);
    lv_obj_align(ic, LV_ALIGN_LEFT_MID, 0, 0);

    lv_obj_t *lbl = lv_label_create(btn);
    lv_label_set_text(lbl, text);
    lv_obj_set_style_text_font(lbl, font_cache_get(22, false), LV_PART_MAIN);
    lv_obj_set_style_text_color(lbl, lv_color_white(), LV_PART_MAIN);
    lv_label_set_long_mode(lbl, LV_LABEL_LONG_DOT);   // ellipsize long SSIDs
    lv_obj_set_width(lbl, 680 - 2 * 20 - 44);         // row minus pads minus icon slot
    lv_obj_align(lbl, LV_ALIGN_LEFT_MID, 44, 0);
}

// Stage switches. Drop stale one-shot intents from the outgoing stage so the
// orchestrator never acts on a tap that belonged to a widget no longer shown.
static void show_stage_list(void) {
    s_back_pending = false; s_connect_pending = false;
    lv_obj_add_flag(s_pw_panel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(s_list_panel, LV_OBJ_FLAG_HIDDEN);
}
static void show_stage_pw(bool with_input) {
    s_sel_pending = false; s_rescan_pending = false;
    s_connect_pending = false; s_back_pending = false;
    lv_obj_add_flag(s_list_panel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(s_pw_panel, LV_OBJ_FLAG_HIDDEN);
    if (with_input) {
        lv_obj_clear_flag(s_input_row, LV_OBJ_FLAG_HIDDEN);
        lv_obj_clear_flag(s_kb, LV_OBJ_FLAG_HIDDEN);
        lv_obj_clear_flag(s_back, LV_OBJ_FLAG_HIDDEN);
    } else {                                          // "Connecting..." view
        lv_obj_add_flag(s_input_row, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(s_kb, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(s_back, LV_OBJ_FLAG_HIDDEN);
    }
}

// --- public API -------------------------------------------------------------

void ui_wifi_show(void) {
    lvgl_port_lock(0);
    font_cache_begin_pass();                          // pin this screen's fonts
    const lv_font_t *f_title  = font_cache_get(28, true);
    const lv_font_t *f_status = font_cache_get(20, false);
    const lv_font_t *f_row    = font_cache_get(22, false);
    const lv_font_t *f_btn    = font_cache_get(22, true);
    (void)f_row;                                      // pinned for add_row()

    s_wscreen = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(s_wscreen, lv_color_hex(MARATUS_GREEN), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_wscreen, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_clear_flag(s_wscreen, LV_OBJ_FLAG_SCROLLABLE);

    // ---- list stage panel --------------------------------------------------
    s_list_panel = lv_obj_create(s_wscreen);
    lv_obj_remove_style_all(s_list_panel);
    lv_obj_set_size(s_list_panel, 720, 720);
    lv_obj_clear_flag(s_list_panel, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t *title = lv_label_create(s_list_panel);
    lv_label_set_text(title, "Choose your Wi-Fi");
    lv_obj_set_style_text_font(title, f_title, LV_PART_MAIN);
    lv_obj_set_style_text_color(title, lv_color_white(), LV_PART_MAIN);
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 28);

    s_list_sub = lv_label_create(s_list_panel);       // status line (Scanning... etc.)
    lv_label_set_text(s_list_sub, "");
    lv_obj_set_style_text_font(s_list_sub, f_status, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_list_sub, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_text_opa(s_list_sub, LV_OPA_80, LV_PART_MAIN);
    lv_obj_align(s_list_sub, LV_ALIGN_TOP_MID, 0, 70);

    // Plain scrollable flex column — full styling control (lv_list's theme
    // fights the brand look). 64px rows + 8px gaps, scrolls when overflowing.
    s_list = lv_obj_create(s_list_panel);
    lv_obj_remove_style_all(s_list);
    lv_obj_set_size(s_list, 680, 596);                // 104..700 of the 720 screen
    lv_obj_align(s_list, LV_ALIGN_TOP_MID, 0, 104);
    lv_obj_set_flex_flow(s_list, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_row(s_list, 8, LV_PART_MAIN);
    lv_obj_set_scroll_dir(s_list, LV_DIR_VER);

    // ---- password stage panel (hidden until a network is picked) -----------
    s_pw_panel = lv_obj_create(s_wscreen);
    lv_obj_remove_style_all(s_pw_panel);
    lv_obj_set_size(s_pw_panel, 720, 720);
    lv_obj_clear_flag(s_pw_panel, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(s_pw_panel, LV_OBJ_FLAG_HIDDEN);

    // Back chip, 56x56 (>=48px touch target), top-left.
    s_back = lv_button_create(s_pw_panel);
    lv_obj_remove_style_all(s_back);
    lv_obj_set_size(s_back, 56, 56);
    lv_obj_align(s_back, LV_ALIGN_TOP_LEFT, 20, 20);
    lv_obj_set_style_radius(s_back, 16, LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_back, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_back, LV_OPA_20, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_back, LV_OPA_40, LV_PART_MAIN | LV_STATE_PRESSED);
    lv_obj_clear_flag(s_back, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(s_back, back_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t *back_ic = lv_label_create(s_back);
    lv_label_set_text(back_ic, LV_SYMBOL_LEFT);       // default font: symbol glyphs
    lv_obj_set_style_text_color(back_ic, lv_color_white(), LV_PART_MAIN);
    lv_obj_center(back_ic);

    // Selected-network name — THE selection feedback.
    s_pw_title = lv_label_create(s_pw_panel);
    lv_label_set_text(s_pw_title, "");
    lv_obj_set_style_text_font(s_pw_title, f_title, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_pw_title, lv_color_white(), LV_PART_MAIN);
    lv_label_set_long_mode(s_pw_title, LV_LABEL_LONG_DOT);
    lv_obj_set_width(s_pw_title, 500);                // clears the 56px back chip both sides
    lv_obj_set_style_text_align(s_pw_title, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_obj_align(s_pw_title, LV_ALIGN_TOP_MID, 0, 34);

    s_pw_status = lv_label_create(s_pw_panel);
    lv_label_set_text(s_pw_status, "");
    lv_obj_set_style_text_font(s_pw_status, f_status, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_pw_status, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_text_opa(s_pw_status, LV_OPA_80, LV_PART_MAIN);
    lv_obj_align(s_pw_status, LV_ALIGN_TOP_MID, 0, 100);

    // Input row: textarea (480) + Connect (180) side by side, 20px gap — the
    // two never overlap (the old screen's bug). Grouped so the "Connecting..."
    // view can hide them together.
    s_input_row = lv_obj_create(s_pw_panel);
    lv_obj_remove_style_all(s_input_row);
    lv_obj_set_size(s_input_row, 680, 60);
    lv_obj_align(s_input_row, LV_ALIGN_TOP_MID, 0, 150);
    lv_obj_clear_flag(s_input_row, LV_OBJ_FLAG_SCROLLABLE);

    s_ta = lv_textarea_create(s_input_row);
    lv_textarea_set_one_line(s_ta, true);
    lv_obj_set_size(s_ta, 480, 60);
    lv_obj_align(s_ta, LV_ALIGN_LEFT_MID, 0, 0);
    lv_obj_set_style_radius(s_ta, 12, LV_PART_MAIN);
    lv_obj_set_style_text_font(s_ta, f_status, LV_PART_MAIN);

    lv_obj_t *btn = lv_button_create(s_input_row);
    lv_obj_remove_style_all(btn);
    lv_obj_set_size(btn, 180, 60);
    lv_obj_align(btn, LV_ALIGN_RIGHT_MID, 0, 0);
    lv_obj_set_style_radius(btn, 12, LV_PART_MAIN);
    lv_obj_set_style_bg_color(btn, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(btn, LV_OPA_80, LV_PART_MAIN | LV_STATE_PRESSED);
    lv_obj_clear_flag(btn, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(btn, connect_cb, LV_EVENT_CLICKED, NULL);
    s_connect_lbl = lv_label_create(btn);
    lv_label_set_text(s_connect_lbl, "Connect");      // becomes "Next" in manual mode
    lv_obj_set_style_text_font(s_connect_lbl, f_btn, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_connect_lbl, lv_color_hex(MARATUS_GREEN), LV_PART_MAIN);
    lv_obj_center(s_connect_lbl);

    // Keyboard — UNCHANGED: same creation, size, position, default styling.
    s_kb = lv_keyboard_create(s_pw_panel);
    lv_keyboard_set_textarea(s_kb, s_ta);
    lv_obj_set_size(s_kb, 720, 280);
    lv_obj_align(s_kb, LV_ALIGN_BOTTOM_MID, 0, 0);

    lv_screen_load(s_wscreen);
    lvgl_port_unlock();
}

void ui_wifi_show_list(void) {
    lvgl_port_lock(0);
    show_stage_list();
    lvgl_port_unlock();
}

void ui_wifi_show_connecting(const char *ssid) {
    lvgl_port_lock(0);
    lv_label_set_text(s_pw_title, ssid ? ssid : "");
    lv_label_set_text(s_pw_status, "Connecting...");
    lv_label_set_text(s_list_sub, "Connecting...");
    show_stage_pw(false);
    lvgl_port_unlock();
}

void ui_wifi_set_results(const net_ap_t *aps, int n) {
    lvgl_port_lock(0);
    lv_obj_clean(s_list);
    for (int i = 0; i < n; i++) add_row(LV_SYMBOL_WIFI, aps[i].ssid, list_cb, i);
    add_row(LV_SYMBOL_PLUS, "Other network...", list_cb, -1);
    add_row(LV_SYMBOL_REFRESH, "Rescan", rescan_cb, 0);
    lvgl_port_unlock();
}

void ui_wifi_set_status(const char *t) {
    lvgl_port_lock(0);
    lv_label_set_text(s_list_sub, t ? t : "");
    lv_label_set_text(s_pw_status, t ? t : "");
    lvgl_port_unlock();
}

void ui_wifi_prompt_ssid(void) {
    lvgl_port_lock(0);
    s_manual_mode = true;
    lv_label_set_text(s_pw_title, "Other network");
    lv_label_set_text(s_pw_status, "Enter the network name");
    lv_label_set_text(s_connect_lbl, "Next");
    lv_textarea_set_password_mode(s_ta, false);
    lv_textarea_set_text(s_ta, "");
    lv_textarea_set_placeholder_text(s_ta, "Network name");
    show_stage_pw(true);
    lvgl_port_unlock();
}

void ui_wifi_prompt_password(const char *ssid) {
    lvgl_port_lock(0);
    s_manual_mode = false;
    strncpy(s_typed_ssid, ssid ? ssid : "", sizeof(s_typed_ssid) - 1);
    s_typed_ssid[sizeof(s_typed_ssid) - 1] = '\0';
    lv_label_set_text(s_pw_title, s_typed_ssid);
    lv_label_set_text(s_pw_status, "Enter the Wi-Fi password");
    lv_label_set_text(s_connect_lbl, "Connect");
    lv_textarea_set_password_mode(s_ta, true);
    lv_textarea_set_text(s_ta, "");
    lv_textarea_set_placeholder_text(s_ta, "Password");
    show_stage_pw(true);
    lvgl_port_unlock();
}

bool ui_wifi_consume_selection(int *idx, bool *manual) {
    if (!s_sel_pending) return false;
    s_sel_pending = false;
    if (idx)    *idx = s_sel_idx;
    if (manual) *manual = s_sel_manual;
    return true;
}

bool ui_wifi_consume_rescan(void) {
    bool r = s_rescan_pending;
    s_rescan_pending = false;
    return r;
}

bool ui_wifi_consume_back(void) {
    bool r = s_back_pending;
    s_back_pending = false;
    return r;
}

bool ui_wifi_consume_connect(char *ssid, int sc, char *pass, int pc) {
    if (!s_connect_pending) return false;
    s_connect_pending = false;
    // Reads the textarea, so take the lock (matches ui.c's consume locking).
    lvgl_port_lock(0);
    const char *txt = lv_textarea_get_text(s_ta);
    if (s_manual_mode) {
        strncpy(ssid, txt, sc - 1); ssid[sc - 1] = '\0';
        pass[0] = '\0';
    } else {
        strncpy(ssid, s_typed_ssid, sc - 1); ssid[sc - 1] = '\0';
        strncpy(pass, txt, pc - 1);          pass[pc - 1] = '\0';
    }
    lvgl_port_unlock();
    return true;
}
```

- [ ] **Step 3: Update the Wi-Fi section of `components/ui/include/ui.h`**

Replace the block from `// --- Wi-Fi setup screen (M6a-2) ---` down to (and including) the `ui_wifi_prompt_password` declaration with:

```c
// --- Wi-Fi setup screen (M6a-2; staged redesign 2026-07-11) ----------------
// A bespoke, INTERACTIVE screen (not config-object-driven). It is PASSIVE: an
// orchestrator pushes data in (set_results/set_status/prompt_*/show_*) and
// reads user intent out via the consume_* flags. Network calls live in the
// orchestrator, never in the LVGL callbacks. All functions take the LVGL port
// lock internally. Two stages on one screen: a full-height network list, then
// a password panel titled with the chosen SSID (keyboard lives there).

// Build + load the Wi-Fi setup screen (starts in the network-list stage).
void ui_wifi_show(void);

// Return to the network-list stage (Back button / restart of the flow).
void ui_wifi_show_list(void);

// Show the password panel in "Connecting..." mode: title = ssid, status
// "Connecting...", input row + keyboard + back chip hidden. Call right before
// net_connect(); do NOT also call ui_wifi_set_status("Connecting...").
void ui_wifi_show_connecting(const char *ssid);

// Replace the SSID list with `n` scan results (plus "Other network..." + "Rescan").
void ui_wifi_set_results(const net_ap_t *aps, int n);

// Update the status line (shown on both stages).
void ui_wifi_set_status(const char *text);

// True (once) if the user picked a list row. *idx = result index, or <0 / *manual
// = true for the "Other network..." row. Cleared on read.
bool ui_wifi_consume_selection(int *idx, bool *manual);

// True (once) if the user tapped Connect/Next. Copies the SSID + password the
// orchestrator should use (depends on manual vs picked-network mode). Cleared on read.
bool ui_wifi_consume_connect(char *ssid, int ssid_cap, char *pass, int pass_cap);

// True (once) if the user tapped Rescan. Cleared on read.
bool ui_wifi_consume_rescan(void);

// True (once) if the user tapped Back on the password stage. Cleared on read.
bool ui_wifi_consume_back(void);

// Switch to the password panel in manual-SSID entry mode (title "Other
// network", plain text, "Network name", button "Next"). NOTE: overwrites the
// status line — set error status AFTER calling this.
void ui_wifi_prompt_ssid(void);

// Switch to the password panel for `ssid` (title = ssid, masked, "Password",
// button "Connect"). NOTE: overwrites the status line — set error status
// AFTER calling this.
void ui_wifi_prompt_password(const char *ssid);
```

- [ ] **Step 4: Build to verify it compiles**

```bash
cd /Users/eren/Projects/maratus-firmware
. ~/.espressif/v5.5/esp-idf/export.sh
idf.py build
```

Expected: `Project build complete.` (If the failure is inside `esp_wifi_remote`, run `./tools/patch-deps.sh` and rebuild — see BUILD.md.)

- [ ] **Step 5: Commit**

```bash
cd /Users/eren/Projects/maratus-firmware
git add components/ui/ui_wifi.c components/ui/include/ui.h
git commit -m "feat(ui): staged two-panel Wi-Fi setup screen (list -> password), brand styling"
```

---

### Task 2: Wire the orchestrator to the staged flow (`wifi_setup.c`)

**Files:**
- Modify: `main/wifi_setup.c` (three call sites; state machine and all network logic otherwise unchanged)

**Interfaces:**
- Consumes (from Task 1, exact signatures): `void ui_wifi_show_list(void)`, `void ui_wifi_show_connecting(const char *ssid)`, `bool ui_wifi_consume_back(void)`; plus the unchanged `ui_wifi_*` API.
- Produces: the complete first-boot Wi-Fi UX; `wifi_setup_run()` signature unchanged (nothing in `app_main.c` changes).

- [ ] **Step 1: Apply three edits to `main/wifi_setup.c`**

Edit A — in the `SCAN` branch, the list-stage title is now static ("Choose your Wi-Fi" lives in the panel), so the post-scan status only reports the empty case. Replace:

```c
            ui_wifi_set_status(n ? "Choose your Wi-Fi" : "No networks - tap Rescan");
```

with:

```c
            ui_wifi_set_status(n ? "" : "No networks - tap Rescan");
```

Edit B — add the Back branch to the `PASSWORD` state. Replace:

```c
        } else if (st == PASSWORD) {
            char es[33], ep[64];
            if (ui_wifi_consume_connect(es, sizeof(es), ep, sizeof(ep))) {
```

with:

```c
        } else if (st == PASSWORD) {
            char es[33], ep[64];
            if (ui_wifi_consume_back()) {
                ssid[0] = '\0'; pass[0] = '\0'; open = false;
                ui_wifi_show_list();
                st = LIST;
            } else if (ui_wifi_consume_connect(es, sizeof(es), ep, sizeof(ep))) {
```

Edit C — the `CONNECT` state uses the connecting view, and the error status is set AFTER `prompt_password` (which overwrites the status line). Replace:

```c
        } else if (st == CONNECT) {
            ui_wifi_set_status("Connecting...");
            if (net_connect(ssid, pass)) {
                appcfg_store_wifi_creds(ssid, pass);
                ESP_LOGI(TAG, "connected + stored creds for '%s'", ssid);
                return;
            }
            ui_wifi_set_status("Couldn't connect - check the password");
            ui_wifi_prompt_password(ssid);
            st = PASSWORD;
        }
```

with:

```c
        } else if (st == CONNECT) {
            ui_wifi_show_connecting(ssid);
            if (net_connect(ssid, pass)) {
                appcfg_store_wifi_creds(ssid, pass);
                ESP_LOGI(TAG, "connected + stored creds for '%s'", ssid);
                return;
            }
            ui_wifi_prompt_password(ssid);
            ui_wifi_set_status("Couldn't connect - check the password");
            st = PASSWORD;
        }
```

The `LIST` branch and the rest of `PASSWORD` (manual-SSID validation, password validation) are untouched — their `set_status` error calls already happen with the panel in place, no prompt call after them.

- [ ] **Step 2: Build**

```bash
cd /Users/eren/Projects/maratus-firmware
. ~/.espressif/v5.5/esp-idf/export.sh
idf.py build
```

Expected: `Project build complete.`

- [ ] **Step 3: Commit**

```bash
cd /Users/eren/Projects/maratus-firmware
git add main/wifi_setup.c
git commit -m "feat(wifi-setup): back navigation + connecting view for staged Wi-Fi UI"
```

---

### Task 3: HIL verification on device b580 + merge

**Files:** none (hardware verification + git merge). Requires the physical desk device (Printer b580, serial `e8f60ae0b580`) and the USER at the screen — a subagent cannot do the touch steps; run this task interactively with the user.

**Interfaces:**
- Consumes: the built firmware from Tasks 1–2.
- Produces: `feat/wifi-screen-redesign` merged to maratus-firmware `main`.

**⚠️ Pre-flight — device-key orphaning hazard:** `idf.py erase-flash` wipes NVS, which holds BOTH the Wi-Fi creds AND the device key. The prod factory-registry entry for `e8f60ae0b580` is currently `claimed` (key already consumed), so after an erase the device could NOT re-claim and would be orphaned (this exact incident happened on 2026-07-10). **Before erasing**, re-arm the registry: in the admin console (`/admin/inventory`, admin@maratus.app), use the revert-claim action on serial `e8f60ae0b580` so the entry returns to `allocated` with a fresh pending key. The end of this task doubles as a zero-touch-claim regression test.

- [ ] **Step 1: Re-arm the factory-registry entry** — admin console → `/admin/inventory` → serial `e8f60ae0b580` → revert claim. Verify the entry shows `allocated`.

- [ ] **Step 2: Confirm first-boot Kconfig** — the gitignored `sdkconfig` must have `CONFIG_MARATUS_WIFI_SSID="changeme"` (else the boot gate silently connects and skips the UI):

```bash
cd /Users/eren/Projects/maratus-firmware
grep 'CONFIG_MARATUS_WIFI_SSID\|CONFIG_MARATUS_WIFI_PASSWORD' sdkconfig
```

Expected: both values `"changeme"`. If not, edit them in `sdkconfig`, then `idf.py build`.

- [ ] **Step 3: Erase + flash + monitor** (USB-to-UART port; rediscover with `ls /dev/cu.usbmodem*`):

```bash
idf.py -p /dev/cu.usbmodem* erase-flash
idf.py -p /dev/cu.usbmodem* flash monitor
```

- [ ] **Step 4: Walk the HIL checklist with the user at the screen** (test AP `test_EXT` / `nyHyrfqn3khn`):

1. List stage: title "Choose your Wi-Fi", full-height list (~64px translucent rows, brand font), NO keyboard/textarea visible, scan results present.
2. Tap a row and hold briefly: pressed state visibly brightens (touch feedback).
3. Tap `test_EXT`: screen switches to the password panel; **the title reads `test_EXT`** (bold, centered); status "Enter the Wi-Fi password"; textarea + Connect side by side with no overlap; keyboard at the bottom, unchanged.
4. Type on the keyboard: characters appear masked (bullets) in the textarea.
5. Tap `[←]` Back: returns to the list stage (list still populated).
6. Tap `Other network...`: title "Other network", placeholder "Network name", button reads `Next`. Type `bogus_net`, tap Next: title becomes `bogus_net`, field switches to masked password mode, button reads `Connect`. Tap Back to return to the list.
7. Tap `Rescan`: status shows "Scanning..." then the list repopulates.
8. Tap `test_EXT`, type a WRONG password, tap Connect: brief "Connecting..." view (input row/keyboard/back hidden), then back to the password panel with status "Couldn't connect - check the password".
9. Enter the correct password, tap Connect: "Connecting..." view → serial monitor logs `connected + stored creds for 'test_EXT'` → boot proceeds to the claim flow.
10. Zero-touch claim regression: device auto-claims (monitor shows the claim poll succeeding), comes online in the admin console; `/admin/inventory` entry back to `claimed`.
11. Reboot (`Ctrl+T Ctrl+R` in monitor or power-cycle): device connects silently with stored creds — no Wi-Fi UI.

If any check fails: STOP, report exactly what was seen (photo/serial log), fix before merging.

- [ ] **Step 5: Merge to main**

```bash
cd /Users/eren/Projects/maratus-firmware
git checkout main
git merge --no-ff feat/wifi-screen-redesign -m "Merge feat/wifi-screen-redesign: staged two-panel Wi-Fi setup UI"
git push && git branch -d feat/wifi-screen-redesign
```

---

## Self-Review Notes

- Spec coverage: staged panels (T1), selection feedback via title (T1 §password panel), side-by-side input row (T1), open-network connecting view (T1 `show_connecting` + T2 Edit C — LIST already jumps straight to CONNECT for open networks), manual two-press Next→Connect (T1 prompt fns), Back (T1+T2 Edit B), brand styling (T1), keyboard untouched (T1 Step 2 keyboard block), error copy preserved (T2 Edit C ordering), HIL scenarios (T3).
- Status-line clobber hazard (prompt_* overwrite) is documented in ui.h comments and handled by T2 Edit C's call order.
- Stale-flag hazard on stage switches handled by `show_stage_list`/`show_stage_pw` clearing pendings.
- `wifi_util` host tests untouched (no logic change).
