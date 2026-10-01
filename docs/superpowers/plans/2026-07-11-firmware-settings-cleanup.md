# Firmware Settings Screen Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six user-reported problems on the on-device Settings screens: overlapping top-right info text, vestigial "Print listener" About row, sleep chips that don't highlight when tapped, a crash-reboot when exiting Wi-Fi setup via ✕, an unwanted ✕ icon on the Close button, and an unwanted › chevron on the Restart row.

**Architecture:** All changes live in the **maratus-firmware** repo (`/Users/eren/Projects/maratus-firmware`): the passive Settings UI (`components/ui/ui_settings.c`), the Wi-Fi setup UI (`components/ui/ui_wifi.c`), the shared header (`components/ui/include/ui.h`), and the orchestrator (`main/app_state.c`). Tasks 1–4 are deterministic edits; Task 5 is an on-hardware crash investigation (systematic-debugging) with a pre-analyzed prime suspect and a complete candidate fix.

**Tech Stack:** ESP-IDF 5.5 (C), LVGL v9 via `esp_lvgl_port`, target `esp32p4`.

**Spec:** `docs/superpowers/specs/2026-07-11-firmware-settings-cleanup-design.md` (maratus-admin).

## Global Constraints

- Work in `/Users/eren/Projects/maratus-firmware` on branch `feat/settings-cleanup` (created in Task 1 off `main`). The maratus-admin repo is NOT touched by any task.
- Build env: `. ~/.espressif/v5.5/esp-idf/export.sh` — ESP-IDF **5.5**, never 5.4/6.x (see `BUILD.md`; wrong version breaks the Waveshare board stack).
- Build command (from repo root): `idf.py build`. Every task must end with a clean build.
- There is no host test harness for LVGL UI code — verification is clean build per task + the HIL pass in Task 6. Do not invent a UI test framework.
- UI code style: passive callbacks (flags only), every public `ui_*` function takes `lvgl_port_lock(0)`/`lvgl_port_unlock()` internally. Match surrounding comment density.
- No layout/spacing/typography changes beyond the six spec items. Leave the About "Online" row label and the Restart "Reboots in ~30s" subtitle as they are.
- Line numbers below refer to maratus-firmware `main` as of 2026-07-11 (post-`a419ffa`). Verify with the exact code strings given (use exact-string edits, not line offsets).

---

### Task 1: Create branch; remove the top-right info block from the Settings menu

**Files:**
- Modify: `components/ui/ui_settings.c` (statics ~121/138, set_info fn ~350–360, show_menu ~376–408, reset ~919)
- Modify: `components/ui/include/ui.h` (~173–177)
- Modify: `main/app_state.c` (build_settings_info ~198–218, run_settings_flow ~278, ~305–306, ~320–321)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `ui_settings_set_info()` and `build_settings_info()` NO LONGER EXIST. Later tasks (5) must not call them — Task 5's `UI_SET_WIFI` case rewrite already assumes they are gone.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/eren/Projects/maratus-firmware
git checkout main && git pull && git checkout -b feat/settings-cleanup
```

- [ ] **Step 2: Remove the info label from `components/ui/ui_settings.c`**

Delete the static (near line 121):

```c
static lv_obj_t *s_menu_info_lbl;
```

Delete the buffer (near line 138):

```c
static char s_info_text[256];   // last text pushed by ui_settings_set_info
```

Delete the whole info-setter section (near lines 350–360):

```c
// --------------------------------------------------------------------------
// Public API — info setter (can be called before show_menu)
// --------------------------------------------------------------------------

void ui_settings_set_info(const char *text) {
    lvgl_port_lock(0);
    strncpy(s_info_text, text ? text : "", sizeof(s_info_text) - 1);
    s_info_text[sizeof(s_info_text) - 1] = '\0';
    if (s_menu_info_lbl) lv_label_set_text(s_menu_info_lbl, s_info_text);
    lvgl_port_unlock();
}
```

In `ui_settings_show_menu`, delete the now-unused font pick (near line 379):

```c
    const lv_font_t *f_info  = font_cache_get(16, false);
