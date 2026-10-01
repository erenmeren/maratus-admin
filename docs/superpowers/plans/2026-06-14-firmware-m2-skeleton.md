# Firmware M2 — Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `maratus-firmware` ESP-IDF project on the Waveshare ESP32-P4 board so it boots, shows a static LVGL idle screen, connects to Wi-Fi via the C6 radio, polls the M1 `GET /api/device/commands` endpoint (appearing **online** in the admin), and handles `identify` + `reboot` commands — all on a device-state-machine skeleton later milestones extend.

**Architecture:** New standalone git repo `maratus-firmware` (sibling of `maratus-admin`). ESP-IDF components per responsibility; M2 brings up `net` (Wi-Fi), `cloud` (HTTPS poll/ack), `ui` (idle screen), plus a `main` state-machine skeleton. **Board-specific bring-up (MIPI-DSI panel, touch, C6/SDIO Wi-Fi) is adopted from Waveshare's own ESP-IDF demo as the BSP baseline — not reinvented.** Our app-layer code (HTTP, NVS/Kconfig, cJSON, LVGL widgets, the poll task) is standard ESP-IDF and is written in full here.

**Tech Stack:** ESP-IDF v5.4+ (target `esp32p4`), LVGL v9, `esp_wifi_remote`/esp-hosted (C6 over SDIO), `esp_http_client` + `esp_crt_bundle`, cJSON, NVS, FreeRTOS. Targets the M1 contract in `maratus-admin` (`GET/POST /api/device/commands*`).

**Testing model (read this):** M2 is **hardware-in-the-loop**. Each task's "verify" step is **build → flash → observe a concrete on-device outcome** (a named serial-log line via `idf.py monitor`, specific screen content, or the device's status in the admin UI). There are no host unit tests in M2; pure logic (command dispatch) is kept in a focused function and verified on-device. The Node fixture harness + isolated tests arrive in M4 per the spec.

**Ground truth / prerequisites (confirm before Task 1):**
- ESP-IDF v5.4+ installed and `idf.py` on PATH; the board enumerates over the Type-C **UART** port.
- The exact panel driver, touch IC, C6 Wi-Fi transport init, and BSP component/function names come from **Waveshare's `ESP32-P4-WIFI6-Touch-LCD-4B` ESP-IDF demo** (Waveshare wiki). Where this plan says "from the demo", copy the working init and adapt — do not invent vendor APIs.
- A reachable Maratus Cloud base URL (the production Vercel URL, or a tunnel to local `maratus-admin`).
- A **dev device key** (see Task 5 for how to obtain one from `maratus-admin`).

---

### Task 1: Validate the Waveshare BSP baseline on the device

**Goal:** Prove toolchain + panel + touch + flashing work *before* adding our code, using the vendor's known-good demo. No `maratus-firmware` code yet.

**Files:** none in our repo yet (working in a scratch copy of the vendor demo).

- [ ] **Step 1: Get the vendor demo**

From the Waveshare wiki page for `ESP32-P4-WIFI6-Touch-LCD-4B`, download the ESP-IDF example project (the LCD/LVGL + Wi-Fi demo). Unzip to a scratch dir, e.g. `~/scratch/ws-p4-demo`.

- [ ] **Step 2: Build + flash + run the demo**

```bash
cd ~/scratch/ws-p4-demo
idf.py set-target esp32p4
idf.py build
idf.py -p <PORT> flash monitor   # <PORT> e.g. /dev/cu.usbserial-*
```

