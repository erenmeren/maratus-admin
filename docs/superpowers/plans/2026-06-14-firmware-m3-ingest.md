# Firmware M3 — Ingest Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the full receipt lifecycle on real hardware minus ESC/POS — a tap on the idle screen uploads a bundled test PNG to `POST /api/ingest`, and the device renders the returned receipt URL as a QR code the customer scans to view the receipt.

**Architecture:** Builds on the M2 `maratus-firmware` skeleton (`net`/`cloud`/`ui`/`appcfg` + `main` state machine). Adds a `cloud_post_receipt()` multipart upload, a bundled PNG asset embedded in flash, a QR + processing screen in `ui`, and a tap-to-trigger path through the existing poll/state task. No ESC/POS yet — the image is a fixed test asset (real rendering is M4).

**Tech Stack:** ESP-IDF v5.4+, LVGL v9 (`lv_qrcode`), `esp_http_client` (manual multipart/form-data), cJSON, PSRAM (`heap_caps_malloc`). Targets the shipped M1 `/api/ingest` contract.

**Testing model:** Hardware-in-the-loop, same as M2 — each task's verify step is build → flash → observe (serial / screen / phone scan / admin). Prereqs: M2 verified (device online), the BSP wired in `main/idf_component.yml`, and `MARATUS_API_BASE_URL` + `MARATUS_DEVICE_KEY` set.

**Contract reference (`maratus-admin`):** `POST /api/ingest`, `Authorization: Bearer <deviceKey>`, `multipart/form-data` with field **`file`** (the image; `Content-Type: image/png`) and optional field **`metadata`** (a JSON string). Success → **201** `{ "token": "...", "url": "{BASE}/r/{token}" }`. Image must be non-empty, ≤ 5 MB, `image/*`.

---

### Task 1: Add processing + QR screens to the `ui` component

**Files:**
- Modify: `components/ui/include/ui.h`
- Modify: `components/ui/ui.c`
- Modify: `sdkconfig.defaults` (enable `lv_qrcode`)

- [ ] **Step 1: Enable the LVGL QR widget**

Append to `sdkconfig.defaults`:
```
# LVGL QR code widget (used by the QR receipt screen).
CONFIG_LV_USE_QRCODE=y
```

- [ ] **Step 2: Extend the ui interface**

In `components/ui/include/ui.h`, add two declarations after `ui_set_online`:
```c
// Show the QR screen rendering `url` as a scannable QR code. Thread-safe.
void ui_show_qr(const char *url);

// True (once) if the screen was tapped since the last call. Used to trigger a
// test ingest in M3. Cleared on read.
bool ui_consume_tap(void);
```

- [ ] **Step 3: Implement processing + QR screens and the tap flag**

In `components/ui/ui.c`, add `#include <string.h>` at the top, then add the new statics + screens. Add near the other statics:
```c
static lv_obj_t *s_processing_screen;
static lv_obj_t *s_qr_screen;
static lv_obj_t *s_qr;
static volatile bool s_tap_requested;

static void on_screen_click(lv_event_t *e) { (void)e; s_tap_requested = true; }
```

Add these screen builders (above `ui_init`):
```c
static lv_obj_t *make_processing_screen(void)
{
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(scr, lv_color_hex(MARATUS_GREEN), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, LV_PART_MAIN);

    lv_obj_t *label = lv_label_create(scr);
    lv_label_set_text(label, "Processing...");
    lv_obj_set_style_text_color(label, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_text_font(label, &lv_font_montserrat_28, LV_PART_MAIN);
    lv_obj_center(label);
    return scr;
}

static lv_obj_t *make_qr_screen(void)
{
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(scr, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, LV_PART_MAIN);

    lv_obj_t *label = lv_label_create(scr);
    lv_label_set_text(label, "Scan for your receipt");
    lv_obj_set_style_text_color(label, lv_color_black(), LV_PART_MAIN);
    lv_obj_set_style_text_font(label, &lv_font_montserrat_28, LV_PART_MAIN);
    lv_obj_align(label, LV_ALIGN_TOP_MID, 0, 56);

    s_qr = lv_qrcode_create(scr);
    lv_qrcode_set_size(s_qr, 420);
    lv_qrcode_set_dark_color(s_qr, lv_color_black());
    lv_qrcode_set_light_color(s_qr, lv_color_white());
    lv_obj_center(s_qr);

    // Tapping the QR screen re-triggers a test ingest (M3 convenience).
    lv_obj_add_flag(scr, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(scr, on_screen_click, LV_EVENT_CLICKED, NULL);
    return scr;
}
```

