# M6b Firmware — OTA client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The device updates its firmware over-the-air — auto on its poll cadence and on an admin `firmware-update` command — by fetching the cloud manifest, downloading via `esp_https_ota`, rebooting, and marking the new image valid after a healthy check-in (auto-rollback otherwise).

**Architecture:** A pure `ota_manifest` module (parse + version-compare, host-tested). `cloud_get_firmware()` fetches `GET /api/device/firmware`. A new `ota` component runs `esp_https_ota` from the presigned URL and handles pending-verify/mark-valid. The poll loop calls the check every ~Nth idle poll and marks the running image valid on the first healthy poll; the `firmware-update` command forces an immediate check. Rollback enabled via `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`.

**Tech Stack:** ESP-IDF 5.5 (C), `esp_https_ota` + `app_update` (`esp_ota_ops`), `esp_crt_bundle`, cJSON. Host tests: `make -C tools/cfg-harness test`. Build: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`. Flash: `idf.py -p /dev/cu.usbmodem5A671704091 flash`. Repo: `/Users/eren/Projects/maratus-firmware`. Branch off `main`: `feat/m6b-firmware`.

This is **Plan 2 of 2** for M6b; it consumes the cloud manifest from Plan 1 (`GET /api/device/firmware` → `{version,url,sha256,size}` or 204). Spec: `docs/superpowers/specs/2026-06-20-firmware-m6b-ota-design.md`. Partition table is already A/B (`factory`/`ota_0`/`ota_1`/`otadata`).

---

### Task 0: Branch

- [ ] From `/Users/eren/Projects/maratus-firmware` on `main` (clean): `git checkout -b feat/m6b-firmware`.

---

### Task 1: Pure `ota_manifest` (parse + version-compare, host-tested)

**Files:** Create `components/devcfg/ota_manifest.c`, `components/devcfg/include/ota_manifest.h`; modify `components/devcfg/CMakeLists.txt` + `tools/cfg-harness/Makefile`; test `tools/cfg-harness/test_cfg.c`.

- [ ] **Step 1: Header**

Create `components/devcfg/include/ota_manifest.h`:
```c
#pragma once
#include <stdbool.h>
#include <stddef.h>

// Parsed OTA manifest. URL is a presigned R2 GET (can be long).
typedef struct {
    char version[32];
    char url[600];
    char sha256[72];
    int  size;
} fw_manifest_t;

// Parse the GET /api/device/firmware JSON body into *out. Returns true only if at
// least version + url are present and non-empty. Empty/`{}`/malformed → false.
bool ota_parse_manifest(const char *json, fw_manifest_t *out);

// True if an update should be applied: manifest version is non-empty AND differs
// from the running version (publishing is the intent; no semver).
bool ota_should_update(const char *running_version, const char *manifest_version);
```

- [ ] **Step 2: Failing test**

In `tools/cfg-harness/test_cfg.c`: add `#include "ota_manifest.h"`, the test below, and call `test_ota_manifest();` from `main()`:
```c
static void test_ota_manifest(void) {
    fw_manifest_t m;
    const char *ok = "{\"version\":\"0.3.0\",\"url\":\"https://r2/x?sig=1\",\"sha256\":\"abc\",\"size\":1599264}";
    assert(ota_parse_manifest(ok, &m));
    assert(strcmp(m.version, "0.3.0") == 0);
    assert(strcmp(m.url, "https://r2/x?sig=1") == 0);
    assert(m.size == 1599264);
    assert(!ota_parse_manifest("{}", &m));
    assert(!ota_parse_manifest("not json", &m));
    assert(!ota_parse_manifest("{\"version\":\"0.3.0\"}", &m));  // missing url

    assert(ota_should_update("0.2.0-m2", "0.3.0"));     // differs → update
    assert(!ota_should_update("0.3.0", "0.3.0"));        // same → no
    assert(!ota_should_update("0.2.0-m2", ""));          // empty manifest version → no
    printf("test_ota_manifest OK\n");
}
```