Expected (on-device): the 720×720 LCD lights up and shows the demo UI; touching the screen registers (per the demo's behavior). Serial monitor shows boot logs with no boot loop.

- [ ] **Step 3: Record the ground-truth facts**

From the demo's source + its build, note for reuse in later tasks (write them into `maratus-firmware/docs/bsp-notes.md` in Task 2):
- exact ESP-IDF version it targets,
- the display init entry point (BSP component name or the `esp_lcd`/LVGL init function),
- the touch init entry point,
- how it brings up the **C6 Wi-Fi** (managed component name, e.g. `esp_wifi_remote`/`esp_hosted`, and any SDIO pin config),
- the `sdkconfig` options enabling PSRAM + the C6 transport.

- [ ] **Step 4: Checkpoint (no commit — scratch only)**

This task gates everything: if the demo doesn't run, stop and resolve hardware/toolchain before proceeding. Report DONE only when the demo runs on the device.

---

### Task 2: Create the `maratus-firmware` project skeleton

**Files (new repo at `/Users/eren/Projects/maratus-firmware`):**
- Create: `maratus-firmware/.gitignore`
- Create: `maratus-firmware/CMakeLists.txt`
- Create: `maratus-firmware/partitions.csv`
- Create: `maratus-firmware/sdkconfig.defaults`
- Create: `maratus-firmware/main/CMakeLists.txt`
- Create: `maratus-firmware/main/app_main.c`
- Create: `maratus-firmware/docs/bsp-notes.md` (paste the Task 1 Step 3 facts here)
- Create: `maratus-firmware/README.md`

- [ ] **Step 1: Init the repo + .gitignore**

```bash
mkdir -p /Users/eren/Projects/maratus-firmware && cd /Users/eren/Projects/maratus-firmware
git init
```

`maratus-firmware/.gitignore`:
```
build/
sdkconfig
sdkconfig.old
managed_components/
dependencies.lock
*.bin
.DS_Store
```

- [ ] **Step 2: Top-level CMakeLists.txt**

`maratus-firmware/CMakeLists.txt`:
```cmake
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(maratus-firmware)
```

- [ ] **Step 3: partitions.csv (factory + A/B OTA + NVS, reserved for M6)**

`maratus-firmware/partitions.csv`:
```
# Name,   Type, SubType, Offset,  Size
nvs,      data, nvs,     ,        0x6000
phy_init, data, phy,     ,        0x1000
factory,  app,  factory, ,        2M
ota_0,    app,  ota_0,   ,        2M
ota_1,    app,  ota_1,   ,        2M
otadata,  data, ota,     ,        0x2000
```

- [ ] **Step 4: sdkconfig.defaults**

`maratus-firmware/sdkconfig.defaults` (PSRAM + custom partition table; copy the C6/Wi-Fi + display options recorded in `bsp-notes.md` from the demo's sdkconfig and append them here):
```
CONFIG_IDF_TARGET="esp32p4"
CONFIG_PARTITION_TABLE_CUSTOM=y
CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"
CONFIG_SPIRAM=y
CONFIG_FREERTOS_HZ=1000
CONFIG_ESP_MAIN_TASK_STACK_SIZE=8192
# --- append from bsp-notes.md: PSRAM mode/speed, C6 esp_wifi_remote/esp-hosted, MIPI-DSI display options ---
```

- [ ] **Step 5: main component + minimal app_main**

`maratus-firmware/main/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "app_main.c"
                       INCLUDE_DIRS ".")
```

`maratus-firmware/main/app_main.c`:
```c
#include "esp_log.h"

static const char *TAG = "maratus";

void app_main(void)
{
    ESP_LOGI(TAG, "Maratus firmware boot (M2 skeleton)");
}
```

`maratus-firmware/README.md`: one paragraph — what this repo is (Maratus receipt-printer firmware for ESP32-P4), how to build (`idf.py set-target esp32p4 build flash monitor`), and a pointer to the spec `maratus-admin/docs/superpowers/specs/2026-06-14-maratus-firmware-design.md`.

- [ ] **Step 6: Build + flash + verify boot**

```bash
cd /Users/eren/Projects/maratus-firmware
idf.py set-target esp32p4
idf.py build
idf.py -p <PORT> flash monitor
```
Expected (serial): `I (xxx) maratus: Maratus firmware boot (M2 skeleton)`, no boot loop.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(firmware): ESP-IDF project skeleton for ESP32-P4"
```

---

### Task 3: Bring up the display + a static LVGL idle screen

**Files:**
- Create: `maratus-firmware/components/ui/CMakeLists.txt`
- Create: `maratus-firmware/components/ui/include/ui.h`
- Create: `maratus-firmware/components/ui/ui.c`
- Create: `maratus-firmware/main/idf_component.yml` (declare LVGL + the BSP/display managed components used by the demo)
- Modify: `maratus-firmware/main/app_main.c`

- [ ] **Step 1: Declare managed components**

`maratus-firmware/main/idf_component.yml` — pin LVGL v9 and the same display/BSP managed component(s) the demo used (names from `bsp-notes.md`). Example shape (replace component names/versions with the demo's actuals):
```yaml
dependencies:
  idf: ">=5.4"
  lvgl/lvgl: "~9.2.0"
  # e.g. espressif/esp_lcd_mipi_dsi or the Waveshare BSP component the demo used:
  # <display/bsp component>: "<version from demo>"
```

- [ ] **Step 2: ui component skeleton**

`maratus-firmware/components/ui/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "ui.c"
                       INCLUDE_DIRS "include"
                       REQUIRES lvgl)
```

`maratus-firmware/components/ui/include/ui.h`:
```c
#pragma once

// Screens mirror PRINTER_SCREENS in maratus-admin. M2 only renders IDLE.
typedef enum {
    UI_SCREEN_SETUP,
    UI_SCREEN_IDLE,
    UI_SCREEN_PROCESSING,
    UI_SCREEN_QR,
    UI_SCREEN_SENT,
    UI_SCREEN_ERROR,
    UI_SCREEN_PAUSED,
} ui_screen_t;

// Build the static screens (call once, after LVGL + display are initialized,
// while holding the LVGL lock).
void ui_init(void);

// Switch the visible screen. Safe to call from the app task; takes the LVGL lock.
void ui_show(ui_screen_t screen);

// Set the small connectivity status dot on the idle screen (true = online/green).
void ui_set_online(bool online);
```

- [ ] **Step 3: ui implementation (LVGL v9, standard API)**

`maratus-firmware/components/ui/ui.c`:
```c
#include "ui.h"
#include "lvgl.h"

static lv_obj_t *s_idle_screen;
static lv_obj_t *s_status_dot;

static lv_obj_t *make_idle_screen(void)
{
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x10A765), LV_PART_MAIN); // Maratus brand green
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, LV_PART_MAIN);

    lv_obj_t *title = lv_label_create(scr);
    lv_label_set_text(title, "Maratus");
    lv_obj_set_style_text_color(title, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_48, LV_PART_MAIN);
    lv_obj_align(title, LV_ALIGN_CENTER, 0, -20);

    lv_obj_t *sub = lv_label_create(scr);
    lv_label_set_text(sub, "Ready");
    lv_obj_set_style_text_color(sub, lv_color_white(), LV_PART_MAIN);
    lv_obj_align(sub, LV_ALIGN_CENTER, 0, 40);

    s_status_dot = lv_obj_create(scr);
    lv_obj_set_size(s_status_dot, 20, 20);
    lv_obj_set_style_radius(s_status_dot, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_status_dot, lv_color_hex(0x888888), LV_PART_MAIN); // grey until online
    lv_obj_align(s_status_dot, LV_ALIGN_TOP_RIGHT, -16, 16);

    return scr;
}

