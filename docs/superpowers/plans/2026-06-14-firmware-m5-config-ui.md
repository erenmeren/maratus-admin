# Firmware M5 — Config-Driven Idle Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the device's idle screen from the merchant's `PrinterConfig` fetched from the cloud — brand background color + positioned text objects (store name, tagline) — so editing branding in the admin console changes what the device shows, promptly (via the `config-changed` command) and persistently (cached in NVS across reboots).

**Architecture:** A header-only `devcfg` component defines the parsed config struct (shared by `cloud` and `ui` without a dependency cycle). `cloud` gains `cloud_get_config()` — `GET /api/device/config` with the stored ETag (`If-None-Match` → 304 fast path), parsing brand colors + the idle screen's text objects via cJSON, and NVS persistence (raw JSON + ETag). `ui` gains `ui_render_idle(cfg)` that rebuilds the idle screen from the struct. The boot path loads the cached config, renders, then fetches; the `config-changed` command (already delivered in M2) triggers a re-fetch + re-render.

**Tech Stack:** ESP-IDF, cJSON, NVS, LVGL v9, the M1 `GET /api/device/config` contract (returns `{version, brandBg/Fg/Muted/Color, logoUrl, config:{screens:{idle:{objects}}}}`; `version` is the ETag hex). Reuses M2 poll/commands.

**Config object model (from `maratus-admin/lib/printer-layout.ts`):** each `PrinterObject` = `{id, type, x, y, w, h, visible, z, text?, fontSize?, align?}` where `x/y/w/h` are fractions 0..1 on a **720px reference** and `fontSize` is px on that reference (device LCD is 720×720, so 1:1).

**Scope (M5):** fetch + cache (ETag/NVS) + `config-changed` re-pull; idle screen = brand **background** color + **text** objects (position, font size→nearest bundled font, alignment, brand foreground color). **Deferred to M5b:** logo/uploaded-icon images (need HTTP image fetch + PNG decode), live **clock** (SNTP + IANA→POSIX timezone), wifi/qr/spinner/countdown/pairingCode/steps widgets, and the non-idle screens (processing/qr/sent/error/paused/setup stay as their current M3/M4 renders).

---

### Task 1: `devcfg` shared config struct (header-only)

**Files:**
- Create: `components/devcfg/include/device_config.h`
- Create: `components/devcfg/CMakeLists.txt`

- [ ] **Step 1: Config struct**

`components/devcfg/include/device_config.h`:
```c
#pragma once
#include <stdbool.h>
#include <stdint.h>

#define CFG_MAX_TEXTS 32
#define CFG_TEXT_LEN  80   // matches MAX_TEXT_LEN in maratus-admin printer-layout

typedef struct {
    bool  visible;
    float x, y;          // top-left, fraction 0..1 on the 720 reference
    char  text[CFG_TEXT_LEN];
    int   font_size;     // px on the 720 reference
    int   align;         // 0 left, 1 center, 2 right
} cfg_text_t;

typedef struct {
    bool     valid;            // false until a config has been parsed
    char     etag[48];         // payload "version" hex (used as If-None-Match)
    uint32_t brand_bg;         // 0xRRGGBB
    uint32_t brand_fg;         // 0xRRGGBB (default text color)
    cfg_text_t texts[CFG_MAX_TEXTS];
    int      n_texts;          // text objects on the idle screen
} device_config_t;
```

- [ ] **Step 2: Header-only component**

`components/devcfg/CMakeLists.txt`:
```cmake
idf_component_register(INCLUDE_DIRS "include")
```

- [ ] **Step 3: Build + commit**

```bash
cd /Users/eren/Projects/maratus-firmware && idf.py build
git add components/devcfg
git commit -m "feat(firmware): shared device-config struct (devcfg)"
```
Expected: clean build.

---

### Task 2: Parse + fetch config in `cloud`

**Files:**
- Modify: `components/cloud/include/cloud.h`
- Modify: `components/cloud/cloud.c`
- Modify: `components/cloud/CMakeLists.txt`

- [ ] **Step 1: Interface**

