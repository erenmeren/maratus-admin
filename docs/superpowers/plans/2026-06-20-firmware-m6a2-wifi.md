# M6a-2 On-screen Wi-Fi Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On first boot with no stored Wi-Fi credentials, the device shows an interactive Wi-Fi screen (scan → pick/typed SSID → on-screen-keyboard password → connect), persists creds to NVS, then flows into the existing M6a claim flow.

**Architecture:** `net` is split into `net_init` / `net_connect` / `net_scan` (auto-connect on STA_START gated behind an intent flag). A blocking `wifi_setup_run()` orchestrator drives a passive, bespoke `ui_wifi` LVGL screen (list + textarea + keyboard) via setter/consume-flag handoff (mirrors `ui_consume_tap`); network calls run off the UI thread. Pure scan-list/credential logic is host-tested in `wifi_util`.

**Tech Stack:** ESP-IDF 5.5 (C), esp_wifi (transparent esp_wifi_remote/C6), LVGL v9 (lv_list/lv_textarea/lv_keyboard/lv_spinner; GT911 touch), NVS. Host tests: `make -C tools/cfg-harness test`. Build: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`. Flash: `idf.py -p /dev/cu.usbmodem5A671704091 flash`. Repo: `/Users/eren/Projects/maratus-firmware`. Branch off `main`: `feat/m6a2-wifi`.

Spec: `docs/superpowers/specs/2026-06-20-firmware-m6a2-wifi-provisioning-design.md`. Builds on M6a (provisioning, shipped). Wi-Fi setup is **first-boot only** (shown only when no creds resolve).

---

### Task 0: Branch

- [ ] From `/Users/eren/Projects/maratus-firmware` on `main` (clean): `git checkout -b feat/m6a2-wifi`.

---

### Task 1: `wifi_util` pure module (host-tested)

Pure helpers: dedupe+sort scanned APs, and validate SSID/password. No ESP deps (operate on plain structs so the harness can compile them).

**Files:**
- Create: `components/devcfg/wifi_util.c`, `components/devcfg/include/wifi_util.h`
- Modify: `components/devcfg/CMakeLists.txt` (add source), `tools/cfg-harness/Makefile` (add source)
- Test: `tools/cfg-harness/test_cfg.c`

- [ ] **Step 1: Header**

Create `components/devcfg/include/wifi_util.h`:
```c
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

// Plain AP record (mirrors the fields we need from esp_wifi's wifi_ap_record_t,
// kept ESP-free so this is host-testable).
typedef struct {
    char    ssid[33];   // NUL-terminated
    int8_t  rssi;
    bool    open;       // true = no password (authmode OPEN)
} wifi_ap_t;

// In-place: drop empty SSIDs, dedupe by SSID keeping the strongest RSSI, sort
// descending by RSSI. Returns the new count.
int wifi_util_dedupe_sort(wifi_ap_t *aps, int n);

// SSID valid if non-empty and <= 32 bytes.
bool wifi_util_valid_ssid(const char *ssid);

// Password valid if: open network (any, ignored) OR length in [8, 63] (WPA2).
bool wifi_util_valid_password(bool open, const char *pass);
```

- [ ] **Step 2: Failing test**

In `tools/cfg-harness/test_cfg.c`: add `#include "wifi_util.h"`, the test below, and call `test_wifi_util();` from `main()`:
```c
static void test_wifi_util(void) {
    wifi_ap_t aps[5] = {
        { "CafeNet", -70, false },
        { "",        -40, true  },   // empty → dropped
        { "CafeNet", -55, false },   // dup, stronger → kept
        { "Open",    -80, true  },
        { "Far",     -90, false },
    };
    int n = wifi_util_dedupe_sort(aps, 5);
    assert(n == 3);
    assert(strcmp(aps[0].ssid, "CafeNet") == 0 && aps[0].rssi == -55); // strongest dup, sorted first
    assert(strcmp(aps[1].ssid, "Open") == 0);
    assert(strcmp(aps[2].ssid, "Far") == 0);

    assert(wifi_util_valid_ssid("x"));
    assert(!wifi_util_valid_ssid(""));
    assert(!wifi_util_valid_ssid("123456789012345678901234567890123")); // 33 chars

    assert(wifi_util_valid_password(true, ""));        // open: anything ok
    assert(wifi_util_valid_password(false, "12345678"));
    assert(!wifi_util_valid_password(false, "short"));  // < 8
    assert(!wifi_util_valid_password(false, ""));       // WPA2 needs >= 8
    printf("test_wifi_util OK\n");
}
```