void ui_init(void)
{
    s_idle_screen = make_idle_screen();
}

void ui_show(ui_screen_t screen)
{
    // M2: only IDLE exists; later milestones add the rest.
    if (screen == UI_SCREEN_IDLE && s_idle_screen) {
        lv_screen_load(s_idle_screen);
    }
}

void ui_set_online(bool online)
{
    if (s_status_dot) {
        lv_obj_set_style_bg_color(s_status_dot,
            online ? lv_color_hex(0x37C871) : lv_color_hex(0x888888), LV_PART_MAIN);
    }
}
```

> Note: `lv_font_montserrat_48` must be enabled in LVGL's `menuconfig` (Component config → LVGL → Font usage). If the demo enabled a different large font, use that instead.

- [ ] **Step 4: Initialize display + LVGL, then our UI, in app_main**

`maratus-firmware/main/app_main.c` — call the demo's display/LVGL init (function name from `bsp-notes.md`; commonly a `bsp_display_start()` that returns an `lv_display_t*` and starts the LVGL tick + `lv_timer_handler` task). Then build + show the idle screen **under the LVGL lock** the demo provides:
```c
#include "esp_log.h"
#include "ui.h"
// #include "<bsp display header from the demo>"   // e.g. bsp/esp-bsp.h

static const char *TAG = "maratus";

void app_main(void)
{
    ESP_LOGI(TAG, "Maratus firmware boot (M2 skeleton)");

    // 1) Start display + LVGL using the vendor BSP/demo init (see docs/bsp-notes.md).
    //    Replace with the actual call(s) the demo uses; it must start the LVGL
    //    timer-handler loop and give us a lock API (bsp_display_lock/unlock or
    //    lvgl_port_lock/unlock).
    // bsp_display_start();

    // 2) Build + show the idle screen while holding the LVGL lock.
    // bsp_display_lock(0);
    ui_init();
    ui_show(UI_SCREEN_IDLE);
    // bsp_display_unlock();

    ESP_LOGI(TAG, "Idle screen shown");
}
```

- [ ] **Step 5: Build + flash + verify the screen**

```bash
idf.py build && idf.py -p <PORT> flash monitor
```
Expected (on-device): LCD shows a **green screen with "Maratus" / "Ready"** and a grey dot top-right. Serial: `Idle screen shown`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(firmware): static LVGL idle screen"
```