```

Replace the header comment + info-label block (near lines 394–408):

```c
    // 1. Header — title left, info (s_menu_info_lbl) right.
    lv_obj_t *title = lv_label_create(s_menu_screen);
    lv_label_set_text(title, "Settings");
    lv_obj_set_style_text_font(title, f_title, LV_PART_MAIN);
    lv_obj_set_style_text_color(title, p.fg, 0);
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, PAD, PAD);

    s_menu_info_lbl = lv_label_create(s_menu_screen);
    lv_label_set_long_mode(s_menu_info_lbl, LV_LABEL_LONG_DOT);
    lv_obj_set_width(s_menu_info_lbl, 300);
    lv_label_set_text(s_menu_info_lbl, s_info_text[0] ? s_info_text : "");
    lv_obj_set_style_text_font(s_menu_info_lbl, f_info, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_menu_info_lbl, p.muted, 0);
    lv_obj_set_style_text_align(s_menu_info_lbl, LV_TEXT_ALIGN_RIGHT, 0);
    lv_obj_align(s_menu_info_lbl, LV_ALIGN_TOP_RIGHT, -PAD, PAD + 6);
```

with:

```c
    // 1. Header — title only. (Device facts live on the About sub-screen.)
    lv_obj_t *title = lv_label_create(s_menu_screen);
    lv_label_set_text(title, "Settings");
    lv_obj_set_style_text_font(title, f_title, LV_PART_MAIN);
    lv_obj_set_style_text_color(title, p.fg, 0);
    lv_obj_align(title, LV_ALIGN_TOP_LEFT, PAD, PAD);
```

In `ui_settings_reset`, delete:

```c
    s_menu_info_lbl = NULL;
```

- [ ] **Step 3: Remove the declaration from `components/ui/include/ui.h`**

Delete (near lines 173–174):

```c
// Set the device-info block text shown at the top of the menu screen.
void ui_settings_set_info(const char *text);
```

And update the adjacent comment:

```c
// Build the menu screen (info label + 4 action buttons) into `parent`.
```

to:

```c
// Build the menu screen (4 action buttons) into `parent`.
```

- [ ] **Step 4: Remove producer + call sites from `main/app_state.c`**

Delete the whole function and its comment (near lines 198–218) — note `rssi_to_level()` just above it is STILL used by `build_about_info`, keep it:

```c
// Build a human-readable settings info string (firmware version, Wi-Fi SSID,
// signal bars, IP address, online status). Device name/ID are not stored on-device
// and are intentionally omitted.
static void build_settings_info(char *out, int cap) {
    ...
}
```

In `run_settings_flow`, delete the buffer (near line 278):

```c
    char info[160];
```

Replace the menu-entry block (near lines 303–307):

```c
    // Menu — build into the SAME scr (ui_settings_show_menu deletes the old pin
    // child container and adds the menu; scr is already the active screen).
    build_settings_info(info, sizeof(info));
    ui_settings_set_info(info);
    ui_settings_show_menu(scr);
```

with:

```c
    // Menu — build into the SAME scr (ui_settings_show_menu deletes the old pin
    // child container and adds the menu; scr is already the active screen).
    ui_settings_show_menu(scr);
```

In the `UI_SET_WIFI` case, delete the two refresh lines (near lines 320–321):

```c
                    build_settings_info(info, sizeof(info));
                    ui_settings_set_info(info);