- [ ] **Step 3: Run → FAIL** — `make -C tools/cfg-harness test` (wifi_util.h not found).

- [ ] **Step 4: Implement**

Create `components/devcfg/wifi_util.c`:
```c
#include "wifi_util.h"
#include <string.h>

bool wifi_util_valid_ssid(const char *ssid) {
    if (!ssid) return false;
    size_t n = strlen(ssid);
    return n >= 1 && n <= 32;
}

bool wifi_util_valid_password(bool open, const char *pass) {
    if (open) return true;
    if (!pass) return false;
    size_t n = strlen(pass);
    return n >= 8 && n <= 63;
}

int wifi_util_dedupe_sort(wifi_ap_t *aps, int n) {
    // 1) drop empty SSIDs (compact)
    int m = 0;
    for (int i = 0; i < n; i++) {
        if (aps[i].ssid[0] != '\0') aps[m++] = aps[i];
    }
    // 2) dedupe by SSID, keeping the strongest RSSI
    for (int i = 0; i < m; i++) {
        for (int j = i + 1; j < m; ) {
            if (strcmp(aps[i].ssid, aps[j].ssid) == 0) {
                if (aps[j].rssi > aps[i].rssi) aps[i] = aps[j];
                aps[j] = aps[--m];   // remove j by swapping in the last
            } else {
                j++;
            }
        }
    }
    // 3) sort descending by RSSI (insertion sort; small n)
    for (int i = 1; i < m; i++) {
        wifi_ap_t key = aps[i];
        int j = i - 1;
        while (j >= 0 && aps[j].rssi < key.rssi) { aps[j + 1] = aps[j]; j--; }
        aps[j + 1] = key;
    }
    return m;
}
```

- [ ] **Step 5: Wire build** — add `"wifi_util.c"` to `components/devcfg/CMakeLists.txt` SRCS; add `../../components/devcfg/wifi_util.c` to `tools/cfg-harness/Makefile` SRCS.

- [ ] **Step 6: Run → PASS** — `make -C tools/cfg-harness test` → `test_wifi_util OK`, `ALL TESTS PASSED`.

- [ ] **Step 7: Commit**
```bash
git add components/devcfg/wifi_util.c components/devcfg/include/wifi_util.h components/devcfg/CMakeLists.txt tools/cfg-harness/Makefile tools/cfg-harness/test_cfg.c
git commit -m "feat(firmware): wifi_util dedupe/sort + credential validation (host-tested)"
```

---

### Task 2: Split `net` into init / connect / scan

Today `net_start()` inits + connects with Kconfig creds, and `on_event` auto-connects on `STA_START`. Split so we can init without connecting, scan, then connect with chosen creds.

**Files:** Modify `components/net/net.c`, `components/net/include/net.h`.

- [ ] **Step 1: New header**

Replace `components/net/include/net.h` body with:
```c
#pragma once
#include <stdbool.h>
#include <stdint.h>

// Plain scan result (decoupled from esp_wifi headers for callers/UI).
typedef struct { char ssid[33]; int8_t rssi; bool open; } net_ap_t;

// Bring up the Wi-Fi stack in STA mode WITHOUT connecting. Call once at boot.
void net_init(void);

// Scan for APs (blocking, a few seconds). Fills out[] (cap max), returns count.
int net_scan(net_ap_t *out, int max);

// Connect with the given creds; blocks up to ~20s. Returns true if it got an IP.
bool net_connect(const char *ssid, const char *pass);

bool net_is_connected(void);
```

- [ ] **Step 2: Refactor `net.c`**

Edit `components/net/net.c`:
- Add `#include "wifi_util.h"` is NOT needed; instead include `"net.h"` (already). Keep esp includes.
- Add an intent flag so STA_START / DISCONNECTED only (re)connect when we want to:
```c
static volatile bool s_want_connect = false;
```
- Change `on_event`:
  - `STA_START`: **remove** the auto `esp_wifi_connect()` (do nothing / log).
  - `STA_DISCONNECTED`: `s_connected = false; if (s_want_connect) esp_wifi_connect();`
  - `GOT_IP`: unchanged.