---

### Task 4: Connect to Wi-Fi via the C6 radio

**Files:**
- Create: `maratus-firmware/components/net/CMakeLists.txt`
- Create: `maratus-firmware/components/net/include/net.h`
- Create: `maratus-firmware/components/net/net.c`
- Create: `maratus-firmware/main/Kconfig.projbuild` (dev Wi-Fi creds)
- Modify: `maratus-firmware/main/idf_component.yml` (add the C6 Wi-Fi managed component from the demo)
- Modify: `maratus-firmware/main/app_main.c`

- [ ] **Step 1: Kconfig for dev Wi-Fi creds**

`maratus-firmware/main/Kconfig.projbuild`:
```
menu "Maratus firmware (dev)"
    config MARATUS_WIFI_SSID
        string "Dev Wi-Fi SSID"
        default "changeme"
    config MARATUS_WIFI_PASSWORD
        string "Dev Wi-Fi password"
        default "changeme"
endmenu
```

- [ ] **Step 2: net component interface**

`maratus-firmware/components/net/include/net.h`:
```c
#pragma once
#include <stdbool.h>

// Starts Wi-Fi (STA) via the C6 radio and connects using the Kconfig dev creds.
// Blocks until connected or returns after kicking off auto-reconnect; emits logs.
void net_start(void);

// True once an IP has been acquired.
bool net_is_connected(void);
```

- [ ] **Step 3: net implementation**

`maratus-firmware/components/net/net.c` — standard `esp_wifi` STA flow. On ESP32-P4 the MAC/PHY live on the C6 and are proxied by `esp_wifi_remote`/esp-hosted; **the standard `esp_wifi_*` API is used unchanged once the remote transport is initialized per the demo.** Include the transport init exactly as the demo does (from `bsp-notes.md`); the code below is the portable STA logic on top of it:
```c
#include "net.h"
#include <string.h>
#include "esp_log.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

static const char *TAG = "net";
static EventGroupHandle_t s_events;
#define GOT_IP_BIT BIT0
static volatile bool s_connected = false;

static void on_wifi(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        s_connected = false;
        ESP_LOGW(TAG, "disconnected, reconnecting");
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        s_connected = true;
        ESP_LOGI(TAG, "got IP");
        xEventGroupSetBits(s_events, GOT_IP_BIT);
    }
}

void net_start(void)
{
    s_events = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    // NOTE: initialize the C6 remote-Wi-Fi transport here exactly as the vendor
    // demo does (esp_wifi_remote / esp_hosted bring-up) BEFORE esp_wifi_init().

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi, NULL, NULL));

    wifi_config_t wc = { 0 };
    strncpy((char *)wc.sta.ssid, CONFIG_MARATUS_WIFI_SSID, sizeof(wc.sta.ssid) - 1);
    strncpy((char *)wc.sta.password, CONFIG_MARATUS_WIFI_PASSWORD, sizeof(wc.sta.password) - 1);

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());

    xEventGroupWaitBits(s_events, GOT_IP_BIT, pdFALSE, pdTRUE, pdMS_TO_TICKS(20000));
}

bool net_is_connected(void) { return s_connected; }
```

`maratus-firmware/components/net/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "net.c"
                       INCLUDE_DIRS "include"
                       REQUIRES esp_wifi esp_event esp_netif)
```

- [ ] **Step 4: Call net_start + reflect status on the idle dot**

In `app_main.c`, after the idle screen is shown:
```c
#include "net.h"
// ...
    net_start();
    // reflect connectivity on the idle screen dot (take the LVGL lock as the demo requires)
    // bsp_display_lock(0);
    ui_set_online(net_is_connected());
    // bsp_display_unlock();
```

- [ ] **Step 5: Configure creds + build + flash + verify**