```

- [ ] **Step 5: Build**

```bash
. ~/.espressif/v5.5/esp-idf/export.sh && cd /Users/eren/Projects/maratus-firmware && idf.py build
```

Expected: `Project build complete.` No warnings about unused `info`/`build_settings_info` (they're gone, not orphaned).

- [ ] **Step 6: Commit**

```bash
git add components/ui/ui_settings.c components/ui/include/ui.h main/app_state.c
git commit -m "fix(settings): drop the top-right info block that menu rows overlapped"
```

---

### Task 2: Remove "Print listener" from the About screen

**Files:**
- Modify: `main/app_state.c` (`build_about_info`, ~220–255)
- Modify: `components/ui/ui_settings.c` (About comment ~516–520, dot check ~615)

**Interfaces:**
- Consumes: nothing.
- Produces: About `info_block` no longer contains a `Print listener` line; the green-dot check matches only `"Online"`.

- [ ] **Step 1: Drop the row from `build_about_info` in `main/app_state.c`**

Update the function comment:

```c
// Build the About sub-screen content: one "label\tvalue\n" line per fact
// (firmware, IP, MAC, Wi-Fi, signal, Online, print listener). Rendered as a
// read-only card list by ui_settings_show_about.
```

to:

```c
// Build the About sub-screen content: one "label\tvalue\n" line per fact
// (firmware, IP, MAC, Wi-Fi, signal, Online). Rendered as a read-only card
// list by ui_settings_show_about.
```

Replace the format string:

```c
    snprintf(out, n,
             "Firmware\t%s\n"
             "IP\t%s\n"
             "MAC\t%s\n"
             "Wi-Fi\t%s\n"
             "Signal\t%s\n"
             "Online\t%s\n"
             "Print listener\tListening",
             CONFIG_MARATUS_FW_VERSION, ip, mac, ssid, bars,
             net_is_connected() ? "Online" : "Offline");
```

with:

```c
    snprintf(out, n,
             "Firmware\t%s\n"
             "IP\t%s\n"
             "MAC\t%s\n"
             "Wi-Fi\t%s\n"
             "Signal\t%s\n"
             "Online\t%s",
             CONFIG_MARATUS_FW_VERSION, ip, mac, ssid, bars,
             net_is_connected() ? "Online" : "Offline");
```

- [ ] **Step 2: Clean the dead "Listening" branch in `components/ui/ui_settings.c`**

In the About section comment (near line 518), change:

```c
// list: muted label left, fg value right. Online/Listening get a green dot,
// Offline a red dot. A back button (card-style LV_SYMBOL_LEFT chip) latches
```

to:

```c
// list: muted label left, fg value right. Online gets a green dot, Offline a
// red dot. A back button (card-style LV_SYMBOL_LEFT chip) latches
```

And change (near line 615):

```c
        bool good = (strcmp(value, "Online") == 0) || (strcmp(value, "Listening") == 0);
```

to:

```c
        bool good = (strcmp(value, "Online") == 0);
```

- [ ] **Step 3: Build**

```bash
. ~/.espressif/v5.5/esp-idf/export.sh && cd /Users/eren/Projects/maratus-firmware && idf.py build
```

Expected: `Project build complete.`

- [ ] **Step 4: Commit**

```bash
git add main/app_state.c components/ui/ui_settings.c
git commit -m "fix(settings): remove vestigial Print listener row from About"
```

---

### Task 3: Re-render device-settings screen when a sleep chip is tapped

**Files:**
- Modify: `main/app_state.c` (`run_settings_flow` `UI_SET_DEVICE` loop, ~373)

**Interfaces:**
- Consumes: existing `ui_settings_show_device(lv_obj_t *parent, bool use_device, int brightness, int sleep_encoded)`, `devset_eff_brightness`, `devset_eff_sleep`, `cloud_sleep_encoded` — all already in scope at the edit site.
- Produces: tapping a sleep chip now rebuilds the screen with the new chip accent-filled (same pattern the use-device switch already uses).

- [ ] **Step 1: Apply the edit**

In the `UI_SET_DEVICE` inner loop, replace:

```c
                        int e;
                        if (g_dev.use_device && ui_settings_consume_sleep(&e)) { devset_set_sleep(&g_dev, e); overrides_save(); s_last_activity_ms = now_ms(); }