- Replace `net_start()` with `net_init()` — everything up to and including `esp_wifi_set_mode(WIFI_MODE_STA)` + `esp_wifi_start()`, but **no** `wifi_config`/connect/wait:
```c
void net_init(void) {
    s_events = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL, NULL));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());
}
```
- Add `net_connect`:
```c
bool net_connect(const char *ssid, const char *pass) {
    wifi_config_t wc = { 0 };
    strncpy((char *)wc.sta.ssid, ssid ? ssid : "", sizeof(wc.sta.ssid) - 1);
    strncpy((char *)wc.sta.password, pass ? pass : "", sizeof(wc.sta.password) - 1);
    s_want_connect = true;
    s_connected = false;
    xEventGroupClearBits(s_events, GOT_IP_BIT);
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_LOGI(TAG, "connecting to SSID '%s'", ssid ? ssid : "");
    esp_wifi_connect();
    xEventGroupWaitBits(s_events, GOT_IP_BIT, pdFALSE, pdTRUE, pdMS_TO_TICKS(20000));
    return s_connected;
}
```
- Add `net_scan`:
```c
int net_scan(net_ap_t *out, int max) {
    if (esp_wifi_scan_start(NULL, true) != ESP_OK) return 0;  // NULL cfg = scan all, blocking
    uint16_t num = 0;
    esp_wifi_scan_get_ap_num(&num);
    if (num == 0) return 0;
    static wifi_ap_record_t recs[24];
    uint16_t want = num > 24 ? 24 : num;
    if (esp_wifi_scan_get_ap_records(&want, recs) != ESP_OK) return 0;
    int n = 0;
    for (int i = 0; i < want && n < max; i++) {
        strncpy(out[n].ssid, (char *)recs[i].ssid, sizeof(out[n].ssid) - 1);
        out[n].ssid[sizeof(out[n].ssid) - 1] = '\0';
        out[n].rssi = recs[i].rssi;
        out[n].open = (recs[i].authmode == WIFI_AUTH_OPEN);
        n++;
    }
    return n;
}
```
(Remove the old `net_start`. There is exactly one caller — `main/app_main.c` — updated in Task 5.)

- [ ] **Step 3: Build** — `idf.py build`. Expect a build error only at the `app_main.c` call site of the removed `net_start` (fixed in Task 5). To keep this task self-contained, temporarily update `app_main.c`'s `net_start();` to `net_init();` now (Task 5 rewires the full flow). Rebuild → clean.

- [ ] **Step 4: Commit**
```bash
git add components/net main/app_main.c
git commit -m "feat(firmware): split net into init/connect/scan, gate auto-connect"
```

---

### Task 3: Wi-Fi creds in NVS (appcfg)

**Files:** Modify `components/appcfg/appcfg.c`, `components/appcfg/include/appcfg.h`.

- [ ] **Step 1: Declarations** — add to `appcfg.h`:
```c
bool appcfg_has_wifi_creds(void);
void appcfg_store_wifi_creds(const char *ssid, const char *pass);
const char *appcfg_wifi_ssid(void);      // NVS → Kconfig fallback
const char *appcfg_wifi_password(void);  // NVS → Kconfig fallback
```

- [ ] **Step 2: Implement** in `appcfg.c` (reuse the existing static `nvs_read`/`nvs_write` + `MARATUS_NS`; add static buffers):
```c
static char s_wifi_ssid[33];
static char s_wifi_pass[64];

bool appcfg_has_wifi_creds(void) {
    char tmp[33];
    return nvs_read("wifi_ssid", tmp, sizeof(tmp));
}
void appcfg_store_wifi_creds(const char *ssid, const char *pass) {
    if (ssid && ssid[0]) nvs_write("wifi_ssid", ssid);
    nvs_write("wifi_pass", pass ? pass : "");
}
const char *appcfg_wifi_ssid(void) {
    if (nvs_read("wifi_ssid", s_wifi_ssid, sizeof(s_wifi_ssid))) return s_wifi_ssid;
    return CONFIG_MARATUS_WIFI_SSID;
}
const char *appcfg_wifi_password(void) {
    if (nvs_read("wifi_pass", s_wifi_pass, sizeof(s_wifi_pass))) return s_wifi_pass;
    return CONFIG_MARATUS_WIFI_PASSWORD;
}
```
(Note: `nvs_read` returns false for an empty stored value, so an open network's empty password falls through to the Kconfig default on read. That's acceptable — open networks connect with an empty password regardless; `net_connect` is called with the live entered value during setup, and on reboot `appcfg_has_wifi_creds()` keys off the SSID. If exact empty-password round-trip matters later, store a sentinel; YAGNI now.)