In `make_idle_screen()`, just before `return scr;`, make the idle screen tappable:
```c
    lv_obj_add_flag(scr, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(scr, on_screen_click, LV_EVENT_CLICKED, NULL);
```

In `ui_init()`, build the new screens alongside the idle screen (inside the existing lock):
```c
void ui_init(void)
{
    lvgl_port_lock(0);
    s_idle_screen = make_idle_screen();
    s_processing_screen = make_processing_screen();
    s_qr_screen = make_qr_screen();
    lvgl_port_unlock();
}
```

Extend `ui_show()` to handle PROCESSING:
```c
void ui_show(ui_screen_t screen)
{
    lv_obj_t *target = NULL;
    if (screen == UI_SCREEN_IDLE) target = s_idle_screen;
    else if (screen == UI_SCREEN_PROCESSING) target = s_processing_screen;
    if (!target) return;
    lvgl_port_lock(0);
    lv_screen_load(target);
    lvgl_port_unlock();
}
```

Add the QR + tap functions at the end of the file:
```c
void ui_show_qr(const char *url)
{
    if (!s_qr_screen || !s_qr || !url) return;
    lvgl_port_lock(0);
    lv_qrcode_update(s_qr, url, strlen(url));
    lv_screen_load(s_qr_screen);
    lvgl_port_unlock();
}

bool ui_consume_tap(void)
{
    bool t = s_tap_requested;
    s_tap_requested = false;
    return t;
}
```

- [ ] **Step 4: Temporary on-boot QR smoke test**

To verify the QR screen in isolation before the upload path exists, temporarily add to `main/app_main.c` after `ui_show(UI_SCREEN_IDLE);`:
```c
    ui_show_qr("https://example.com/r/test");   // TEMP: remove in Task 5
```

- [ ] **Step 5: Build + flash + verify QR renders**

```bash
cd /Users/eren/Projects/maratus-firmware
idf.py build && idf.py -p <PORT> flash monitor
```
Expected (on-device): white screen, "Scan for your receipt", a QR code. Scan it → phone opens `https://example.com/r/test`.

- [ ] **Step 6: Remove the temporary line**

Delete the `ui_show_qr("https://example.com/r/test");` line from `app_main.c`.

- [ ] **Step 7: Commit**

```bash
git add components/ui sdkconfig.defaults
git commit -m "feat(firmware): processing + QR screens, tap trigger"
```

---

### Task 2: Bundle a test PNG asset

**Files:**
- Create: `components/assets/CMakeLists.txt`
- Create: `components/assets/include/assets.h`
- Create: `components/assets/test_receipt.png` (binary — you add it)
- Create: `components/assets/assets.c`

> Putting the asset in its own component keeps the embed isolated and gives a clean `assets_test_png()` accessor.

- [ ] **Step 1: Add a test PNG**

Place any small valid PNG at `components/assets/test_receipt.png` (its content is arbitrary for M3 — it just has to be a real image the cloud will store and show). Generate one if you don't have one handy:
```bash
# ImageMagick:
magick -size 384x220 xc:white -gravity center -pointsize 28 -annotate 0 "MARATUS TEST\nM3 receipt" \
  /Users/eren/Projects/maratus-firmware/components/assets/test_receipt.png
# or Python/Pillow:
python3 -c "from PIL import Image,ImageDraw; im=Image.new('RGB',(384,220),'white'); ImageDraw.Draw(im).text((20,90),'MARATUS TEST  M3 receipt',fill='black'); im.save('/Users/eren/Projects/maratus-firmware/components/assets/test_receipt.png')"
```
Confirm it's a real PNG: `file components/assets/test_receipt.png` → `PNG image data`.

- [ ] **Step 2: Component CMake that embeds the binary**

`components/assets/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "assets.c"
                       INCLUDE_DIRS "include"
                       EMBED_FILES "test_receipt.png")
```

- [ ] **Step 3: Accessor interface + implementation**

`components/assets/include/assets.h`:
```c
#pragma once
#include <stddef.h>
#include <stdint.h>

// The bundled test receipt PNG (M3). Returns a pointer to the embedded bytes
// and writes the length to *len.
const uint8_t *assets_test_png(size_t *len);
```

`components/assets/assets.c`:
```c
#include "assets.h"

// Symbols produced by EMBED_FILES "test_receipt.png".
extern const uint8_t test_png_start[] asm("_binary_test_receipt_png_start");
extern const uint8_t test_png_end[]   asm("_binary_test_receipt_png_end");

const uint8_t *assets_test_png(size_t *len)
{
    if (len) *len = (size_t)(test_png_end - test_png_start);
    return test_png_start;
}
```