```

with:

```c
                        int e;
                        if (g_dev.use_device && ui_settings_consume_sleep(&e)) {
                            devset_set_sleep(&g_dev, e); overrides_save(); s_last_activity_ms = now_ms();
                            ui_settings_show_device(scr, g_dev.use_device,
                                devset_eff_brightness(&g_dev, cfg->device.brightness),
                                devset_eff_sleep(&g_dev, cloud_sleep_encoded(cfg)));   // re-render so the tapped chip highlights
                        }
```

- [ ] **Step 2: Build**

```bash
. ~/.espressif/v5.5/esp-idf/export.sh && cd /Users/eren/Projects/maratus-firmware && idf.py build
```

Expected: `Project build complete.`

- [ ] **Step 3: Commit**

```bash
git add main/app_state.c
git commit -m "fix(settings): highlight the tapped sleep chip by re-rendering device settings"
```

---

### Task 4: Remove the Close button's ✕ icon and the Restart row's › chevron

**Files:**
- Modify: `components/ui/ui_settings.c` (menu rows table ~411–417, chevron ~464–468, Close button label ~483–501)

**Interfaces:**
- Consumes: nothing.
- Produces: visual-only changes; `menu_action_cb` wiring and `ui_settings_action_t` values unchanged.

- [ ] **Step 1: Add a per-row chevron flag**

In `ui_settings_show_menu`, replace the rows table:

```c
    struct { const char *icon; const char *label; const char *sub;
             ui_settings_action_t act; } rows[4] = {
        { LV_SYMBOL_WIFI,     "Network & Wi-Fi", "Scan and connect",      UI_SET_WIFI },
        { LV_SYMBOL_SETTINGS, "Device settings", "Brightness, sleep",     UI_SET_DEVICE },
        { LV_SYMBOL_LIST,     "About",           "Device info",           UI_SET_ABOUT },
        { LV_SYMBOL_POWER,    "Restart device",  "Reboots in ~30s",       UI_SET_REBOOT },
    };
```

with:

```c
    // chevron: navigation rows get a › affordance; action rows (Restart) don't.
    struct { const char *icon; const char *label; const char *sub;
             ui_settings_action_t act; bool chevron; } rows[4] = {
        { LV_SYMBOL_WIFI,     "Network & Wi-Fi", "Scan and connect",      UI_SET_WIFI,   true  },
        { LV_SYMBOL_SETTINGS, "Device settings", "Brightness, sleep",     UI_SET_DEVICE, true  },
        { LV_SYMBOL_LIST,     "About",           "Device info",           UI_SET_ABOUT,  true  },
        { LV_SYMBOL_POWER,    "Restart device",  "Reboots in ~30s",       UI_SET_REBOOT, false },
    };
```

And replace the chevron creation:

```c
        // Right: chevron.
        lv_obj_t *chev = lv_label_create(btn);
        lv_label_set_text(chev, LV_SYMBOL_RIGHT);
        lv_obj_set_style_text_color(chev, p.muted, 0);
        lv_obj_align(chev, LV_ALIGN_RIGHT_MID, 0, 0);
```

with:

```c
        // Right: chevron (navigation rows only).
        if (rows[i].chevron) {
            lv_obj_t *chev = lv_label_create(btn);
            lv_label_set_text(chev, LV_SYMBOL_RIGHT);
            lv_obj_set_style_text_color(chev, p.muted, 0);
            lv_obj_align(chev, LV_ALIGN_RIGHT_MID, 0, 0);
        }