- [ ] **Step 3: Run → FAIL** — `make -C tools/cfg-harness test` (ota_manifest.h not found).

- [ ] **Step 4: Implement**

Create `components/devcfg/ota_manifest.c`:
```c
#include "ota_manifest.h"
#include <string.h>
#include "cJSON.h"

static void copy_str(char *dst, size_t cap, const char *src) {
    dst[0] = '\0';
    if (src) { strncpy(dst, src, cap - 1); dst[cap - 1] = '\0'; }
}

bool ota_parse_manifest(const char *json, fw_manifest_t *out) {
    if (!json || !out) return false;
    memset(out, 0, sizeof(*out));
    cJSON *root = cJSON_Parse(json);
    if (!root) return false;
    const char *v = cJSON_GetStringValue(cJSON_GetObjectItem(root, "version"));
    const char *u = cJSON_GetStringValue(cJSON_GetObjectItem(root, "url"));
    const char *s = cJSON_GetStringValue(cJSON_GetObjectItem(root, "sha256"));
    cJSON *sz = cJSON_GetObjectItem(root, "size");
    bool ok = v && v[0] && u && u[0];
    if (ok) {
        copy_str(out->version, sizeof(out->version), v);
        copy_str(out->url, sizeof(out->url), u);
        copy_str(out->sha256, sizeof(out->sha256), s);
        out->size = cJSON_IsNumber(sz) ? (int)sz->valuedouble : 0;
    }
    cJSON_Delete(root);
    return ok;
}

bool ota_should_update(const char *running_version, const char *manifest_version) {
    if (!manifest_version || !manifest_version[0]) return false;
    if (!running_version) return true;
    return strcmp(running_version, manifest_version) != 0;
}
```

- [ ] **Step 5: Wire build** — add `"ota_manifest.c"` to `components/devcfg/CMakeLists.txt` SRCS; add `../../components/devcfg/ota_manifest.c` to `tools/cfg-harness/Makefile` SRCS.

- [ ] **Step 6: Run → PASS** — `make -C tools/cfg-harness test` → `test_ota_manifest OK`, `ALL TESTS PASSED`.

- [ ] **Step 7: Commit**
```bash
git add components/devcfg/ota_manifest.c components/devcfg/include/ota_manifest.h components/devcfg/CMakeLists.txt tools/cfg-harness/Makefile tools/cfg-harness/test_cfg.c
git commit -m "feat(firmware): ota_manifest parse + version-compare (host-tested)"
```

---

### Task 2: `cloud_get_firmware`

**Files:** Modify `components/cloud/cloud.c`, `components/cloud/include/cloud.h`. (Confirm the `cloud` component `REQUIRES` includes `devcfg` — it does, for cfg parsing.)

- [ ] **Step 1: Declare in `cloud.h`**
```c
#include "ota_manifest.h"
// Fetch GET /api/device/firmware (device-key). On a 200 with a valid manifest, fills
// *out and returns true. 204/empty/error → false.
bool cloud_get_firmware(fw_manifest_t *out);
```

- [ ] **Step 2: Implement in `cloud.c`** — mirror `cloud_get_commands` (read it; reuse `resp_t`, `on_evt`, `TAG`, `appcfg_*`):
```c
bool cloud_get_firmware(fw_manifest_t *out)
{
    static char body[1536];
    resp_t resp = { .buf = body, .cap = sizeof(body), .len = 0 };
    char url[256];
    snprintf(url, sizeof(url), "%s/api/device/firmware", appcfg_base_url());
    char auth[96];
    snprintf(auth, sizeof(auth), "Bearer %s", appcfg_device_key());

    esp_http_client_config_t cfg = {
        .url = url, .method = HTTP_METHOD_GET, .event_handler = on_evt,
        .user_data = &resp, .crt_bundle_attach = esp_crt_bundle_attach, .timeout_ms = 10000,
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    esp_http_client_set_header(c, "Authorization", auth);
    bool ok = false;
    if (esp_http_client_perform(c) == ESP_OK) {
        int status = esp_http_client_get_status_code(c);
        body[resp.len] = '\0';
        ESP_LOGI(TAG, "GET /firmware -> %d", status);
        if (status == 200) ok = ota_parse_manifest(body, out);   // 204 → no body → false
    } else {
        ESP_LOGW(TAG, "GET /firmware failed");
    }
    esp_http_client_cleanup(c);
    return ok;
}
```
Add `#include "ota_manifest.h"` to cloud.c if not pulled via cloud.h.