- [ ] **Step 3: Build** — `idf.py build` clean.

- [ ] **Step 4: Commit**
```bash
git add components/appcfg
git commit -m "feat(firmware): NVS-backed Wi-Fi credentials (appcfg)"
```

---

### Task 4: `ui_wifi` interactive screen (passive)

A bespoke LVGL screen (not config-driven) with a scan list, a text field + keyboard, status, and Scan/Connect/"Other network…" controls. It is **passive**: the orchestrator pushes data in and reads user intent out via consume-flags (mirrors `ui_consume_tap`).

**Files:** Create `components/ui/ui_wifi.c`; modify `components/ui/include/ui.h`, `components/ui/CMakeLists.txt` (add source).

- [ ] **Step 1: Public API** — add to `ui.h`:
```c
#include "net.h"   // net_ap_t

// Show the bespoke Wi-Fi setup screen (call once, under no lock — it locks internally).
void ui_wifi_show(void);
// Push scan results into the list (replaces current list).
void ui_wifi_set_results(const net_ap_t *aps, int n);
// Set the status line (e.g. "Scanning…", "Connecting…", "Couldn't connect").
void ui_wifi_set_status(const char *text);
// Consume a list selection: returns true and fills *idx with the tapped row, or
// sets *manual=true if "Other network…" was tapped. False if nothing pending.
bool ui_wifi_consume_selection(int *idx, bool *manual);
// Consume a Connect press: returns true and fills ssid/pass (the current text-field
// values: for a manual SSID, ssid holds the typed SSID). False if nothing pending.
bool ui_wifi_consume_connect(char *ssid, int ssid_cap, char *pass, int pass_cap);
// Consume a Rescan press.
bool ui_wifi_consume_rescan(void);
// Switch the text field to SSID entry (manual) or password entry; sets the label.
void ui_wifi_prompt_ssid(void);
void ui_wifi_prompt_password(const char *ssid);  // shows "Password for <ssid>"
```