```

- [ ] **Step 2: Put a plain centered "Close" label on the exit button**

Replace the icon + flex-row block:

```c
    // Icon (default font) + "Close" (Open Sans) side by side, centered.
    lv_obj_t *exit_row = lv_obj_create(exit_btn);
    lv_obj_remove_style_all(exit_row);
    lv_obj_set_size(exit_row, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(exit_row, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(exit_row, LV_FLEX_ALIGN_CENTER,
                          LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(exit_row, 12, 0);
    lv_obj_clear_flag(exit_row, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    lv_obj_center(exit_row);

    lv_obj_t *exit_ic = lv_label_create(exit_row);
    lv_label_set_text(exit_ic, LV_SYMBOL_CLOSE);
    lv_obj_set_style_text_color(exit_ic, p.bg, 0);

    lv_obj_t *exit_lbl = lv_label_create(exit_row);
    lv_label_set_text(exit_lbl, "Close");
    lv_obj_set_style_text_font(exit_lbl, f_exit, LV_PART_MAIN);
    lv_obj_set_style_text_color(exit_lbl, p.bg, 0);
```

with:

```c
    // Plain centered "Close" (Open Sans) — no icon.
    lv_obj_t *exit_lbl = lv_label_create(exit_btn);
    lv_label_set_text(exit_lbl, "Close");
    lv_obj_set_style_text_font(exit_lbl, f_exit, LV_PART_MAIN);
    lv_obj_set_style_text_color(exit_lbl, p.bg, 0);
    lv_obj_center(exit_lbl);
```

- [ ] **Step 3: Build**

```bash
. ~/.espressif/v5.5/esp-idf/export.sh && cd /Users/eren/Projects/maratus-firmware && idf.py build
```

Expected: `Project build complete.`

- [ ] **Step 4: Commit**

```bash
git add components/ui/ui_settings.c
git commit -m "fix(settings): plain Close label, chevron only on navigation rows"
```

---

### Task 5: Root-cause and fix the reboot when exiting Wi-Fi setup via ✕

**REQUIRED SUB-SKILL: superpowers:systematic-debugging.** This task is an on-hardware investigation. Do NOT apply the candidate fix without first capturing the panic and confirming it matches; if the backtrace points elsewhere, fix what the evidence shows and note the deviation in the task report.

**Files:**
- Modify: `main/app_state.c` (`run_settings_flow` `UI_SET_WIFI` case — as left by Task 1)
- Modify: `components/ui/ui_wifi.c` (new `ui_wifi_destroy()`)
- Modify: `components/ui/include/ui.h` (declaration)

**Interfaces:**
- Consumes: Task 1's `UI_SET_WIFI` case (no more `build_settings_info`/`ui_settings_set_info` calls); existing `wifi_setup_run(bool allow_exit)`, `ui_settings_show_menu(lv_obj_t *)`, `s_wscreen` static in ui_wifi.c.
- Produces: `void ui_wifi_destroy(void)` — deletes the Wi-Fi setup screen; must only be called when it is not the active screen.

**Background / prime suspect (from the design spec):** there is no intentional `esp_restart()` on this path, so the reboot is a panic. Prime suspect: after `wifi_setup_run` returns, `ui_settings_show_menu(scr)` runs a fresh `font_cache_begin_pass()` (pins only the menu's fonts), which can LRU-evict the still-alive Wi-Fi screen's `lv_tiny_ttf` fonts from the 8-slot cache; the subsequent `lv_screen_load_anim(scr, MOVE_TOP, 220, …)` then renders the outgoing Wi-Fi screen for 220 ms with destroyed fonts → use-after-free → Guru Meditation → reboot.

- [ ] **Step 1: Flash the current branch and set up serial capture**

```bash
. ~/.espressif/v5.5/esp-idf/export.sh && cd /Users/eren/Projects/maratus-firmware
ls /dev/cu.usbmodem*          # identify the USB-to-UART port
idf.py -p /dev/cu.usbmodemXXXX flash
```

Do NOT use `idf.py monitor` (its DTR/RTS forces this board into download mode, and it needs an interactive TTY). Use the repo's raw reader, which holds the normal-boot straps:

```bash
python3 tools/serial-read.py /dev/cu.usbmodemXXXX 180 | tee "$CLAUDE_JOB_DIR/tmp/wifi-exit-panic.log"
```

- [ ] **Step 2: Reproduce**

While the reader runs, ask the user (device is on their desk) to: swipe up → (enter PIN if set) → tap **Network & Wi-Fi** → wait for the network list → tap the top-right **✕**.

Expected: the log captures a `Guru Meditation Error` / `panic` block with a RISC-V register dump and backtrace addresses, then the reboot banner.

- [ ] **Step 3: Decode the backtrace**

```bash
ELF=$(ls build/*.elf | head -1)
riscv32-esp-elf-addr2line -pfiaC -e "$ELF" <addr1> <addr2> ...
```

(Addresses from the `MEPC`/backtrace lines in the captured log.) Record the decoded frames in the task report.

- [ ] **Step 4: Confirm or refute the hypothesis**

- Frames in LVGL text/font drawing (`lv_draw_label`, `lv_tiny_ttf`/`lv_font_get_glyph…`) or `font_cache.c` during a screen animation ⇒ hypothesis CONFIRMED → apply Step 5 as written.
- Frames elsewhere (e.g. `lv_obj_delete` on `scr`/menu children, net/scan task, watchdog) ⇒ hypothesis REFUTED → per systematic-debugging, form the next hypothesis from the actual frames and fix the real root cause; only reuse the Step 5 code if it genuinely addresses it. Either way the acceptance criterion in Step 7 is unchanged.

- [ ] **Step 5: Candidate fix (apply if confirmed)**

The shape of the fix: after `wifi_setup_run` returns, rebuild the menu, swap screens **without an animation**, and delete the Wi-Fi screen — all under one continuous LVGL lock so the render task can never draw a screen whose fonts were just evicted.

First verify the esp_lvgl_port lock is recursive (the nested `lvgl_port_lock` calls below depend on it):

```bash
grep -rn "Recursive\|xSemaphoreCreateRecursiveMutex\|TakeRecursive" managed_components/espressif__esp_lvgl_port/src/ | head
```

If it is NOT recursive, restructure instead: add an unlocked internal `show_menu` variant — do not deadlock. If recursive, apply:

`components/ui/ui_wifi.c` — add after `ui_wifi_show()`:

```c
// Delete the Wi-Fi setup screen. Must NOT be called while it is still the
// active screen (deleting the active screen is illegal in LVGL) — the caller
// loads another screen first. Safe to call if the screen is already gone.
void ui_wifi_destroy(void) {
    lvgl_port_lock(0);
    if (s_wscreen && lv_screen_active() != s_wscreen) {
        lv_obj_delete(s_wscreen);
        s_wscreen = NULL;
    }
    lvgl_port_unlock();
}
```

`components/ui/include/ui.h` — next to `ui_wifi_show()`:

```c
// Delete the Wi-Fi setup screen once another screen is active. Call after
// wifi_setup_run() returns so its (possibly font-evicted) widgets can never
// be rendered again.
void ui_wifi_destroy(void);
```

`main/app_state.c` — replace the `UI_SET_WIFI` case (as left by Task 1):

```c
                case UI_SET_WIFI:
                    // wifi_setup_run() lv_screen_loads its own screen, replacing scr
                    // as the active screen (scr stays alive, hidden). After it returns
                    // (connected, or exited via the exit chip — allow_exit=true leaves
                    // the current connection untouched), rebuild the menu into scr and
                    // slide scr back up.
                    wifi_setup_run(true);
                    ui_settings_show_menu(scr);
                    lv_screen_load_anim(scr, LV_SCR_LOAD_ANIM_MOVE_TOP, 220, 0, false);
                    break;
```

with:

```c
                case UI_SET_WIFI:
                    // wifi_setup_run() lv_screen_loads its own screen, replacing scr
                    // as the active screen (scr stays alive, hidden). On return,
                    // rebuild the menu and swap back under ONE LVGL lock, with no
                    // animation: show_menu's font pass can evict the Wi-Fi screen's
                    // fonts from the 8-slot cache, so that screen must never be
                    // rendered again (an animated load draws it for 220 ms —
                    // use-after-free on a destroyed lv_tiny_ttf font → panic).
                    wifi_setup_run(true);
                    lvgl_port_lock(0);
                    ui_settings_show_menu(scr);
                    lv_screen_load(scr);
                    ui_wifi_destroy();
                    lvgl_port_unlock();
                    break;
```

- [ ] **Step 6: Build and re-flash**

```bash
idf.py build && idf.py -p /dev/cu.usbmodemXXXX flash
```

Expected: `Project build complete.`, flash verified.

- [ ] **Step 7: Verify on hardware**

Start `python3 tools/serial-read.py /dev/cu.usbmodemXXXX 240 | tee "$CLAUDE_JOB_DIR/tmp/wifi-exit-verify.log"` and ask the user to enter **Network & Wi-Fi** from Settings and exit via **✕** at least 3 times in a row.

Acceptance: every ✕ returns to the Settings menu; no panic/reboot banner in the log; Wi-Fi stays connected (About still shows the SSID and Online). Also re-check the first-boot path is untouched: `main/app_main.c` still calls `wifi_setup_run(false)` and nothing else changed there.

- [ ] **Step 8: Commit**

```bash
git add main/app_state.c components/ui/ui_wifi.c components/ui/include/ui.h
git commit -m "fix(settings): stop panic-reboot when exiting Wi-Fi setup via the exit chip"
```

(If Step 4 refuted the hypothesis, the commit message must describe the actual root cause instead.)

---

### Task 6: Full HIL verification pass

**Files:** none (verification only; final build already flashed in Task 5).

**Interfaces:**
- Consumes: all prior tasks' behavior.
- Produces: a pass/fail checklist recorded in the task report; branch ready for merge.

- [ ] **Step 1: Confirm the flashed build is the branch tip**

```bash
cd /Users/eren/Projects/maratus-firmware && git log --oneline -6 && git status -sb
```

Expected: the 5 commits from Tasks 1–5 on `feat/settings-cleanup`, clean tree. If Task 5 re-flashed before Task 5's commit only, re-run `idf.py build && idf.py -p <port> flash` so the device runs the tip.

- [ ] **Step 2: Walk the checklist with the user (device on desk)**

1. Swipe up → Settings menu: **no text in the top-right corner**; title "Settings" alone; no card overlaps anything.
2. Menu rows: Wi-Fi / Device settings / About show ›; **Restart device has no ›**.
3. Bottom button: **"Close" with no ✕ icon**; tapping it returns to the branding screen.
4. About: rows are Firmware, IP, MAC, Wi-Fi, Signal, Online — **no "Print listener"**; Online shows the green dot.
5. Device settings with "Use device settings" ON: tap each Sleep chip — **the tapped chip fills accent immediately**; leave a non-default (e.g. 2 min), exit to menu, re-enter → the same chip is still highlighted.
6. Brightness slider still live-previews while dragging and persists on release (regression).
7. Network & Wi-Fi → ✕ → returns to menu without reboot (re-confirmation of Task 5).
8. Restart device row still reboots the device (regression — do this last).

- [ ] **Step 3: Record results**

Note pass/fail per item in the task report. Any failure → fix under the corresponding task's scope before merge.

---

## Post-plan note for the executor

After all tasks pass, use **superpowers:finishing-a-development-branch** to merge `feat/settings-cleanup` into maratus-firmware `main` and push. Subagent git hazard: subagents share the working directory — verify `git -C /Users/eren/Projects/maratus-firmware branch --show-current` prints `feat/settings-cleanup` before and after every subagent run.