Add to `components/cloud/include/cloud.h` (add `#include "device_config.h"` at the top):
```c
// GET /api/device/config with the stored ETag (cfg->etag) as If-None-Match.
//  - 200: parses brand colors + idle text objects into *cfg (cfg->valid = true,
//         cfg->etag updated) and persists raw JSON + ETag to NVS. Returns 200.
//  - 304: leaves *cfg unchanged. Returns 304.
//  - else: returns the HTTP status or -1.
int cloud_get_config(device_config_t *cfg);

// Load the last config persisted in NVS into *cfg (cfg->valid = false if none).
void cloud_config_load_cached(device_config_t *cfg);
```

- [ ] **Step 2: JSON parse + NVS helpers + fetch**

Add to `components/cloud/cloud.c` (includes: add `#include "nvs.h"`, `#include "device_config.h"`; `cJSON` + `esp_http_client` already present):
```c
static uint32_t parse_hex_color(const char *s, uint32_t dflt)
{
    if (!s) return dflt;
    if (*s == '#') s++;
    uint32_t v = 0; int n = 0;
    for (; *s && n < 6; s++, n++) {
        char c = *s; int d;
        if (c >= '0' && c <= '9') d = c - '0';
        else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
        else if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
        else return dflt;
        v = (v << 4) | d;
    }
    return n == 6 ? v : dflt;
}

static int align_of(const char *s)
{
    if (s && !strcmp(s, "center")) return 1;
    if (s && !strcmp(s, "right")) return 2;
    return 0;
}

// Parse the device-config JSON body into *cfg. Returns true on success.
static bool cfg_parse_json(const char *json, device_config_t *cfg)
{
    cJSON *root = cJSON_Parse(json);
    if (!root) return false;

    const char *ver = cJSON_GetStringValue(cJSON_GetObjectItem(root, "version"));
    cfg->etag[0] = '\0';
    if (ver) { strncpy(cfg->etag, ver, sizeof(cfg->etag) - 1); cfg->etag[sizeof(cfg->etag) - 1] = '\0'; }
    cfg->brand_bg = parse_hex_color(cJSON_GetStringValue(cJSON_GetObjectItem(root, "brandBg")), 0x10A765);
    cfg->brand_fg = parse_hex_color(cJSON_GetStringValue(cJSON_GetObjectItem(root, "brandFg")), 0xFFFFFF);
    cfg->n_texts = 0;

    cJSON *config = cJSON_GetObjectItem(root, "config");
    cJSON *screens = config ? cJSON_GetObjectItem(config, "screens") : NULL;
    cJSON *idle = screens ? cJSON_GetObjectItem(screens, "idle") : NULL;
    cJSON *objs = idle ? cJSON_GetObjectItem(idle, "objects") : NULL;
    int n = cJSON_IsArray(objs) ? cJSON_GetArraySize(objs) : 0;
    for (int i = 0; i < n && cfg->n_texts < CFG_MAX_TEXTS; i++) {
        cJSON *o = cJSON_GetArrayItem(objs, i);
        const char *type = cJSON_GetStringValue(cJSON_GetObjectItem(o, "type"));
        cJSON *vis = cJSON_GetObjectItem(o, "visible");
        if (!type || strcmp(type, "text") != 0) continue;          // M5: text objects only
        if (cJSON_IsBool(vis) && !cJSON_IsTrue(vis)) continue;     // skip hidden
        const char *txt = cJSON_GetStringValue(cJSON_GetObjectItem(o, "text"));
        if (!txt) continue;
        cfg_text_t *t = &cfg->texts[cfg->n_texts++];
        t->visible = true;
        t->x = (float)cJSON_GetNumberValue(cJSON_GetObjectItem(o, "x"));
        t->y = (float)cJSON_GetNumberValue(cJSON_GetObjectItem(o, "y"));
        strncpy(t->text, txt, CFG_TEXT_LEN - 1); t->text[CFG_TEXT_LEN - 1] = '\0';
        cJSON *fs = cJSON_GetObjectItem(o, "fontSize");
        t->font_size = cJSON_IsNumber(fs) ? (int)cJSON_GetNumberValue(fs) : 28;
        t->align = align_of(cJSON_GetStringValue(cJSON_GetObjectItem(o, "align")));
    }

    cfg->valid = true;
    cJSON_Delete(root);
    return true;
}

#define CFG_NVS_NS "ditto"

static void cfg_save_nvs(const char *json)
{
    nvs_handle_t h;
    if (nvs_open(CFG_NVS_NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_str(h, "cfg_json", json);
    nvs_commit(h);
    nvs_close(h);
}

void cloud_config_load_cached(device_config_t *cfg)
{
    cfg->valid = false;
    nvs_handle_t h;
    if (nvs_open(CFG_NVS_NS, NVS_READONLY, &h) != ESP_OK) return;
    size_t len = 0;
    if (nvs_get_str(h, "cfg_json", NULL, &len) == ESP_OK && len > 0 && len < 16384) {
        char *buf = malloc(len);
        if (buf && nvs_get_str(h, "cfg_json", buf, &len) == ESP_OK) cfg_parse_json(buf, cfg);
        free(buf);
    }
    nvs_close(h);
}

int cloud_get_config(device_config_t *cfg)
{
    char url[256];
    snprintf(url, sizeof(url), "%s/api/device/config", appcfg_base_url());
    char auth[96];
    snprintf(auth, sizeof(auth), "Bearer %s", appcfg_device_key());
    char inm[64] = {0};
    if (cfg->etag[0]) snprintf(inm, sizeof(inm), "\"%s\"", cfg->etag);

    static char body[16384];
    body[0] = '\0';
    resp_t resp = { .buf = body, .cap = sizeof(body), .len = 0 };

    esp_http_client_config_t hc = {
        .url = url, .method = HTTP_METHOD_GET,
        .event_handler = on_evt, .user_data = &resp,
        .crt_bundle_attach = esp_crt_bundle_attach, .timeout_ms = 10000,
    };
    esp_http_client_handle_t c = esp_http_client_init(&hc);
    esp_http_client_set_header(c, "Authorization", auth);
    if (inm[0]) esp_http_client_set_header(c, "If-None-Match", inm);

    int status = -1;
    if (esp_http_client_perform(c) == ESP_OK) {
        status = esp_http_client_get_status_code(c);
        body[resp.len] = '\0';
        if (status == 200) {
            if (cfg_parse_json(body, cfg)) { cfg_save_nvs(body); ESP_LOGI(TAG, "config updated (%d texts)", cfg->n_texts); }
            else ESP_LOGW(TAG, "config parse failed");
        } else if (status == 304) {
            ESP_LOGI(TAG, "config not modified");
        }
    } else {
        ESP_LOGE(TAG, "GET /config failed");
    }
    esp_http_client_cleanup(c);
    return status;
}
```
(Add `#include <stdlib.h>` if not already present — it is, from M3.)