- [ ] **Step 4: Build to confirm the embed links**

```bash
idf.py build
```
Expected: clean build (the asset links; symbols resolve). No flash needed yet.

- [ ] **Step 5: Commit**

```bash
git add components/assets
git commit -m "feat(firmware): embed test receipt PNG asset"
```

---

### Task 3: `cloud_post_receipt()` — multipart upload to `/api/ingest`

**Files:**
- Modify: `components/cloud/include/cloud.h`
- Modify: `components/cloud/cloud.c`

- [ ] **Step 1: Declare the upload function**

Add to `components/cloud/include/cloud.h`:
```c
#include <stddef.h>
#include <stdint.h>

// POST /api/ingest with a PNG image (multipart field "file") + minimal metadata.
// On HTTP 201, copies the returned receipt URL into `url_out` (NUL-terminated,
// up to url_cap-1). Returns the HTTP status, or -1 on transport/allocation error.
int cloud_post_receipt(const uint8_t *png, size_t png_len, char *url_out, int url_cap);
```

- [ ] **Step 2: Implement the multipart upload**

In `components/cloud/cloud.c`, add includes at the top (after the existing ones):
```c
#include <stdlib.h>
#include "esp_heap_caps.h"
#include "cJSON.h"
```

Append the function (it reuses the existing `on_evt` + `resp_t` response-capture helpers in this file):
```c
int cloud_post_receipt(const uint8_t *png, size_t png_len, char *url_out, int url_cap)
{
    if (url_out && url_cap > 0) url_out[0] = '\0';
    if (!png || png_len == 0) return -1;

    const char *boundary = "----maratusBoundaryM3xKt7Qw";

    char meta[96];
    snprintf(meta, sizeof(meta), "{\"firmwareVersion\":\"%s\"}", appcfg_fw_version());

    char head[256];
    int head_len = snprintf(head, sizeof(head),
        "--%s\r\n"
        "Content-Disposition: form-data; name=\"file\"; filename=\"receipt.png\"\r\n"
        "Content-Type: image/png\r\n\r\n", boundary);

    char tail[256];
    int tail_len = snprintf(tail, sizeof(tail),
        "\r\n--%s\r\n"
        "Content-Disposition: form-data; name=\"metadata\"\r\n\r\n"
        "%s"
        "\r\n--%s--\r\n", boundary, meta, boundary);

    size_t total = (size_t)head_len + png_len + (size_t)tail_len;
    char *body = heap_caps_malloc(total, MALLOC_CAP_SPIRAM);
    if (!body) body = malloc(total);
    if (!body) { ESP_LOGE(TAG, "ingest body alloc failed (%u bytes)", (unsigned)total); return -1; }
    memcpy(body, head, head_len);
    memcpy(body + head_len, png, png_len);
    memcpy(body + head_len + png_len, tail, tail_len);

    char url[256];
    snprintf(url, sizeof(url), "%s/api/ingest", appcfg_base_url());
    char auth[96];
    snprintf(auth, sizeof(auth), "Bearer %s", appcfg_device_key());
    char ctype[96];
    snprintf(ctype, sizeof(ctype), "multipart/form-data; boundary=%s", boundary);

    char respbuf[512];
    respbuf[0] = '\0';
    resp_t resp = { .buf = respbuf, .cap = sizeof(respbuf), .len = 0 };

    esp_http_client_config_t cfg = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .event_handler = on_evt,
        .user_data = &resp,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .timeout_ms = 15000,
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    esp_http_client_set_header(c, "Authorization", auth);
    esp_http_client_set_header(c, "Content-Type", ctype);
    esp_http_client_set_post_field(c, body, total);

    int status = -1;
    if (esp_http_client_perform(c) == ESP_OK) {
        status = esp_http_client_get_status_code(c);
        respbuf[resp.len] = '\0';
        ESP_LOGI(TAG, "POST /ingest -> %d, body: %s", status, respbuf);
        if (status == 201 && url_out) {
            cJSON *root = cJSON_Parse(respbuf);
            if (root) {
                const char *u = cJSON_GetStringValue(cJSON_GetObjectItem(root, "url"));
                if (u) { strncpy(url_out, u, url_cap - 1); url_out[url_cap - 1] = '\0'; }
                cJSON_Delete(root);
            }
        }
    } else {
        ESP_LOGE(TAG, "POST /ingest failed");
    }
    esp_http_client_cleanup(c);
    free(body);
    return status;
}
```