- [ ] **Step 2: Implement `ui_wifi.c`** (model on `build_splash` for screen creation and on `ui_set_qr_url`/`ui_consume_tap` for the lock + flag pattern). Layout on 720×720: status label (top), scrollable `lv_list` of SSIDs (upper half) with a final "Other network…" item + a "Rescan" button, an `lv_textarea` (one line, password mode toggled), an `lv_keyboard` bound to the textarea (lower half), and a "Connect" button. Skeleton:
```c
#include "ui.h"
#include <string.h>
#include "lvgl.h"
#include "esp_lvgl_port.h"

static lv_obj_t  *s_wscreen, *s_status, *s_list, *s_ta, *s_kb;
static volatile bool s_sel_pending, s_sel_manual, s_connect_pending, s_rescan_pending;
static volatile int  s_sel_idx;
static char s_typed_ssid[33];           // set when prompting password for a list pick
static bool s_manual_mode;              // text field currently holds an SSID (manual)

static void list_cb(lv_event_t *e) {
    int idx = (int)(intptr_t)lv_event_get_user_data(e);
    s_sel_idx = idx; s_sel_manual = (idx < 0); s_sel_pending = true;
}
static void connect_cb(lv_event_t *e) { (void)e; s_connect_pending = true; }
static void rescan_cb(lv_event_t *e)  { (void)e; s_rescan_pending = true; }

void ui_wifi_show(void) {
    lvgl_port_lock(0);
    s_wscreen = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(s_wscreen, lv_color_hex(0x0B5D3B), LV_PART_MAIN);
    s_status = lv_label_create(s_wscreen);
    lv_label_set_text(s_status, "Wi-Fi setup");
    lv_obj_set_style_text_color(s_status, lv_color_white(), LV_PART_MAIN);
    lv_obj_align(s_status, LV_ALIGN_TOP_MID, 0, 12);
    s_list = lv_list_create(s_wscreen);
    lv_obj_set_size(s_list, 680, 300);
    lv_obj_align(s_list, LV_ALIGN_TOP_MID, 0, 48);
    s_ta = lv_textarea_create(s_wscreen);
    lv_textarea_set_one_line(s_ta, true);
    lv_obj_set_width(s_ta, 680);
    lv_obj_align(s_ta, LV_ALIGN_TOP_MID, 0, 356);
    s_kb = lv_keyboard_create(s_wscreen);
    lv_keyboard_set_textarea(s_kb, s_ta);   // keyboard edits the textarea
    lv_obj_set_size(s_kb, 720, 280);
    lv_obj_align(s_kb, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_t *btn = lv_button_create(s_wscreen);   // Connect
    lv_obj_align(btn, LV_ALIGN_TOP_RIGHT, -16, 352);
    lv_obj_add_event_cb(btn, connect_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t *bl = lv_label_create(btn); lv_label_set_text(bl, "Connect");
    lv_screen_load(s_wscreen);
    lvgl_port_unlock();
}

void ui_wifi_set_results(const net_ap_t *aps, int n) {
    lvgl_port_lock(0);
    lv_obj_clean(s_list);
    for (int i = 0; i < n; i++) {
        lv_obj_t *it = lv_list_add_button(s_list, aps[i].open ? LV_SYMBOL_WIFI : LV_SYMBOL_WIFI, aps[i].ssid);
        lv_obj_add_event_cb(it, list_cb, LV_EVENT_CLICKED, (void *)(intptr_t)i);
    }
    lv_obj_t *other = lv_list_add_button(s_list, LV_SYMBOL_PLUS, "Other network…");
    lv_obj_add_event_cb(other, list_cb, LV_EVENT_CLICKED, (void *)(intptr_t)-1);
    lv_obj_t *re = lv_list_add_button(s_list, LV_SYMBOL_REFRESH, "Rescan");
    lv_obj_add_event_cb(re, rescan_cb, LV_EVENT_CLICKED, NULL);
    lvgl_port_unlock();
}

void ui_wifi_set_status(const char *t) {
    lvgl_port_lock(0); lv_label_set_text(s_status, t ? t : ""); lvgl_port_unlock();
}
void ui_wifi_prompt_ssid(void) {
    lvgl_port_lock(0);
    s_manual_mode = true; lv_textarea_set_password_mode(s_ta, false);
    lv_textarea_set_text(s_ta, ""); lv_textarea_set_placeholder_text(s_ta, "Network name");
    lvgl_port_unlock();
}
void ui_wifi_prompt_password(const char *ssid) {
    lvgl_port_lock(0);
    s_manual_mode = false;
    strncpy(s_typed_ssid, ssid ? ssid : "", sizeof(s_typed_ssid) - 1);
    lv_textarea_set_password_mode(s_ta, true);
    lv_textarea_set_text(s_ta, ""); lv_textarea_set_placeholder_text(s_ta, "Password");
    lvgl_port_unlock();
}

bool ui_wifi_consume_selection(int *idx, bool *manual) {
    if (!s_sel_pending) return false;
    s_sel_pending = false; *idx = s_sel_idx; *manual = s_sel_manual; return true;
}
bool ui_wifi_consume_rescan(void) { bool r = s_rescan_pending; s_rescan_pending = false; return r; }
bool ui_wifi_consume_connect(char *ssid, int sc, char *pass, int pc) {
    if (!s_connect_pending) return false;
    s_connect_pending = false;
    lvgl_port_lock(0);
    const char *txt = lv_textarea_get_text(s_ta);
    if (s_manual_mode) { strncpy(ssid, txt, sc - 1); ssid[sc-1]='\0'; pass[0]='\0'; }
    else { strncpy(ssid, s_typed_ssid, sc - 1); ssid[sc-1]='\0'; strncpy(pass, txt, pc - 1); pass[pc-1]='\0'; }
    lvgl_port_unlock();
    return true;
}
```
(Adapt LVGL v9 symbol/function names to what compiles — e.g. `lv_list_add_button` vs `lv_list_add_btn`, `lv_button_create` vs `lv_btn_create`. Check an existing widget call in `ui.c` and the LVGL headers; use the names that match this LVGL version.)

- [ ] **Step 3: Build** — `idf.py build` clean (ui component now compiles `ui_wifi.c`).

- [ ] **Step 4: Commit**
```bash
git add components/ui
git commit -m "feat(firmware): ui_wifi interactive setup screen (passive, consume-flags)"
```

---

### Task 5: `wifi_setup_run` orchestrator + boot integration