- [ ] **Step 3: CMake REQUIRES**

`components/cloud/CMakeLists.txt` — add `nvs_flash` and `devcfg`:
```cmake
idf_component_register(SRCS "cloud.c" "commands.c"
                       INCLUDE_DIRS "include"
                       REQUIRES esp_http_client esp-tls appcfg json ui esp_system nvs_flash devcfg)
```

- [ ] **Step 4: Build + commit**

```bash
idf.py build
git add components/cloud
git commit -m "feat(firmware): fetch + parse + cache device config"
```
Expected: clean build. (NVS must be initialized — Step in Task 5 ensures `nvs_flash_init` runs at boot.)

---

### Task 3: Enable more LVGL font sizes

**Files:**
- Modify: `sdkconfig.defaults`

- [ ] **Step 1: Add intermediate Montserrat sizes**

Append to `sdkconfig.defaults` (for finer `fontSize`→font mapping; 14/28/48 already enabled):
```
CONFIG_LV_FONT_MONTSERRAT_16=y
CONFIG_LV_FONT_MONTSERRAT_20=y
CONFIG_LV_FONT_MONTSERRAT_36=y
```

- [ ] **Step 2: Build + commit**

```bash
idf.py build
git add sdkconfig.defaults
git commit -m "feat(firmware): enable extra LVGL font sizes for config text"
```
Expected: clean build.