```bash
idf.py menuconfig   # set Maratus firmware (dev) → SSID + password
idf.py build && idf.py -p <PORT> flash monitor
```
Expected (serial): `net: got IP`. On-device: the status dot turns **green**.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(firmware): Wi-Fi STA via C6 radio"
```

---

### Task 5: Runtime config — API base URL + dev device key

**Files:**
- Modify: `maratus-firmware/main/Kconfig.projbuild`
- Create: `maratus-firmware/components/appcfg/CMakeLists.txt`
- Create: `maratus-firmware/components/appcfg/include/appcfg.h`
- Create: `maratus-firmware/components/appcfg/appcfg.c`

> **How to get a dev device key (in `maratus-admin`):** run `npm run db:seed` (creates devices with pairing codes), then in the admin UI claim a device — the raw device key is shown **once**; copy it. (Alternatively, in `db:studio` insert a `device` row and set `device_key_hash` to the SHA-256 hex of a key you choose.) The key is a 40-char nanoid; the server stores only its hash. Put the raw key in the Kconfig below. This is a **dev-only** shortcut — M6 replaces it with on-device claim + NVS.

- [ ] **Step 1: Add Kconfig entries**

Append to `maratus-firmware/main/Kconfig.projbuild` (inside the menu):
```
    config MARATUS_API_BASE_URL
        string "Maratus Cloud base URL"
        default "https://your-ditto-deployment.vercel.app"
    config MARATUS_DEVICE_KEY
        string "Dev device key (raw, 40-char)"
        default "changeme"
    config MARATUS_FW_VERSION
        string "Reported firmware version"
        default "0.2.0-m2"
```

- [ ] **Step 2: appcfg component**

`maratus-firmware/components/appcfg/include/appcfg.h`:
```c
#pragma once

// Runtime configuration. In M2 these come from Kconfig; M6 sources the device
// key from NVS (post-claim) instead.
const char *appcfg_base_url(void);    // e.g. "https://...vercel.app"
const char *appcfg_device_key(void);  // raw bearer key
const char *appcfg_fw_version(void);  // x-device-version value
```

`maratus-firmware/components/appcfg/appcfg.c`:
```c
#include "appcfg.h"
#include "sdkconfig.h"

const char *appcfg_base_url(void)   { return CONFIG_MARATUS_API_BASE_URL; }
const char *appcfg_device_key(void) { return CONFIG_MARATUS_DEVICE_KEY; }
const char *appcfg_fw_version(void) { return CONFIG_MARATUS_FW_VERSION; }
```

`maratus-firmware/components/appcfg/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "appcfg.c" INCLUDE_DIRS "include")
```

- [ ] **Step 3: Configure + build (no behavior yet)**

```bash
idf.py menuconfig   # set base URL + paste the dev device key
idf.py build
```
Expected: clean build. (No runtime change yet — consumed in Task 6.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(firmware): runtime config (base URL + dev device key)"
```

---

### Task 6: Poll `GET /api/device/commands` (HTTPS + bearer) → device shows online

**Files:**
- Create: `maratus-firmware/components/cloud/CMakeLists.txt`
- Create: `maratus-firmware/components/cloud/include/cloud.h`
- Create: `maratus-firmware/components/cloud/cloud.c`
- Modify: `maratus-firmware/main/app_main.c`

- [ ] **Step 1: cloud interface**

`maratus-firmware/components/cloud/include/cloud.h`:
```c
#pragma once
#include <stdbool.h>

// Performs GET /api/device/commands with the device bearer key.
// On success, copies up to `cap`-1 bytes of the JSON body into `out` (NUL-terminated)
// and returns the HTTP status code. Returns -1 on transport error.
int cloud_get_commands(char *out, int cap);
```

- [ ] **Step 2: cloud implementation (esp_http_client + cert bundle)**