- [ ] **Step 3: Build** — `idf.py build` clean.

- [ ] **Step 4: Commit**
```bash
git add components/cloud
git commit -m "feat(firmware): cloud_get_firmware (OTA manifest fetch)"
```

---

### Task 3: `ota` component (esp_https_ota + rollback) + enable rollback config

**Files:** Create `components/ota/ota.c`, `components/ota/include/ota.h`, `components/ota/CMakeLists.txt`; modify `sdkconfig.defaults` + `sdkconfig`.

- [ ] **Step 1: Header** — `components/ota/include/ota.h`:
```c
#pragma once
#include <stdbool.h>
// Check the cloud manifest and, if a different version (or forced), download+install
// via esp_https_ota and reboot. No-op if no manifest / same version / not forced.
void ota_check_and_update(bool forced);
// If the running image is in pending-verify (just OTA'd), mark it valid so the
// bootloader won't roll back. Call after a healthy cloud check-in.
void ota_mark_valid_if_pending(void);
```

- [ ] **Step 2: Implement** — `components/ota/ota.c`:
```c
#include "ota.h"
#include <string.h>
#include "esp_log.h"
#include "esp_system.h"
#include "esp_https_ota.h"
#include "esp_crt_bundle.h"
#include "esp_ota_ops.h"
#include "cloud.h"
#include "appcfg.h"
#include "ota_manifest.h"

static const char *TAG = "ota";

void ota_check_and_update(bool forced)
{
    fw_manifest_t m;
    if (!cloud_get_firmware(&m)) return;                 // no release / error
    if (!forced && !ota_should_update(appcfg_fw_version(), m.version)) {
        return;                                          // already on this version
    }
    ESP_LOGI(TAG, "OTA %s -> %s (%d bytes)", appcfg_fw_version(), m.version, m.size);

    esp_http_client_config_t http = {
        .url = m.url,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .timeout_ms = 60000,
        .keep_alive_enable = true,
    };
    esp_https_ota_config_t ota_cfg = { .http_config = &http };
    esp_err_t err = esp_https_ota(&ota_cfg);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "OTA ok, rebooting into %s", m.version);
        vTaskDelay(pdMS_TO_TICKS(300));
        esp_restart();                                   // boots new image (pending-verify)
    } else {
        ESP_LOGE(TAG, "OTA failed: %s (staying on %s)", esp_err_to_name(err), appcfg_fw_version());
    }
}

void ota_mark_valid_if_pending(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    esp_ota_img_states_t st;
    if (esp_ota_get_state_partition(running, &st) == ESP_OK && st == ESP_OTA_IMG_PENDING_VERIFY) {
        if (esp_ota_mark_app_valid_cancel_rollback() == ESP_OK) {
            ESP_LOGI(TAG, "marked OTA image valid (rollback cancelled)");
        }
    }
}
```
(`vTaskDelay`/`pdMS_TO_TICKS` need `freertos/FreeRTOS.h` + `freertos/task.h` — add the includes.)

- [ ] **Step 3: Component CMakeLists** — `components/ota/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "ota.c"
                       INCLUDE_DIRS "include"
                       REQUIRES esp_https_ota app_update esp-tls cloud devcfg appcfg)
```