---

### Task 4: Render the idle screen from config

**Files:**
- Modify: `components/ui/include/ui.h`
- Modify: `components/ui/ui.c`
- Modify: `components/ui/CMakeLists.txt`

- [ ] **Step 1: Interface**

Add to `components/ui/include/ui.h` (add `#include "device_config.h"` at top):
```c
// Rebuild the idle screen from a fetched config (brand background + text objects).
// If cfg is NULL or invalid, the idle screen keeps the built-in default. Thread-safe.
void ui_render_idle(const device_config_t *cfg);
```

- [ ] **Step 2: Font picker + config render in `ui.c`**

Add `#include "device_config.h"` to `ui.c`. Add a font picker + the render function (after `make_idle_screen`):
```c
static const lv_font_t *font_for(int px)
{
    if (px <= 15) return &lv_font_montserrat_14;
    if (px <= 18) return &lv_font_montserrat_16;
    if (px <= 24) return &lv_font_montserrat_20;
    if (px <= 32) return &lv_font_montserrat_28;
    if (px <= 42) return &lv_font_montserrat_36;
    return &lv_font_montserrat_48;
}

void ui_render_idle(const device_config_t *cfg)
{
    if (!cfg || !cfg->valid) return;
    lvgl_port_lock(0);

    // Rebuild a fresh idle screen so repeated calls don't leak old children.
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(scr, lv_color_hex(cfg->brand_bg), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, LV_PART_MAIN);

    for (int i = 0; i < cfg->n_texts; i++) {
        const cfg_text_t *t = &cfg->texts[i];
        lv_obj_t *lbl = lv_label_create(scr);
        lv_label_set_text(lbl, t->text);
        lv_obj_set_style_text_color(lbl, lv_color_hex(cfg->brand_fg), LV_PART_MAIN);
        lv_obj_set_style_text_font(lbl, font_for(t->font_size), LV_PART_MAIN);
        int px = (int)(t->x * 720.0f);
        int py = (int)(t->y * 720.0f);
        lv_obj_set_pos(lbl, px, py);   // top-left anchor (720x720 reference)
    }

    // Status dot, top-right (re-created on the new screen).
    s_status_dot = lv_obj_create(scr);
    lv_obj_set_size(s_status_dot, 20, 20);
    lv_obj_set_style_radius(s_status_dot, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_set_style_border_width(s_status_dot, 0, LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_status_dot, lv_color_hex(MARATUS_ONLINE), LV_PART_MAIN);
    lv_obj_align(s_status_dot, LV_ALIGN_TOP_RIGHT, -16, 16);

    lv_obj_t *old = s_idle_screen;
    s_idle_screen = scr;
    if (lv_screen_active() == old) lv_screen_load(scr);
    if (old) lv_obj_delete(old);

    lvgl_port_unlock();
}
```
(`s_idle_screen` and `s_status_dot` are the existing file statics; `MARATUS_ONLINE` is the existing brand-green define.)

- [ ] **Step 3: CMake REQUIRES**

`components/ui/CMakeLists.txt` — add `devcfg`:
```cmake
idf_component_register(SRCS "ui.c"
                       INCLUDE_DIRS "include"
                       REQUIRES lvgl esp_lvgl_port devcfg)
```

- [ ] **Step 4: Build + commit**

```bash
idf.py build
git add components/ui
git commit -m "feat(firmware): render idle screen from device config"
```
Expected: clean build.

---

### Task 5: Wire config load/fetch/re-pull into the app

**Files:**
- Modify: `main/app_main.c`
- Modify: `main/app_state.c`
- Modify: `components/cloud/commands.c`

- [ ] **Step 1: Ensure NVS is initialized + load cached config at boot**