`maratus-firmware/components/cloud/cloud.c`:
```c
#include "cloud.h"
#include <string.h>
#include <stdio.h>
#include "esp_log.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "appcfg.h"

static const char *TAG = "cloud";

typedef struct { char *buf; int cap; int len; } resp_t;

static esp_err_t on_evt(esp_http_client_event_t *e)
{
    if (e->event_id == HTTP_EVENT_ON_DATA) {
        resp_t *r = (resp_t *)e->user_data;
        if (r && r->buf) {
            int n = e->data_len;
            if (r->len + n > r->cap - 1) n = r->cap - 1 - r->len;
            if (n > 0) { memcpy(r->buf + r->len, e->data, n); r->len += n; }
        }
    }
    return ESP_OK;
}

int cloud_get_commands(char *out, int cap)
{
    if (out && cap > 0) out[0] = '\0';
    resp_t resp = { .buf = out, .cap = cap, .len = 0 };

    char url[256];
    snprintf(url, sizeof(url), "%s/api/device/commands", appcfg_base_url());

    char auth[96];
    snprintf(auth, sizeof(auth), "Bearer %s", appcfg_device_key());

    esp_http_client_config_t cfg = {
        .url = url,
        .method = HTTP_METHOD_GET,
        .event_handler = on_evt,
        .user_data = &resp,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .timeout_ms = 10000,
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    esp_http_client_set_header(c, "Authorization", auth);
    esp_http_client_set_header(c, "x-device-version", appcfg_fw_version());

    int status = -1;
    esp_err_t err = esp_http_client_perform(c);
    if (err == ESP_OK) {
        status = esp_http_client_get_status_code(c);
        if (out) out[resp.len] = '\0';
        ESP_LOGI(TAG, "GET /commands -> %d, body: %s", status, out ? out : "");
    } else {
        ESP_LOGE(TAG, "GET /commands failed: %s", esp_err_to_name(err));
    }
    esp_http_client_cleanup(c);
    return status;
}
```

`maratus-firmware/components/cloud/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "cloud.c"
                       INCLUDE_DIRS "include"
                       REQUIRES esp_http_client esp-tls appcfg)
```

- [ ] **Step 3: One poll on boot to prove the seam**

In `app_main.c`, after Wi-Fi connects:
```c
#include "cloud.h"
// ...
    static char body[1024];
    int status = cloud_get_commands(body, sizeof(body));
    ESP_LOGI(TAG, "first poll status=%d", status);
```

- [ ] **Step 4: Build + flash + verify online in admin**

```bash
idf.py build && idf.py -p <PORT> flash monitor
```
Expected (serial): `cloud: GET /commands -> 200, body: {"commands":[]}` and `first poll status=200`.
Expected (admin): the seeded device's status flips to **online** and `firmwareVersion` shows `0.2.0-m2` in the devices list.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(firmware): poll /api/device/commands (device shows online)"
```

---

### Task 7: Parse + dispatch commands (`identify`, `reboot`) + ack

**Files:**
- Modify: `maratus-firmware/components/cloud/include/cloud.h`
- Modify: `maratus-firmware/components/cloud/cloud.c`
- Create: `maratus-firmware/components/cloud/commands.c`
- Create: `maratus-firmware/components/cloud/include/commands.h`
- Modify: `maratus-firmware/components/cloud/CMakeLists.txt`

- [ ] **Step 1: Add an ack call to cloud**

Append to `cloud.h`:
```c
// POST /api/device/commands/ack with { commandId, ok }. Returns HTTP status or -1.
int cloud_ack_command(const char *command_id, bool ok);
```

Append to `cloud.c` (reuse the header/bearer pattern):
```c
int cloud_ack_command(const char *command_id, bool ok)
{
    char url[256];
    snprintf(url, sizeof(url), "%s/api/device/commands/ack", appcfg_base_url());
    char auth[96];
    snprintf(auth, sizeof(auth), "Bearer %s", appcfg_device_key());
    char payload[160];
    snprintf(payload, sizeof(payload), "{\"commandId\":\"%s\",\"ok\":%s}",
             command_id, ok ? "true" : "false");

    esp_http_client_config_t cfg = {
        .url = url, .method = HTTP_METHOD_POST,
        .crt_bundle_attach = esp_crt_bundle_attach, .timeout_ms = 10000,
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    esp_http_client_set_header(c, "Authorization", auth);
    esp_http_client_set_header(c, "Content-Type", "application/json");
    esp_http_client_set_post_field(c, payload, strlen(payload));

    int status = -1;
    if (esp_http_client_perform(c) == ESP_OK) status = esp_http_client_get_status_code(c);
    esp_http_client_cleanup(c);
    return status;
}
```

- [ ] **Step 2: commands parser + dispatcher**

`maratus-firmware/components/cloud/include/commands.h`:
```c
#pragma once

// Parse the {"commands":[{"id","type"}]} body and act on each command
// (identify / reboot), acking each. Unknown types are acked ok=true and ignored.
// `reboot` triggers esp_restart() and does not return.
void commands_handle_body(const char *json_body);
```

`maratus-firmware/components/cloud/commands.c`:
```c
#include "commands.h"
#include <string.h>
#include "esp_log.h"
#include "esp_system.h"
#include "cJSON.h"
#include "cloud.h"
#include "ui.h"

static const char *TAG = "cmd";

static void do_identify(void)
{
    // Visible blink: flash the status dot a few times. (Takes the LVGL lock per BSP.)
    for (int i = 0; i < 6; i++) {
        // bsp_display_lock(0);
        ui_set_online(i % 2 == 0);
        // bsp_display_unlock();
        vTaskDelay(pdMS_TO_TICKS(200));
    }
}

void commands_handle_body(const char *json_body)
{
    if (!json_body || !json_body[0]) return;
    cJSON *root = cJSON_Parse(json_body);
    if (!root) { ESP_LOGW(TAG, "bad JSON"); return; }

    cJSON *cmds = cJSON_GetObjectItem(root, "commands");
    int n = cJSON_IsArray(cmds) ? cJSON_GetArraySize(cmds) : 0;
    for (int i = 0; i < n; i++) {
        cJSON *cmd = cJSON_GetArrayItem(cmds, i);
        const char *id = cJSON_GetStringValue(cJSON_GetObjectItem(cmd, "id"));
        const char *type = cJSON_GetStringValue(cJSON_GetObjectItem(cmd, "type"));
        if (!id || !type) continue;
        ESP_LOGI(TAG, "command %s type=%s", id, type);

        if (strcmp(type, "identify") == 0) {
            do_identify();
            cloud_ack_command(id, true);
        } else if (strcmp(type, "reboot") == 0) {
            cloud_ack_command(id, true);  // ack BEFORE restarting
            ESP_LOGI(TAG, "rebooting");
            vTaskDelay(pdMS_TO_TICKS(300));
            esp_restart();                // does not return
        } else {
            // refresh / config-changed / unknown: ack now; behavior lands in later milestones.
            cloud_ack_command(id, true);
        }
    }
    cJSON_Delete(root);
}
```

- [ ] **Step 3: Update cloud CMakeLists**

`maratus-firmware/components/cloud/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "cloud.c" "commands.c"
                       INCLUDE_DIRS "include"
                       REQUIRES esp_http_client esp-tls appcfg json ui esp_system)