(`components/cloud/CMakeLists.txt` already lists `json` in REQUIRES from M2, so cJSON is available; no CMake change needed.)

- [ ] **Step 3: Build to confirm it compiles**

```bash
idf.py build
```
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add components/cloud
git commit -m "feat(firmware): cloud_post_receipt multipart upload to /api/ingest"
```

---

### Task 4: Wire the ingest flow into the state task

**Files:**
- Modify: `main/app_state.c`
- Modify: `main/CMakeLists.txt` (add `assets` to REQUIRES)

- [ ] **Step 1: Add the test-ingest routine + tap check**

In `main/app_state.c`, add includes:
```c
#include "assets.h"
```
(`cloud.h`, `ui.h`, `net.h` are already included.)

Add the routine above `poll_task`:
```c
static void run_test_ingest(void)
{
    ui_show(UI_SCREEN_PROCESSING);

    size_t len = 0;
    const uint8_t *png = assets_test_png(&len);

    static char url[256];
    int status = cloud_post_receipt(png, len, url, sizeof(url));
    if (status == 201 && url[0]) {
        ESP_LOGI(TAG, "receipt ready: %s", url);
        s_state = DEV_QR;
        ui_show_qr(url);
    } else {
        ESP_LOGW(TAG, "ingest failed (status=%d)", status);
        s_state = DEV_IDLE;
        ui_show(UI_SCREEN_IDLE);
    }
}
```

- [ ] **Step 2: Check for a tap each poll iteration**

In `poll_task`, inside the `for (;;)` loop, at the very top (before the connectivity check), add:
```c
        if (ui_consume_tap() && net_is_connected()) {
            run_test_ingest();
            continue;
        }
```

> The poll loop already wakes every ~2–12s; a tap is serviced on the next wake. That latency is fine for M3 verification. (M4+ will move ingest to its own event path; for now the shared task keeps it simple.)

- [ ] **Step 3: Add `assets` to the main component REQUIRES**

`main/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "app_main.c" "app_state.c"
                       INCLUDE_DIRS "."
                       REQUIRES ui net cloud assets)
```

- [ ] **Step 4: Build + flash + verify end-to-end**

```bash
idf.py build && idf.py -p <PORT> flash monitor
```
On-device test:
1. Device boots → idle (green, "Ready", green dot once online).
2. **Tap the screen.** Expected: screen shows "Processing...", then serial logs `POST /ingest -> 201, body: {"token":"...","url":"https://.../r/..."}` and `receipt ready: https://.../r/...`, then the **QR screen** appears.
3. **Scan the QR** with your phone → the public receipt page loads and shows the test PNG.
4. **Admin:** the receipt appears in the device's receipt list; first scan flips its status `ready → downloaded`.
5. **Tap the QR screen** → it runs another ingest (proves repeatability).

- [ ] **Step 5: Commit**

```bash
git add main/app_state.c main/CMakeLists.txt
git commit -m "feat(firmware): tap-to-ingest flow (PNG upload -> QR screen)"
```

---

## Self-Review

**Spec coverage (M3 per firmware spec §10):**
- Bundled test PNG → Task 2 ✓
- `POST /api/ingest` upload (multipart `file` + metadata, bearer) → Task 3 ✓
- QR screen renders the returned URL → Tasks 1, 4 ✓
- Phone scan resolves the public receipt → Task 4 verify ✓
- "Full receipt lifecycle minus ESC/POS" → Tasks 1–4 compose it ✓

**Placeholder scan:** No `TODO`/`TBD` in shipped code. The only intentional temporary is the Task 1 Step 4 on-boot QR smoke line, explicitly removed in Step 6. The binary `test_receipt.png` is author-supplied (Task 2 Step 1) with two concrete generation commands — not a placeholder. BSP/lock specifics are unchanged from M2 (already reconciled).

**Type/interface consistency:** `ui_show_qr(const char*)` / `ui_consume_tap(void)` (Task 1) are called verbatim in Task 4. `assets_test_png(size_t*)` (Task 2) matches its Task 4 call. `cloud_post_receipt(const uint8_t*, size_t, char*, int)` (Task 3) matches the Task 4 call site. `UI_SCREEN_PROCESSING` (existing enum, M2) is now handled in `ui_show`. The multipart field name `file` + optional `metadata` and the `201 {token,url}` parse match the verified `maratus-admin` `/api/ingest` contract.

**Integration note (not a placeholder):** `cloud_post_receipt` reuses the `on_evt`/`resp_t` statics already defined in `cloud.c` (M2). If a future refactor moves them, this function must move with them or they must be exposed — they are file-local by design today.