In `main/app_main.c`, add includes:
```c
#include "nvs_flash.h"
#include "cloud.h"
#include "device_config.h"
```
At the very start of `app_main` (before `bsp_display_start`), init NVS:
```c
    esp_err_t nvs_err = nvs_flash_init();
    if (nvs_err == ESP_ERR_NVS_NO_FREE_PAGES || nvs_err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase(); nvs_flash_init();
    }
```
After `ui_init(); ui_show(UI_SCREEN_IDLE);`, render any cached config:
```c
    static device_config_t g_cfg;
    cloud_config_load_cached(&g_cfg);
    if (g_cfg.valid) ui_render_idle(&g_cfg);
```
And add `nvs_flash` to `main/CMakeLists.txt` REQUIRES (alongside the existing list):
```cmake
idf_component_register(SRCS "app_main.c" "app_state.c" "render_job.c"
                       INCLUDE_DIRS "."
                       REQUIRES ui net cloud assets escpos render devcfg nvs_flash)
```

- [ ] **Step 2: Fetch config after Wi-Fi, and on config-changed**

The poll task owns the network cadence, so do config fetches there. In `main/app_state.c`, add includes `#include "device_config.h"` and a module-level config + a re-pull flag:
```c
static device_config_t s_cfg;
static volatile bool s_config_dirty = true;   // fetch once after first connect
void app_state_request_config(void) { s_config_dirty = true; }
```
Declare `app_state_request_config` in `main/state.h`:
```c
// Ask the poll loop to re-fetch the device config on its next iteration.
void app_state_request_config(void);
```
In `poll_task`, after a successful `cloud_get_commands` 200 (so we know we're online), add a config fetch when dirty:
```c
            if (s_config_dirty) {
                s_config_dirty = false;
                // carry the last ETag so unchanged config returns 304 cheaply
                int cs = cloud_get_config(&s_cfg);
                if (cs == 200 && s_cfg.valid) ui_render_idle(&s_cfg);
            }
```
(Place this right after `ui_set_online(true); commands_handle_body(body);` inside the `status == 200` branch. `s_cfg` keeps its `etag` between calls, so subsequent fetches send `If-None-Match`.)

- [ ] **Step 2b: Seed the poll task's config from the cached one**

So the first fetch sends the cached ETag (and a 304 avoids a re-render), copy the cached config into the poll task's `s_cfg` at boot. In `main/app_main.c`, after `cloud_config_load_cached(&g_cfg)`, the simplest path is to let the poll task own loading. Replace the Step-1 cached block with a call that also seeds the task:
```c
    cloud_config_load_cached(&g_cfg);
    if (g_cfg.valid) ui_render_idle(&g_cfg);
```
and in `app_state.c`'s `app_state_run`, load the cache into `s_cfg` before starting the task:
```c
void app_state_run(void)
{
    cloud_config_load_cached(&s_cfg);   // seed ETag so the first fetch can 304
    xTaskCreate(poll_task, "ditto_poll", 8192, NULL, 5, NULL);
}
```

- [ ] **Step 3: `config-changed` command triggers a re-pull**

`commands.c` lives in the `cloud` component and must not depend on `main`, so route the `config-changed` action through a callback that `main` registers. The callback pointer lives in `cloud.c` (same component as `commands.c`).

Add to `components/cloud/include/cloud.h`:
```c
// Register a hook invoked when a config-changed command arrives (set by main).
void cloud_set_config_changed_cb(void (*cb)(void));
// Internal: the registered hook (NULL if none). Used by commands.c.
void (*cloud_config_changed_handler(void))(void);
```
Add to `components/cloud/cloud.c`:
```c
static void (*s_cfg_changed_cb)(void);
void cloud_set_config_changed_cb(void (*cb)(void)) { s_cfg_changed_cb = cb; }
void (*cloud_config_changed_handler(void))(void) { return s_cfg_changed_cb; }
```
In `components/cloud/commands.c`, replace the generic `else` (the "refresh / config-changed / unknown" branch) with an explicit `config-changed` case plus the unknown fallback:
```c
        } else if (strcmp(type, "config-changed") == 0) {
            void (*cb)(void) = cloud_config_changed_handler();
            if (cb) cb();
            cloud_ack_command(id, true);
        } else {
            // refresh / unknown: ack now; behavior lands in later milestones.
            cloud_ack_command(id, true);
        }
```
Finally, in `main/app_main.c` after `app_state_run();`, register the hook:
```c
    cloud_set_config_changed_cb(app_state_request_config);
```
(`state.h` is already included in `app_main.c`.)

- [ ] **Step 4: Build + flash**

```bash
idf.py build && idf.py -p <PORT> flash monitor
```
Expected: boots, renders cached idle (or default if none), connects, fetches config (`config updated (N texts)`), idle screen reflects the merchant's branding.

- [ ] **Step 5: Commit**

```bash
git add main/app_main.c main/app_state.c main/state.h main/CMakeLists.txt components/cloud
git commit -m "feat(firmware): load/fetch config + config-changed re-pull"
```

---

### Task 6: End-to-end verification

- [ ] **Step 1: Set branding in the admin**

In the Maratus admin console, open the branding/printer editor for the device's org. Set a distinctive **brand color** and add/edit a **text** object on the idle screen (e.g. store name "ROASTWELL", a tagline) with a clear position + font size. Save (this enqueues `config-changed` to the org's devices — M1 behavior).