```

- [ ] **Step 4: Wire dispatch into the boot poll**

In `app_main.c`, after the poll:
```c
#include "commands.h"
// ...
    int status = cloud_get_commands(body, sizeof(body));
    if (status == 200) commands_handle_body(body);
```

- [ ] **Step 5: Build + flash + verify both commands**

```bash
idf.py build && idf.py -p <PORT> flash monitor
```
Test `identify`: in the admin UI, enqueue an `identify` command for this device, then power-cycle/reset so it polls (M2 polls on boot; the periodic task lands in Task 8). Expected: serial `cmd: command <id> type=identify`; on-device the status dot **blinks**; the command shows **acked** in admin.
Test `reboot`: enqueue `reboot`, reset to poll. Expected: serial `cmd: rebooting` then the board restarts; command shows **acked**.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(firmware): handle identify + reboot commands with ack"
```

---

### Task 8: Poll task + device-state-machine skeleton

**Files:**
- Create: `maratus-firmware/main/state.h`
- Create: `maratus-firmware/main/app_state.c`
- Modify: `maratus-firmware/main/CMakeLists.txt`
- Modify: `maratus-firmware/main/app_main.c`

- [ ] **Step 1: State enum (skeleton later milestones extend)**

`maratus-firmware/main/state.h`:
```c
#pragma once

// Device lifecycle states (see the firmware spec §6). M2 lives in IDLE; the
// receipt/upload/qr transitions are added in M3–M4, provisioning/paused in M5–M6.
typedef enum {
    DEV_BOOT,
    DEV_SETUP,
    DEV_IDLE,
    DEV_PROCESSING,
    DEV_UPLOADING,
    DEV_QR,
    DEV_SENT,
    DEV_ERROR,
    DEV_PAUSED,
} dev_state_t;

void app_state_run(void);   // starts the poll task; never returns control needed
```

- [ ] **Step 2: Poll task with cadence + backoff**