A blocking controller (runs in app_main's context; LVGL runs on its own port task) that drives scan → select → password → connect → persist. Then app_main's boot flow uses NVS-or-Kconfig creds, falling back to this only when no creds resolve.

**Files:** Create `main/wifi_setup.c`, `main/wifi_setup.h`; modify `main/app_main.c`, `main/CMakeLists.txt` (add `wifi_setup.c`).

- [ ] **Step 1: `wifi_setup.h`**
```c
#pragma once
// Block until the user picks a network and connects; persists creds to NVS.
void wifi_setup_run(void);
```

- [ ] **Step 2: `wifi_setup.c`**
```c
#include "wifi_setup.h"
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "net.h"
#include "ui.h"
#include "appcfg.h"
#include "wifi_util.h"

static const char *TAG = "wifi-setup";
#define MAX_APS 24

void wifi_setup_run(void) {
    static net_ap_t aps[MAX_APS];          // static: large, avoid stack
    wifi_ap_t uaps[MAX_APS];               // pure-util view for dedupe/sort
    int n = 0;
    char ssid[33] = {0}, pass[64] = {0};
    bool open = false;
    enum { SCAN, LIST, PASSWORD, CONNECT } st = SCAN;

    ui_wifi_show();
    for (;;) {
        if (st == SCAN) {
            ui_wifi_set_status("Scanning…");
            n = net_scan(aps, MAX_APS);
            for (int i = 0; i < n; i++) { strncpy(uaps[i].ssid, aps[i].ssid, 33); uaps[i].rssi = aps[i].rssi; uaps[i].open = aps[i].open; }
            n = wifi_util_dedupe_sort(uaps, n);
            for (int i = 0; i < n; i++) { strncpy(aps[i].ssid, uaps[i].ssid, 33); aps[i].rssi = uaps[i].rssi; aps[i].open = uaps[i].open; }
            ui_wifi_set_results(aps, n);
            ui_wifi_set_status(n ? "Choose your Wi-Fi" : "No networks — tap Rescan");
            st = LIST;
        } else if (st == LIST) {
            int idx; bool manual;
            if (ui_wifi_consume_rescan()) { st = SCAN; }
            else if (ui_wifi_consume_selection(&idx, &manual)) {
                if (manual) { open = false; strcpy(ssid, ""); ui_wifi_prompt_ssid(); st = PASSWORD; }
                else if (idx >= 0 && idx < n) {
                    strncpy(ssid, aps[idx].ssid, sizeof(ssid)-1); open = aps[idx].open;
                    if (open) { pass[0] = '\0'; st = CONNECT; }
                    else { ui_wifi_prompt_password(ssid); st = PASSWORD; }
                }
            }
        } else if (st == PASSWORD) {
            char es[33], ep[64];
            if (ui_wifi_consume_connect(es, sizeof(es), ep, sizeof(ep))) {
                // manual mode: es is the typed SSID, ep empty → if user needs a password
                // for a manual network, they'd re-enter; v1 manual treats the field as SSID
                // then immediately attempts (open) — for secured hidden nets, prompt password next.
                if (ssid[0] == '\0') {  // came from manual SSID entry
                    strncpy(ssid, es, sizeof(ssid)-1);
                    if (!wifi_util_valid_ssid(ssid)) { ui_wifi_set_status("Enter a network name"); }
                    else { open = false; ui_wifi_prompt_password(ssid); /* now ask password */ }
                } else {
                    strncpy(pass, ep, sizeof(pass)-1);
                    if (!wifi_util_valid_password(open, pass)) { ui_wifi_set_status("Password must be 8+ characters"); }
                    else st = CONNECT;
                }
            }
        } else if (st == CONNECT) {
            ui_wifi_set_status("Connecting…");
            if (net_connect(ssid, pass)) {
                appcfg_store_wifi_creds(ssid, pass);
                ESP_LOGI(TAG, "connected + stored creds for '%s'", ssid);
                return;
            }
            ui_wifi_set_status("Couldn't connect — check the password");
            ui_wifi_prompt_password(ssid);
            st = PASSWORD;
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}
```
(Note the manual-SSID path: first Connect press captures the SSID, then re-prompts for a password; the second Connect press connects. Keep it simple; refine wording during HIL.)

- [ ] **Step 3: Boot integration** — in `main/app_main.c`, replace the single `net_start();` (now `net_init();` from Task 2) region so the flow is: `net_init()` → resolve creds → connect-or-setup. Read the current lines ~105–110 and replace with:
```c
    // 3) Wi-Fi: connect with stored/Kconfig creds, else run on-screen setup (first boot).
    net_init();
    if (appcfg_has_wifi_creds() ||
        (appcfg_wifi_ssid()[0] && strcmp(appcfg_wifi_ssid(), "changeme") != 0)) {
        net_connect(appcfg_wifi_ssid(), appcfg_wifi_password());   // may retry in bg if it drops
    } else {
        wifi_setup_run();   // blocks until connected + creds persisted
    }
    ESP_LOGI(TAG, "Wi-Fi connected=%d", net_is_connected());
```
Add `#include "wifi_setup.h"` and `#include "appcfg.h"` (appcfg already included for M6a) and `#include <string.h>` to app_main.c if missing. Add `wifi_setup.c` to `main/CMakeLists.txt` SRCS, and ensure `main` REQUIRES include `net`, `ui`, `appcfg`, `devcfg` (they're already there for M6a — confirm `devcfg` for wifi_util).

- [ ] **Step 4: Build** — `idf.py build` clean.

- [ ] **Step 5: Commit**
```bash
git add main
git commit -m "feat(firmware): wifi_setup orchestrator + first-boot boot integration"
```

---

### Task 6: Host tests + build + HIL

- [ ] **Step 1:** `make -C tools/cfg-harness test` → ALL TESTS PASSED (incl. `test_wifi_util`).
- [ ] **Step 2:** `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build` → clean.
- [ ] **Step 3:** Force first-boot: `idf.py -p /dev/cu.usbmodem5A671704091 erase-flash` then `flash` (erase wipes stored Wi-Fi creds + device key).
- [ ] **Step 4: HIL (needs user + board; cloud reachable for the subsequent claim):**
  - Device boots to the **Wi-Fi setup screen**; scan lists nearby APs (strongest first, deduped).
  - Tap `test_EXT` → on-screen keyboard → type password → Connect → "Connecting…" → connects.
  - Device proceeds to the **M6a pairing-code screen** (Wi-Fi creds now in NVS) → claim → online.
  - Power-cycle → boots straight through (no Wi-Fi screen; creds + key persisted).
  - Exercise: an **open** network (no password step); a **wrong password** (error + retry); **"Other network…"** manual SSID.
- [ ] **Step 5:** Add a BUILD.md M6a-2 validation-log entry; merge to firmware `main`.

---

## Self-Review

**Spec coverage:**
- First-boot-only trigger (creds resolve NVS→Kconfig→setup) → Task 3 + Task 5 boot logic. ✓
- Split net (init/connect/scan), gate auto-connect → Task 2. ✓
- NVS creds accessors → Task 3. ✓
- Interactive passive ui_wifi (list+textarea+keyboard, consume-flags) → Task 4. ✓
- Controller state machine (scan→list→password→connect→persist/retry) → Task 5. ✓
- Pure dedupe/sort + validation, host-tested → Task 1. ✓
- Network types: open (skip password), WPA2 (password), manual SSID → Tasks 4–5. ✓
- Error handling (no APs/rescan, wrong password/retry, open) → Task 5. ✓
- Testing: host (Task 1/6), build, HIL → Task 6. ✓

**Placeholder scan:** complete code for the pure/appcfg/net parts; LVGL widget names flagged with an explicit "use the names that compile in this LVGL version" instruction (Task 4) — not a placeholder but a real adaptation note, since lv_button/lv_btn naming varies by build.

**Type/name consistency:** `net_ap_t {ssid,rssi,open}` (net.h) ↔ `wifi_ap_t` (wifi_util.h) bridged explicitly in Task 5. `ui_wifi_*` API names consistent between ui.h (Task 4) and the orchestrator (Task 5). `appcfg_wifi_*` consistent between Task 3 and Task 5. NVS keys `wifi_ssid`/`wifi_pass` consistent.

**Risk note (flag for HIL):** the manual-SSID two-step (SSID then password) in Task 5 is the fiddliest UX — verify/adjust wording on hardware. Also confirm `esp_wifi_scan_*` works through esp_wifi_remote on this C6/SDIO build during Task 2 (the scan API is present per the headers; first real check is the HIL scan list).