- [ ] **Step 4: Enable rollback** — in `sdkconfig.defaults` add:
```
# OTA: revert to the previous app if a freshly-updated image isn't marked valid.
CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y
```
Also set it in the live `sdkconfig` (so this build has it): change `# CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE is not set` to `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y`.

- [ ] **Step 5: Build** — `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build` → clean. Confirm `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y` in sdkconfig after build.

- [ ] **Step 6: Commit**
```bash
git add components/ota sdkconfig.defaults
git commit -m "feat(firmware): ota component (esp_https_ota + rollback) + enable app-rollback"
```

---

### Task 4: Wire triggers (command + poll auto-check + mark-valid)

**Files:** Modify `components/cloud/commands.c` (the `firmware-update`/`refresh` cases — confirm cloud REQUIRES `ota`, or call via a callback); `main/app_state.c` (poll loop). NOTE: `commands.c` is in the `cloud` component; having it call `ota_check_and_update` would make `cloud` depend on `ota`, but `ota` already REQUIRES `cloud` → **dependency cycle**. Avoid it: handle `firmware-update` in `app_state` (which can depend on both), OR add an ota callback registered like `cloud_config_changed_handler`. Use the **callback** pattern (mirrors `config-changed`).

- [ ] **Step 1: Add an OTA-trigger callback to cloud (like config-changed)** — in `cloud.c`/`cloud.h`, add `cloud_set_firmware_update_cb(void (*cb)(void))` + `cloud_firmware_update_handler()` exactly mirroring the existing `cloud_set_config_changed_cb`/`cloud_config_changed_handler` (read those and copy the pattern). In `commands.c`, replace the `refresh / unknown` else-branch with explicit cases:
```c
        } else if (strcmp(type, "config-changed") == 0 || strcmp(type, "refresh") == 0) {
            void (*cb)(void) = cloud_config_changed_handler();
            if (cb) cb();
            cloud_ack_command(id, true);
        } else if (strcmp(type, "firmware-update") == 0) {
            cloud_ack_command(id, true);              // ack BEFORE OTA (which reboots)
            void (*fcb)(void) = cloud_firmware_update_handler();
            if (fcb) fcb();
        } else {
            cloud_ack_command(id, true);              // unknown: ack + ignore
        }
```
(Also fold `refresh` into the config-changed behavior, per the spec's small consistency fix.)

- [ ] **Step 2: Register the callback + periodic auto-check + mark-valid in `main/app_state.c`** — add `#include "ota.h"`. In `app_main.c` near `cloud_set_config_changed_cb(app_state_request_config);` add a registration that forces an OTA check; simplest is a tiny wrapper in app_state:
  - Add `static void ota_forced(void) { ota_check_and_update(true); }` in app_state.c and expose `app_state_run()` registering it. Actually register in `app_main.c`: `cloud_set_firmware_update_cb(ota_force_check);` where `ota_force_check` is a 1-line file-local fn in app_main calling `ota_check_and_update(true)`. (Either is fine — put the wrapper wherever `cloud_set_*_cb` is already called.)
  - In `poll_task`, after a successful `status == 200` block, add: mark-valid once + periodic auto-check. Insert after `backoff = POLL_BACKOFF_MIN;` (still inside `if (status == 200)`):
```c
            ota_mark_valid_if_pending();   // healthy check-in → confirm any freshly-OTA'd image
            if (++s_ota_poll_ctr >= OTA_CHECK_EVERY) {
                s_ota_poll_ctr = 0;
                ota_check_and_update(false);   // may reboot
            }
```
  - Add near the other poll constants: `#define OTA_CHECK_EVERY 50` (≈ every 50 idle polls; at POLL_IDLE_MS=12s that's ~10 min) and `static int s_ota_poll_ctr = 0;`.

- [ ] **Step 3: Build** — `idf.py build` clean. (Resolve the include/REQUIRES: `main` must REQUIRE `ota`; add it to `main/CMakeLists.txt` REQUIRES if missing.)

- [ ] **Step 4: Commit**
```bash
git add components/cloud main
git commit -m "feat(firmware): wire OTA — firmware-update command + poll auto-check + mark-valid"
```

---

### Task 5: Build + host tests + HIL

- [ ] **Step 1:** `make -C tools/cfg-harness test` → ALL TESTS PASSED (incl. `test_ota_manifest`).
- [ ] **Step 2:** `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build` → clean; confirm `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y`.
- [ ] **Step 3:** Flash the **current** version first: bump `CONFIG_DITTO_FW_VERSION` only when publishing the *next* one. Flash this build (`idf.py -p /dev/cu.usbmodem5A671704091 flash`) as the running baseline (e.g. `0.2.0-m2`).
- [ ] **Step 4: HIL (needs board + user + the cloud deployed/reachable so the device can fetch the manifest):**
  - Bump `CONFIG_DITTO_FW_VERSION` to e.g. `0.3.0-m6b`, `idf.py build`, and **publish** that `build/maratus-firmware.bin` via the admin Firmware page (Plan 1).
  - On the device: either wait for the ~10-min auto-check, or hit **"Update firmware"** in the dashboard CommandBar for an immediate update.
  - Device logs `GET /firmware -> 200`, `OTA … -> 0.3.0-m6b`, downloads, reboots; after boot it reports `x-device-version: 0.3.0-m6b` (admin device page shows the new version) and logs `marked OTA image valid`.
  - **Power-cycle** → stays on `0.3.0-m6b` (image was marked valid).
  - **Rollback test:** publish a deliberately-broken image (e.g. truncate the .bin a few KB) as `0.3.1-bad` → trigger update → the new image fails to boot/validate → bootloader reverts to `0.3.0-m6b`; device still comes online (still reports the prior version).
- [ ] **Step 5:** BUILD.md M6b entry; then deploy cloud (`vercel --prod`) + merge BOTH M6b branches (+ docs) — ship cloud + firmware together.

---

## Self-Review

**Spec coverage:**
- Manifest parse + version-compare (pure, host-tested) → Task 1. ✓
- `cloud_get_firmware` → Task 2. ✓
- `esp_https_ota` download + reboot; mark-valid; rollback config → Task 3. ✓
- Triggers: `firmware-update` command (via callback, avoiding the cloud↔ota cycle) + poll auto-check every ~10 min + `refresh` fix → Task 4. ✓
- Rollback safety (pending-verify → mark valid on healthy check-in) → Tasks 3–4. ✓
- Integrity = bootloader-validated ESP image hash (esp_https_ota validates on boot) → Task 3 (per spec; manifest sha256 carried but not stream-hashed). ✓
- Tests + build + HIL (update + power-cycle persistence + rollback) → Task 5. ✓

**Placeholder scan:** complete code for the pure module, `cloud_get_firmware`, the `ota` component, and the command wiring; the app_state wiring (Task 4.2) gives exact insert points + constants and flags the cloud↔ota dependency-cycle resolution (callback pattern) explicitly — real guidance, not placeholders.

**Type/name consistency:** `fw_manifest_t {version,url,sha256,size}` (ota_manifest.h) used by `cloud_get_firmware` (Task 2) and `ota_check_and_update` (Task 3). `ota_should_update(running, manifest)` consistent (Task 1 ↔ Task 3). `cloud_get_firmware`/`ota_check_and_update`/`ota_mark_valid_if_pending` names consistent across tasks. Callback pair `cloud_set_firmware_update_cb`/`cloud_firmware_update_handler` mirrors the verified `config_changed` pair.

**Risk note (flag for HIL):** the cloud↔ota dependency cycle is avoided via the callback (Task 4) — verify no component-graph cycle at build. The rollback test must use a genuinely bad image that the bootloader rejects (a truncated .bin fails the image SHA-256) so the revert path is actually exercised.