`maratus-firmware/main/app_state.c`:
```c
#include "state.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "cloud.h"
#include "commands.h"
#include "net.h"
#include "ui.h"

static const char *TAG = "state";
static dev_state_t s_state = DEV_BOOT;

#define POLL_IDLE_MS     12000
#define POLL_BACKOFF_MAX 60000

static void poll_task(void *arg)
{
    static char body[1024];
    int backoff = 2000;
    s_state = DEV_IDLE;

    for (;;) {
        if (!net_is_connected()) {
            // bsp_display_lock(0); ui_set_online(false); bsp_display_unlock();
            ui_set_online(false);
            vTaskDelay(pdMS_TO_TICKS(2000));
            continue;
        }
        int status = cloud_get_commands(body, sizeof(body));
        if (status == 200) {
            // bsp_display_lock(0); ui_set_online(true); bsp_display_unlock();
            ui_set_online(true);
            commands_handle_body(body);
            backoff = 2000;
            vTaskDelay(pdMS_TO_TICKS(POLL_IDLE_MS));
        } else {
            ESP_LOGW(TAG, "poll failed (status=%d), backoff=%dms", status, backoff);
            ui_set_online(false);
            vTaskDelay(pdMS_TO_TICKS(backoff));
            backoff = backoff * 2 > POLL_BACKOFF_MAX ? POLL_BACKOFF_MAX : backoff * 2;
        }
    }
}

void app_state_run(void)
{
    xTaskCreate(poll_task, "ditto_poll", 8192, NULL, 5, NULL);
}
```

- [ ] **Step 3: Update main CMakeLists + app_main**

`maratus-firmware/main/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "app_main.c" "app_state.c"
                       INCLUDE_DIRS "."
                       REQUIRES ui net cloud appcfg)
```

Replace the one-shot boot poll in `app_main.c` with the task (remove the Task 6/7 inline poll lines):
```c
#include "state.h"
// ... after net_start():
    app_state_run();   // continuous poll loop + state skeleton
    ESP_LOGI(TAG, "entered IDLE; polling");
```

- [ ] **Step 4: Build + flash + verify steady-state**

```bash
idf.py build && idf.py -p <PORT> flash monitor
```
Expected (on-device): device stays **online** in admin across multiple poll cycles (~12s cadence); status dot green. Pull Wi-Fi (disable the AP or move out of range): dot goes grey, serial shows backoff logs; restore Wi-Fi → reconnects and returns online. Enqueue `identify` from admin → within ~12s the dot blinks and the command acks **without a reset** (proving the periodic loop).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(firmware): poll task + device state-machine skeleton"
```

---

## Self-Review

**Spec coverage (M2 per §10 of the firmware spec):**
- Boots + C6 Wi-Fi up → Tasks 2, 4 ✓
- Static LVGL idle screen → Task 3 ✓
- `GET /api/device/commands` poll → device shows **online** → Tasks 6, 8 ✓
- `identify` / `reboot` work → Task 7 ✓
- Manually-seeded dev device + key flashed/configured → Task 5 ✓
- Device-state-machine skeleton → Task 8 ✓
- Component-per-responsibility layout (`net`/`cloud`/`ui` + `main`) per spec §3 ✓
- Partitions reserve A/B OTA for M6 → Task 2 ✓

**Placeholder scan:** The only intentionally-deferred specifics are the **vendor BSP integration points** (display/LVGL init, C6 transport init, the LVGL lock calls shown commented as `bsp_display_lock/unlock`). These are explicitly sourced from the Waveshare demo (Task 1 captures them into `bsp-notes.md`) because fabricating exact vendor APIs would be wrong. Every app-layer file has complete, real code. No `TODO`/`TBD` in app logic.

**Type/interface consistency:** `ui_screen_t`/`ui_show`/`ui_set_online` (Task 3) are used consistently in Tasks 7–8. `appcfg_base_url/device_key/fw_version` (Task 5) are consumed verbatim in Task 6–7. `cloud_get_commands` (Task 6) + `cloud_ack_command` (Task 7) signatures match their call sites. `commands_handle_body` (Task 7) is called in Tasks 7 and 8. `dev_state_t`/`app_state_run` (Task 8) match. The commands JSON shape (`{commands:[{id,type}]}`) and ack body (`{commandId, ok}`) match the verified `maratus-admin` endpoints.

**Known integration risk (flagged, not a placeholder):** the BSP lock/init function names (`bsp_display_start`, `bsp_display_lock/unlock`) are the common esp-bsp convention but MUST be reconciled with the actual demo in Task 1/Task 3 — the implementer substitutes the real names. This is the one place an implementer subagent should expect to adapt rather than copy verbatim.