- [ ] **Step 2: Observe the device**

With the device running:
- Within one poll cycle (~12s) the device serial logs `config updated (N texts)` and the **idle screen repaints**: brand background color, the text object(s) at their configured positions/sizes.
- Serial shows a later poll logging `config not modified` (the 304 path — proves ETag caching).

- [ ] **Step 3: Persistence check**

Power-cycle the device. Expected: the idle screen shows the merchant's branding **immediately on boot** (from the NVS cache), before Wi-Fi connects — then a 304 confirms it's current.

- [ ] **Step 4: Regression**

Send a receipt (`node send.js <device-ip> fixtures/text-receipt.escpos`) → still renders + uploads + QR (config rendering doesn't disturb the receipt path). After the QR, tapping returns toward idle (M3 path) — the idle shown is now the config-driven one.

---

## Self-Review

**Spec coverage (M5 idle slice):**
- `GET /api/device/config` fetch with ETag/`If-None-Match` → 304 → Task 2 ✓
- Parse brand colors + idle text objects → Task 2 ✓
- NVS cache + boot render + persistence → Tasks 2, 5 ✓
- Render idle from config (bg + positioned/sized/colored text) → Tasks 3, 4 ✓
- `config-changed` command → re-pull + re-render → Task 5 ✓
- **Deferred to M5b (stated):** logo/icon images, live clock (SNTP/timezone), wifi/qr/widget objects, non-idle screens.

**Placeholder scan:** No `TODO`/`TBD`. Task 5 Step 3's callback indirection is fully specified (no "wire it up later"). All parse/fetch/render/NVS code is complete.

**Type/interface consistency:** `device_config_t`/`cfg_text_t` (Task 1) are produced by `cfg_parse_json`/`cloud_get_config`/`cloud_config_load_cached` (Task 2) and consumed by `ui_render_idle` (Task 4). The JSON field names (`version`, `brandBg`, `brandFg`, `config.screens.idle.objects[]` with `type`/`visible`/`text`/`x`/`y`/`fontSize`/`align`) match `DeviceConfigPayload` + `PrinterObject` in `maratus-admin`. ETag round-trip: `cfg->etag` ← payload `version`; sent back quoted as `If-None-Match: "<etag>"`, which `getDeviceConfig`'s `etagMatches` strips + compares — consistent with the M1 contract. `app_state_request_config` (declared Task 5 Step 2, `state.h`) is the `config-changed` callback (wired Task 5 Step 3). `font_for` maps `fontSize` to the fonts enabled in Task 3.

**Risk notes (not placeholders):**
- Text objects are positioned top-left at `x*720,y*720`; `align`/`w` (text box width) are parsed but center/right alignment within a box is approximate in M5 (labels auto-size). Fine for store-name/tagline; full box alignment is M5b polish.
- `font_for` maps to the nearest of six bundled sizes — exact `fontSize` isn't honored to the pixel. Acceptable; a scalable font is future work.
- Config JSON is capped at 16 KB (`body`/NVS) — ample for the idle screen's objects; larger multi-screen configs would need a bigger buffer (revisit in M5b when other screens render).
- The `config-changed` callback runs on the poll task (sets a flag; fetch happens in-loop) — no reentrancy concern.
