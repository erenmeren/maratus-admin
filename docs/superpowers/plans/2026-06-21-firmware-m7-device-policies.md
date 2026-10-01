# Firmware M7 — Device Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Maratus printer firmware honor the org-wide device settings the cloud already delivers — screen brightness, screen sleep/wake, and a long-press PIN-gated on-device Settings page.

**Architecture:** Extend the existing `devcfg` config model + parser with a `device` block (host-tested). Brightness and sleep/wake hook into the existing `main/app_state.c` poll loop and its 500ms idle slice; backlight is driven through the Waveshare BSP (`bsp_display_brightness_set` / `bsp_display_backlight_on/off`). The PIN-gated Settings UI is a new passive LVGL screen (`components/ui/ui_settings.c`) mirroring the existing `ui_wifi.c` pattern, orchestrated from `app_state.c`; the PIN is verified locally with a vendored SHA-256 (host-tested).

**Tech Stack:** ESP-IDF 5.5 (C), LVGL v9, ESP32-P4 (Waveshare ESP32-P4-WIFI6-Touch-LCD-4B), cJSON, vendored SHA-256. Host unit tests via `tools/cfg-harness/` (`make test`, no IDF needed).

**Repo:** `/Users/eren/Projects/maratus-firmware` (separate from maratus-admin). All work happens there on a feature branch.

## Global Constraints

- **This is a hardware-in-the-loop milestone.** Pure/parser logic is host-tested (`cfg-harness`); brightness, sleep/wake, and the Settings UI require flashing the board — those tasks are *code-complete + builds clean*, and on-device verification is a **user step** (the controller coordinates it, subagents do not flash).
- **No cloud changes.** The `/api/device/config` payload already carries `device.{brightness, sleep:{enabled,timeoutSeconds}, settingsPasswordHash, settingsPasswordSalt}`.
- **Defensive clamps on-device:** brightness 10–100; sleep timeout 30–3600. Missing/null `device` block → defaults `{brightness:100, sleep:{false,300}, hash:"", salt:""}`.
- **PIN:** verify locally as `sha256(salt + pin)` (64 lowercase hex), constant-time compare; empty stored hash → ungated (Settings opens directly).
- **Sleep = screen sleep only** (backlight off, CPU keeps polling). Engages only while `DEV_IDLE`. Wakes on any touch OR on a printed receipt (transition to PROCESSING/QR). `sleep.enabled == false` → never sleep.
- **Follow existing patterns:** `ui_wifi.c` is the reference for the passive Settings screen; `cfg_parse.c`'s `qrTimeoutSeconds` block is the reference for the new parser block; `idle_wait_or_qr_expiry` is the slice loop to extend.
- **Build:** `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py set-target esp32p4 && idf.py build` (run `./tools/patch-deps.sh` after the first managed-component fetch). Host tests: `cd tools/cfg-harness && make test`.
- Each task ends with a commit. Keep commits scoped to the task.

## File Structure

- `components/devcfg/include/device_config.h` — add `device` sub-struct to `device_config_t`.
- `components/devcfg/cfg_parse.c` — parse the `device` block.
- `components/devcfg/sleep_policy.{c,h}` (new) — pure `should_sleep()`.
- `components/devcfg/settings_pin.{c,h}` (new) — pure `settings_pin_verify()`.
- `components/devcfg/sha256.{c,h}` (new, vendored) — SHA-256 primitive (host + device).
- `components/devcfg/CMakeLists.txt` — register the three new `.c` files.
- `components/ui/include/ui.h` — add `ui_consume_activity`, `ui_consume_longpress`, and the `ui_settings_*` API.
- `components/ui/ui.c` — `LV_EVENT_PRESSED` activity flag + `LV_EVENT_LONG_PRESSED` flag on built screens.
- `components/ui/ui_settings.c` (new) — passive PIN keypad + Settings menu screens.
- `main/app_state.c` — brightness apply, sleep/wake loop + wake-on-receipt, long-press → Settings orchestration.
- `main/app_main.c` — apply cached brightness at boot.
- `tools/cfg-harness/Makefile` + `test_cfg.c` — host tests for the parser, `should_sleep`, `settings_pin_verify`; add new sources to the build.

---

### Task 0: Feature branch

**Files:** none (git).

- [ ] **Step 1: Create the branch**

Run:
```bash
cd /Users/eren/Projects/maratus-firmware
git checkout main && git pull --ff-only 2>/dev/null; git checkout -b feat/m7-device-policies
git rev-parse --abbrev-ref HEAD
```
Expected: `feat/m7-device-policies`.

- [ ] **Step 2: Confirm host harness builds green at baseline**

Run: `cd tools/cfg-harness && make clean && make test`
Expected: builds and the existing assertions pass (exit 0). This proves the host toolchain works before we add tests.

---

### Task 1: Parse the `device` block (host-tested)

**Files:**
- Modify: `components/devcfg/include/device_config.h` (add `device` sub-struct to `device_config_t`)
- Modify: `components/devcfg/cfg_parse.c` (`cfg_parse_json`)
- Modify: `tools/cfg-harness/test_cfg.c` (assertions) and `tools/cfg-harness/fixtures/sample-config.json`

**Interfaces:**
- Produces on `device_config_t`:
```c
struct {
    int  brightness;                  // 10..100
    struct { bool enabled; int timeout_seconds; } sleep;  // timeout 30..3600
    char settings_password_hash[65];  // sha256 hex (64) + NUL; "" when unset
    char settings_password_salt[33];  // salt + NUL; "" when unset
} device;
```

- [ ] **Step 1: Add the sub-struct to `device_config_t`**

In `components/devcfg/include/device_config.h`, inside `device_config_t`, immediately after `int qr_timeout_seconds;` add:

```c
    // M7 org-wide device policies (from the payload "device" block).
    struct {
        int  brightness;                  // 10..100
        struct { bool enabled; int timeout_seconds; } sleep;  // 30..3600
        char settings_password_hash[65];  // sha256(salt+pin) hex; "" = unset
        char settings_password_salt[33];  // "" = unset
    } device;
```

- [ ] **Step 2: Extend the fixture**

In `tools/cfg-harness/fixtures/sample-config.json`, add a top-level `"device"` object (sibling of `"config"`, `"brandBg"`, etc.):

```json
"device": {
  "brightness": 250,
  "sleep": { "enabled": true, "timeoutSeconds": 5 },
  "settingsPasswordHash": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "settingsPasswordSalt": "abc123"
}
```
(`brightness: 250` and `timeoutSeconds: 5` are deliberately out of range to assert clamping.)

- [ ] **Step 3: Write the failing test**

In `tools/cfg-harness/test_cfg.c`, inside `test_parse()` (after the existing assertions, before the function closes), add:

```c
    // M7 device policies: brightness clamps to 100, timeout clamps up to 30.
    assert(cfg.device.brightness == 100);
    assert(cfg.device.sleep.enabled == true);
    assert(cfg.device.sleep.timeout_seconds == 30);
    assert(strcmp(cfg.device.settings_password_hash,
                  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") == 0);
    assert(strcmp(cfg.device.settings_password_salt, "abc123") == 0);
```

Add a second test function and call it from `main` to cover the missing-block defaults:

```c
static void test_device_defaults(void) {
    const char *json = "{\"version\":\"v\",\"config\":{}}";   // no "device" block
    device_config_t cfg;
    assert(cfg_parse_json(json, &cfg) && cfg.valid);
    assert(cfg.device.brightness == 100);
    assert(cfg.device.sleep.enabled == false);
    assert(cfg.device.sleep.timeout_seconds == 300);
    assert(cfg.device.settings_password_hash[0] == '\0');
    assert(cfg.device.settings_password_salt[0] == '\0');
}
```
Register it: add `test_device_defaults();` next to the other `test_*()` calls in `main()`.

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd tools/cfg-harness && make test`
Expected: FAIL — assertion on `cfg.device.brightness` (field parsed as 0 / not yet implemented), or a compile error if the struct field is missing.

- [ ] **Step 5: Implement the parser block**

In `components/devcfg/cfg_parse.c`, in `cfg_parse_json`, after the `qr_timeout_seconds` block (right before the `screens` loop), add:

```c
    cJSON *dev = cJSON_GetObjectItem(root, "device");
    cJSON *br = dev ? cJSON_GetObjectItem(dev, "brightness") : NULL;
    cfg->device.brightness = cJSON_IsNumber(br) ? (int)br->valuedouble : 100;
    if (cfg->device.brightness < 10)  cfg->device.brightness = 10;
    if (cfg->device.brightness > 100) cfg->device.brightness = 100;

    cJSON *slp = dev ? cJSON_GetObjectItem(dev, "sleep") : NULL;
    cfg->device.sleep.enabled = slp ? cJSON_IsTrue(cJSON_GetObjectItem(slp, "enabled")) : false;
    cJSON *st = slp ? cJSON_GetObjectItem(slp, "timeoutSeconds") : NULL;
    cfg->device.sleep.timeout_seconds = cJSON_IsNumber(st) ? (int)st->valuedouble : 300;
    if (cfg->device.sleep.timeout_seconds < 30)   cfg->device.sleep.timeout_seconds = 30;
    if (cfg->device.sleep.timeout_seconds > 3600) cfg->device.sleep.timeout_seconds = 3600;

    copy_str(cfg->device.settings_password_hash, sizeof(cfg->device.settings_password_hash),
             dev ? cJSON_GetStringValue(cJSON_GetObjectItem(dev, "settingsPasswordHash")) : NULL);
    copy_str(cfg->device.settings_password_salt, sizeof(cfg->device.settings_password_salt),
             dev ? cJSON_GetStringValue(cJSON_GetObjectItem(dev, "settingsPasswordSalt")) : NULL);
```

(`copy_str` is the existing helper — it null-safe-copies and bounds to the buffer; a NULL source yields `""`.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd tools/cfg-harness && make test`
Expected: PASS (all assertions, including the new ones).

- [ ] **Step 7: Commit**

```bash
cd /Users/eren/Projects/maratus-firmware
git add components/devcfg/include/device_config.h components/devcfg/cfg_parse.c tools/cfg-harness/test_cfg.c tools/cfg-harness/fixtures/sample-config.json
git commit -m "feat(m7): parse device-policy block (brightness/sleep/pin)"
```

---

### Task 2: Phase A — apply brightness

**Files:**
- Modify: `main/app_state.c` (config-apply path + a `display_apply_brightness` helper + boot apply)
- Modify: `main/app_main.c` (no-op confirm; brightness now also applied from cached config in app_state)

**Interfaces:**
- Consumes: `device_config_t.device.brightness` (Task 1).
- Produces: `static void display_apply_brightness(int duty)` in `app_state.c` (used by Task 4's wake path too).

This task is on-device wiring (BSP calls); it builds but is verified on hardware by the user.

- [ ] **Step 1: Add the BSP include + brightness helper**

In `main/app_state.c`, add to the includes near the top:

```c
#include "bsp/esp-bsp.h"
```

Add this helper above `poll_task` (the `s_display_asleep` flag is introduced fully in Task 4; declare it here so brightness and sleep share it):

```c
static bool s_display_asleep = false;

// Apply backlight brightness (0..100 duty). No-op while asleep — Task 4's
// sleep/wake owns the backlight then. Clamps defensively.
static void display_apply_brightness(int duty) {
    if (s_display_asleep) return;
    if (duty < 10)  duty = 10;
    if (duty > 100) duty = 100;
    bsp_display_brightness_set(duty);
}
```

- [ ] **Step 2: Apply on config-apply**

In `poll_task`, inside the `if (cs == 200 && s_cfg_buf[next]->valid)` block, right after `ui_set_config(s_cfg_buf[next]);`, add:

```c
                    display_apply_brightness(s_cfg_buf[next]->device.brightness);
```

- [ ] **Step 3: Apply cached brightness at boot**

In `app_state_run()`, after `cloud_config_load_cached(...)` and `ui_set_config(...)`, add (guarded on a valid cached config so we don't override `app_main`'s default with a zeroed struct):

```c
    if (s_cfg_buf[s_cfg_live]->valid)
        display_apply_brightness(s_cfg_buf[s_cfg_live]->device.brightness);
```

- [ ] **Step 4: Build**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: compiles clean. (If the ESP-IDF toolchain isn't available in this environment, skip the build, note it in the report, and rely on review — do NOT mark the task done without either a clean build or an explicit toolchain-unavailable note.)

- [ ] **Step 5: Commit**

```bash
git add main/app_state.c
git commit -m "feat(m7): apply device brightness on config-apply and boot"
```

**On-device verification (USER step, after flashing):** change Screen brightness in admin Device Settings → save → within a poll cycle (~12s) the panel dims/brightens.

---

### Task 3: Phase B — `should_sleep` decision (host-tested)

**Files:**
- Create: `components/devcfg/sleep_policy.h`, `components/devcfg/sleep_policy.c`
- Modify: `components/devcfg/CMakeLists.txt` (add `sleep_policy.c`)
- Modify: `tools/cfg-harness/Makefile` (add `sleep_policy.c` to SRCS), `tools/cfg-harness/test_cfg.c`

**Interfaces:**
- Produces: `bool should_sleep(uint32_t now_ms, uint32_t last_activity_ms, int timeout_s, bool enabled, dev_state_t state);`

- [ ] **Step 1: Write the header**

`components/devcfg/sleep_policy.h`:
```c
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "dev_state.h"

// Pure decision: should the display go to sleep now?
// True iff sleep is enabled, the device is idle, and the inactivity window has
// elapsed. now_ms/last_activity_ms are monotonic milliseconds.
bool should_sleep(uint32_t now_ms, uint32_t last_activity_ms,
                  int timeout_s, bool enabled, dev_state_t state);
```

- [ ] **Step 2: Write the failing test**

Add to `tools/cfg-harness/test_cfg.c` a new function + register it in `main()`:

```c
#include "sleep_policy.h"   // add with the other includes

static void test_should_sleep(void) {
    // disabled -> never
    assert(should_sleep(100000, 0, 30, false, DEV_IDLE) == false);
    // not idle -> never (even if elapsed)
    assert(should_sleep(100000, 0, 30, true, DEV_QR) == false);
    // idle + enabled, window not elapsed
    assert(should_sleep(10000, 0, 30, true, DEV_IDLE) == false);   // 10s < 30s
    // idle + enabled, window elapsed
    assert(should_sleep(30000, 0, 30, true, DEV_IDLE) == true);    // 30s >= 30s
    assert(should_sleep(45000, 0, 30, true, DEV_IDLE) == true);
}
```
Register: add `test_should_sleep();` in `main()`.

- [ ] **Step 3: Add the source to both build systems**

In `tools/cfg-harness/Makefile`, add `../../components/devcfg/sleep_policy.c \` to the `SRCS` list.

In `components/devcfg/CMakeLists.txt`, add `sleep_policy.c` to the `SRCS`/`idf_component_register(SRCS ...)` list (match the existing listing style for `cfg_parse.c`).

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd tools/cfg-harness && make clean && make test`
Expected: FAIL — link error "undefined reference to should_sleep" (or compile error).

- [ ] **Step 5: Implement**

`components/devcfg/sleep_policy.c`:
```c
#include "sleep_policy.h"

bool should_sleep(uint32_t now_ms, uint32_t last_activity_ms,
                  int timeout_s, bool enabled, dev_state_t state) {
    if (!enabled) return false;
    if (state != DEV_IDLE) return false;
    if (timeout_s < 1) timeout_s = 1;
    uint32_t elapsed = now_ms - last_activity_ms;   // monotonic; wrap is harmless here
    return elapsed >= (uint32_t)timeout_s * 1000u;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd tools/cfg-harness && make test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/devcfg/sleep_policy.h components/devcfg/sleep_policy.c components/devcfg/CMakeLists.txt tools/cfg-harness/Makefile tools/cfg-harness/test_cfg.c
git commit -m "feat(m7): pure should_sleep inactivity decision"
```

---

### Task 4: Phase B — sleep/wake integration

**Files:**
- Modify: `components/ui/include/ui.h` (add `ui_consume_activity`)
- Modify: `components/ui/ui.c` (`LV_EVENT_PRESSED` activity flag + consume)
- Modify: `main/app_state.c` (sleep/wake in the idle slice, wake-on-receipt, wake guard)

**Interfaces:**
- Consumes: `should_sleep` (Task 3), `display_apply_brightness` + `s_display_asleep` (Task 2).
- Produces: `bool ui_consume_activity(void)` (true once if any touch since last call).

On-device wiring; builds clean, verified on hardware.

- [ ] **Step 1: Add the activity API to ui.h**

In `components/ui/include/ui.h`, near `ui_consume_tap`, add:
```c
// True (once) if the screen was touched (pressed) since the last call. Distinct
// from ui_consume_tap (a completed tap): used to detect activity for sleep/wake.
bool ui_consume_activity(void);
```

- [ ] **Step 2: Implement the activity flag in ui.c**

In `components/ui/ui.c`, add a flag near the existing `s_tap_requested`:
```c
static volatile bool s_activity = false;
```
Add a press handler near `on_screen_click`:
```c
static void on_screen_press(lv_event_t *e) { (void)e; s_activity = true; }
```
Where the existing `lv_obj_add_event_cb(scr, on_screen_click, LV_EVENT_CLICKED, NULL);` is registered (in `build_screen`), add alongside it:
```c
    lv_obj_add_event_cb(scr, on_screen_press, LV_EVENT_PRESSED, NULL);
```
Add the consumer near `ui_consume_tap`:
```c
bool ui_consume_activity(void) {
    bool v;
    lvgl_port_lock(0);
    v = s_activity;
    s_activity = false;
    lvgl_port_unlock();
    return v;
}
```
(Match the exact lock/unlock idiom used by the existing `ui_consume_tap` in this file.)

- [ ] **Step 3: Add sleep/wake state + helpers in app_state.c**

In `main/app_state.c`, add includes:
```c
#include "esp_timer.h"
#include "sleep_policy.h"
```
Add statics near `s_display_asleep` (declared in Task 2):
```c
static uint32_t s_last_activity_ms = 0;
static uint32_t s_wake_guard_until = 0;   // ignore taps until this time (swallow the wake touch)

static inline uint32_t now_ms(void) { return (uint32_t)(esp_timer_get_time() / 1000); }

static void display_sleep(void) {
    bsp_display_backlight_off();
    s_display_asleep = true;
}
static void display_wake(int duty) {
    s_display_asleep = false;            // clear first so display_apply_brightness runs
    display_apply_brightness(duty);
    bsp_display_backlight_on();
    s_last_activity_ms = now_ms();
    s_wake_guard_until = now_ms() + 800; // the touch that woke us must not also trigger ingest
    ui_consume_tap();                    // swallow any tap already latched by the wake touch
}
```

- [ ] **Step 4: Wake on a printed receipt**

Replace `void app_state_set_state(dev_state_t st) { s_state = st; }` with:
```c
void app_state_set_state(dev_state_t st) {
    // A print job arriving while asleep must light the screen so the QR is visible.
    if (s_display_asleep && (st == DEV_PROCESSING || st == DEV_QR))
        display_wake(s_cfg_buf[s_cfg_live]->device.brightness);
    s_state = st;
}
```

- [ ] **Step 5: Integrate sleep/wake into the idle slice**

In `idle_wait_or_qr_expiry`, inside the `for` loop body (after the `ui_consume_countdown_expired()` check), add:
```c
        const device_config_t *cfg = s_cfg_buf[s_cfg_live];
        bool active = ui_consume_activity();
        if (active) s_last_activity_ms = now_ms();
        if (cfg->device.sleep.enabled) {
            if (!s_display_asleep &&
                should_sleep(now_ms(), s_last_activity_ms,
                             cfg->device.sleep.timeout_seconds, true, s_state)) {
                display_sleep();
            } else if (s_display_asleep && active) {
                display_wake(cfg->device.brightness);
            }
        } else if (s_display_asleep) {
            display_wake(cfg->device.brightness);   // sleep turned off -> ensure the panel is on
        }
```

- [ ] **Step 6: Apply the wake guard at the tap site**

In `poll_task`, replace the top tap check:
```c
        if (ui_consume_tap() && net_is_connected()) {
            run_test_ingest();
            continue;
        }
```
with:
```c
        if (ui_consume_tap()) {
            // A tap that merely woke the screen must not also trigger ingest.
            if (now_ms() >= s_wake_guard_until && net_is_connected()) run_test_ingest();
            continue;
        }
```

- [ ] **Step 7: Initialize last-activity at startup**

In `poll_task`, where `s_state = DEV_IDLE;` is set before the loop, add `s_last_activity_ms = now_ms();` so the device doesn't immediately sleep on boot.

- [ ] **Step 8: Build**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: compiles clean. (Toolchain-unavailable note allowed, as Task 2.)

- [ ] **Step 9: Commit**

```bash
git add components/ui/include/ui.h components/ui/ui.c main/app_state.c
git commit -m "feat(m7): screen sleep on inactivity, wake on touch/receipt"
```

**On-device verification (USER step):** enable sleep with a short timeout in admin → screen blanks after the timeout → a touch wakes it (and does NOT fire a test ingest) → printing a receipt while asleep wakes the screen and shows the QR → disabling sleep keeps the panel on.

---

### Task 5: Phase C — vendored SHA-256 + PIN verify (host-tested)

**Files:**
- Create (vendored): `components/devcfg/sha256.h`, `components/devcfg/sha256.c`
- Create: `components/devcfg/settings_pin.h`, `components/devcfg/settings_pin.c`
- Modify: `components/devcfg/CMakeLists.txt` (add `sha256.c`, `settings_pin.c`)
- Modify: `tools/cfg-harness/Makefile` (add both to SRCS), `tools/cfg-harness/test_cfg.c`

**Interfaces:**
- Produces: `bool settings_pin_verify(const char *pin, const char *hash_hex, const char *salt);`
- SHA-256 primitive API (Brad Conte, public domain): `void sha256_init(SHA256_CTX*); void sha256_update(SHA256_CTX*, const uint8_t*, size_t); void sha256_final(SHA256_CTX*, uint8_t out[32]);`

- [ ] **Step 1: Vendor SHA-256**

Vendor Brad Conte's public-domain SHA-256 into the devcfg component. Fetch the two files from the canonical source (github.com/B-Con/crypto-algorithms — `sha256.h`, `sha256.c`):
```bash
cd /Users/eren/Projects/maratus-firmware/components/devcfg
curl -fsSL https://raw.githubusercontent.com/B-Con/crypto-algorithms/master/sha256.h -o sha256.h
curl -fsSL https://raw.githubusercontent.com/B-Con/crypto-algorithms/master/sha256.c -o sha256.c
```
This implementation exposes `SHA256_CTX`, `sha256_init`, `sha256_update`, `sha256_final`, and `SHA256_BLOCK_SIZE == 32`, using `BYTE`/`WORD` typedefs in `sha256.h`. If `curl` is unavailable in this environment, STOP and report BLOCKED so the controller can supply the file — do not hand-write a crypto primitive.

- [ ] **Step 2: Write the PIN header**

`components/devcfg/settings_pin.h`:
```c
#pragma once
#include <stdbool.h>

// Verify an on-device Settings PIN against the cloud-delivered salted hash.
// Computes sha256(salt + pin) and constant-time compares the lowercase hex to
// hash_hex. Returns false if hash_hex is empty/NULL (no PIN configured).
bool settings_pin_verify(const char *pin, const char *hash_hex, const char *salt);
```

- [ ] **Step 3: Write the failing test**

Add to `tools/cfg-harness/test_cfg.c` (and register in `main()`):
```c
#include "settings_pin.h"   // with the other includes
#include "sha256.h"

static void test_sha256_and_pin(void) {
    // Known vector: sha256("abc") = ba78...15ad.
    SHA256_CTX c; uint8_t out[32]; char hex[65];
    sha256_init(&c); sha256_update(&c, (const uint8_t*)"abc", 3); sha256_final(&c, out);
    for (int i = 0; i < 32; i++) sprintf(hex + i*2, "%02x", out[i]);
    assert(strcmp(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") == 0);

    // settings_pin_verify: salt="a", pin="bc" -> sha256("abc") == the known hash.
    const char *H = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    assert(settings_pin_verify("bc", H, "a") == true);
    assert(settings_pin_verify("xx", H, "a") == false);
    assert(settings_pin_verify("bc", "", "a") == false);   // no PIN configured
}
```
Register: `test_sha256_and_pin();` in `main()`.

- [ ] **Step 4: Add sources to both builds**

In `tools/cfg-harness/Makefile`, add to `SRCS`:
```
           ../../components/devcfg/sha256.c \
           ../../components/devcfg/settings_pin.c \
```
In `components/devcfg/CMakeLists.txt`, add `sha256.c` and `settings_pin.c` to the registered `SRCS`.

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd tools/cfg-harness && make clean && make test`
Expected: FAIL — undefined reference to `settings_pin_verify`.

- [ ] **Step 6: Implement `settings_pin_verify`**

`components/devcfg/settings_pin.c`:
```c
#include "settings_pin.h"
#include "sha256.h"
#include <string.h>
#include <stdio.h>

bool settings_pin_verify(const char *pin, const char *hash_hex, const char *salt) {
    if (!hash_hex || hash_hex[0] == '\0') return false;   // no PIN configured
    if (!pin) pin = "";
    if (!salt) salt = "";

    SHA256_CTX ctx;
    uint8_t digest[32];
    sha256_init(&ctx);
    sha256_update(&ctx, (const uint8_t *)salt, strlen(salt));
    sha256_update(&ctx, (const uint8_t *)pin, strlen(pin));
    sha256_final(&ctx, digest);

    char hex[65];
    for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", digest[i]);

    // Constant-time compare over the full 64 hex chars (hash_hex assumed lowercase
    // 64-char hex from the cloud; a short/long stored hash simply won't match).
    if (strlen(hash_hex) != 64) return false;
    unsigned diff = 0;
    for (int i = 0; i < 64; i++) diff |= (unsigned)(hex[i] ^ hash_hex[i]);
    return diff == 0;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd tools/cfg-harness && make test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/devcfg/sha256.h components/devcfg/sha256.c components/devcfg/settings_pin.h components/devcfg/settings_pin.c components/devcfg/CMakeLists.txt tools/cfg-harness/Makefile tools/cfg-harness/test_cfg.c
git commit -m "feat(m7): vendored sha256 + settings PIN verify"
```

---

### Task 6: Phase C — Settings UI screens (passive)

**Files:**
- Modify: `components/ui/include/ui.h` (Settings screen API + `ui_consume_longpress`)
- Modify: `components/ui/ui.c` (`LV_EVENT_LONG_PRESSED` flag on the idle screen)
- Create: `components/ui/ui_settings.c`
- Modify: `components/ui/CMakeLists.txt` (add `ui_settings.c`)

**Interfaces:**
- Produces (passive screens, mirroring `ui_wifi.c` — the orchestrator pushes data in, reads intent out via `consume_*`; NO network/reboot in LVGL callbacks):
```c
typedef enum { UI_SET_WIFI, UI_SET_TEST_PRINT, UI_SET_REBOOT, UI_SET_CLOSE } ui_settings_action_t;

bool ui_consume_longpress(void);                 // true once: idle screen long-pressed

void ui_settings_show_pin(void);                 // show numeric keypad; clears entry + error
void ui_settings_pin_set_error(bool show);       // toggle the "Incorrect PIN" line
bool ui_settings_consume_pin(char *out, int cap);// true once on submit; copies digits

void ui_settings_set_info(const char *text);     // device-info block text
void ui_settings_show_menu(void);                // show the menu (info + 4 buttons)
bool ui_settings_consume_action(ui_settings_action_t *act);  // true once on a button
```

This task builds the screens only (no orchestration — that's Task 7). It must compile and load each screen, but the buttons just latch intent.

- [ ] **Step 1: Add the API to ui.h**

In `components/ui/include/ui.h`, after the Wi-Fi section, add the block from **Interfaces** above (the `ui_settings_action_t` enum + the six `ui_settings_*` functions + `ui_consume_longpress`).

- [ ] **Step 2: Long-press flag in ui.c**

In `components/ui/ui.c`, add:
```c
static volatile bool s_longpress = false;
static void on_screen_longpress(lv_event_t *e) { (void)e; s_longpress = true; }
```
Register it on built screens next to the CLICKED/PRESSED handlers in `build_screen`:
```c
    lv_obj_add_event_cb(scr, on_screen_longpress, LV_EVENT_LONG_PRESSED, NULL);
```
Add the consumer (same lock idiom as `ui_consume_tap`):
```c
bool ui_consume_longpress(void) {
    bool v;
    lvgl_port_lock(0);
    v = s_longpress;
    s_longpress = false;
    lvgl_port_unlock();
    return v;
}
```

- [ ] **Step 3: Build `ui_settings.c` mirroring `ui_wifi.c`**

Create `components/ui/ui_settings.c`. **Read `components/ui/ui_wifi.c` first and mirror its structure exactly** — the same `lvgl_port_lock/unlock` discipline, the same static screen objects, the same "set_* mutators / consume_* intent flags" passivity. Implement two screens (one `lv_obj_t *` screen reused/rebuilt, like the Wi-Fi screen):

- **PIN keypad screen** (`ui_settings_show_pin`): a title ("Enter PIN"), a masked entry label, a 3×4 numeric keypad of `lv_button`s (digits 0–9, a backspace, and an "OK"/submit), and a hideable "Incorrect PIN" error label. Digit buttons append to an internal `char s_pin_buf[16]`; backspace trims; submit sets `s_pin_submitted = true` (consumed by `ui_settings_consume_pin`, which copies `s_pin_buf` to `out` and clears the buffer). `ui_settings_pin_set_error(true/false)` toggles the error label and clears the entry on error. Also include a "Cancel" button that latches `UI_SET_CLOSE` via the same action flag used by the menu.
- **Menu screen** (`ui_settings_show_menu`): a title ("Device Settings"), a multi-line info label whose text is set by `ui_settings_set_info`, and four `lv_button`s — "Wi-Fi Setup", "Test Print", "Reboot", "Close" — each latching its `ui_settings_action_t` into `static ui_settings_action_t s_action; static bool s_action_set;` (read+cleared by `ui_settings_consume_action`).

All `ui_settings_*` functions take `lvgl_port_lock(0)` / `lvgl_port_unlock()` around LVGL calls, exactly as `ui_wifi.c` does. No `esp_restart`, no network, no `cloud_*` calls in this file — only flag-setting and label/keypad construction. Use the brand-neutral default theme (these are firmware-chrome screens, not branding-driven).

- [ ] **Step 4: Register the source**

In `components/ui/CMakeLists.txt`, add `ui_settings.c` to the registered `SRCS` (next to `ui_wifi.c`).

- [ ] **Step 5: Build**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: compiles clean. (Toolchain-unavailable note allowed.)

- [ ] **Step 6: Commit**

```bash
git add components/ui/include/ui.h components/ui/ui.c components/ui/ui_settings.c components/ui/CMakeLists.txt
git commit -m "feat(m7): on-device Settings PIN keypad + menu screens"
```

---

### Task 7: Phase C — Settings orchestration

**Files:**
- Modify: `main/app_state.c` (long-press → gate → menu → actions; device-info builder)

**Interfaces:**
- Consumes: `settings_pin_verify` (Task 5); the `ui_settings_*` + `ui_consume_longpress` API (Task 6); the existing Wi-Fi setup orchestration (locate it — likely `main/`, the function that drives `ui_wifi_*` during provisioning); `run_test_ingest` (existing).

On-device wiring; builds clean, verified on hardware.

- [ ] **Step 1: Add includes + the device-info builder**

In `main/app_state.c`, add includes:
```c
#include "settings_pin.h"
#include "esp_netif.h"
#include "esp_idf_version.h"   // only if needed; otherwise omit
```
Add a helper that fills the menu info text from locally-known facts (firmware version, Wi-Fi SSID, signal bars, IP, online). Device name/ID are not stored on-device, so they are intentionally omitted:
```c
static void build_settings_info(char *out, int cap) {
    char ssid[33] = "—";
    int bars = 0;
    char ip[16] = "—";
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
        snprintf(ssid, sizeof(ssid), "%s", (const char *)ap.ssid);
        bars = rssi_to_level(ap.rssi);
    }
    esp_netif_t *nif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    esp_netif_ip_info_t ipi;
    if (nif && esp_netif_get_ip_info(nif, &ipi) == ESP_OK)
        snprintf(ip, sizeof(ip), IPSTR, IP2STR(&ipi.ip));
    snprintf(out, cap,
             "Firmware: %s\nWi-Fi: %s (%d/4)\nIP: %s\nStatus: %s",
             CONFIG_MARATUS_FW_VERSION, ssid, bars, ip,
             net_is_connected() ? "Online" : "Offline");
}
```
(`rssi_to_level` already exists in this file. Confirm the Kconfig symbol name for the firmware version — the repo uses `CONFIG_MARATUS_FW_VERSION`; if it differs, use the actual symbol.)

- [ ] **Step 2: Add the Settings flow**

Add above `poll_task`:
```c
// Locate the existing provisioning Wi-Fi orchestration and expose it as a
// callable, e.g. `void wifi_setup_run(void);` (drives ui_wifi_* to completion).
// If it isn't already a standalone re-enterable function, factor the provisioning
// loop body out into one and call it from both provisioning and here.
extern void wifi_setup_run(void);

static void run_settings_flow(void) {
    const device_config_t *cfg = s_cfg_buf[s_cfg_live];
    ui_settings_action_t act;

    // PIN gate (skipped when no hash configured).
    if (cfg->device.settings_password_hash[0]) {
        ui_settings_show_pin();
        for (;;) {
            char pin[16];
            if (ui_settings_consume_pin(pin, sizeof(pin))) {
                if (settings_pin_verify(pin, cfg->device.settings_password_hash,
                                        cfg->device.settings_password_salt))
                    break;
                ui_settings_pin_set_error(true);
            }
            if (ui_settings_consume_action(&act) && act == UI_SET_CLOSE) {
                ui_render_state(s_state);
                return;
            }
            vTaskDelay(pdMS_TO_TICKS(50));
        }
    }

    // Menu.
    char info[160];
    build_settings_info(info, sizeof(info));
    ui_settings_set_info(info);
    ui_settings_show_menu();
    for (;;) {
        if (ui_settings_consume_action(&act)) {
            switch (act) {
                case UI_SET_WIFI:
                    wifi_setup_run();
                    build_settings_info(info, sizeof(info));
                    ui_settings_set_info(info);
                    ui_settings_show_menu();
                    break;
                case UI_SET_TEST_PRINT:
                    run_test_ingest();      // shows QR, leaves the settings flow
                    return;
                case UI_SET_REBOOT:
                    esp_restart();
                    break;
                case UI_SET_CLOSE:
                    ui_render_state(s_state);
                    return;
            }
        }
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
```

- [ ] **Step 3: Trigger it from the poll loop**

In `poll_task`, after the tap check (Task 4) and before the `net_is_connected()` guard, add:
```c
        if (ui_consume_longpress()) {
            run_settings_flow();
            continue;
        }
```

- [ ] **Step 4: Build**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: compiles clean. If `wifi_setup_run` (or the equivalent provisioning entry point) does not exist as a callable, this build surfaces the missing symbol — factor the provisioning Wi-Fi loop into a re-enterable function in `main/` and call it. (Toolchain-unavailable note allowed, but then the linker check is deferred to the user's build.)

- [ ] **Step 5: Commit**

```bash
git add main/app_state.c
git commit -m "feat(m7): long-press PIN-gated Settings flow (info/wifi/test/reboot)"
```

**On-device verification (USER step):** long-press idle → keypad → wrong PIN shows error, correct PIN opens the menu → info shows firmware/Wi-Fi/IP/status → Wi-Fi Setup opens the existing screen → Test Print runs the self-test → Reboot restarts → with no PIN set, long-press opens the menu directly.

---

### Task 8: HIL verification + BUILD.md

**Files:**
- Modify: `BUILD.md` (M7 entry)

This task is the on-device acceptance pass — performed by the USER at the board after flashing the branch.

- [ ] **Step 1: Flash**

User runs (their terminal):
```bash
cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh
idf.py -p <USB-UART-port> flash
```

- [ ] **Step 2: Verify all three phases** (check each)

- [ ] Brightness: change in admin → panel brightness follows within ~12s.
- [ ] Sleep: enable with a short timeout → screen blanks after timeout.
- [ ] Wake on touch: a touch lights the screen and does NOT trigger a test ingest.
- [ ] Wake on receipt: print/ingest while asleep → screen lights and shows the QR.
- [ ] Sleep off: disabling sleep keeps the panel on.
- [ ] PIN: long-press → keypad → wrong PIN errors, right PIN opens menu.
- [ ] Menu info shows firmware/Wi-Fi/IP/status; Wi-Fi Setup, Test Print, Reboot, Close all work.
- [ ] No PIN set: long-press opens the menu directly (ungated).

- [ ] **Step 3: Record results in BUILD.md**

Add an M7 entry to `BUILD.md` summarizing what shipped and the HIL results, matching the style of the existing milestone entries.

- [ ] **Step 4: Commit**

```bash
git add BUILD.md
git commit -m "docs(m7): BUILD.md M7 device-policies HIL results"
```

---

## Self-Review

**Spec coverage:**
- Config model + `device` block parse → Task 1. ✓
- Phase A brightness (apply on config-apply + boot) → Task 2. ✓
- Phase B sleep decision + integration + wake-on-touch + wake-on-receipt + wake guard + sleep-disabled → Tasks 3, 4. ✓
- Phase C PIN verify (SHA-256, constant-time, ungated when empty) → Task 5; keypad + menu screens → Task 6; long-press entry + gate + info + Wi-Fi/Test/Reboot/Close → Task 7. ✓
- Host tests for parser, should_sleep, pin verify → Tasks 1, 3, 5. ✓
- HIL acceptance → Task 8. ✓
- No cloud changes → consistent (firmware-only). ✓

**Deviations from the spec (intentional, flagged):**
- PIN uses a **vendored SHA-256** (host-testable) rather than mbedtls — keeps `settings_pin_verify` a pure, host-tested function (the milestone's automated gate), matching how the repo already vendors crypto (`vendor/sha1.c`).
- Settings device-info shows **firmware/Wi-Fi/IP/status** only; **device name + ID are omitted** because the device doesn't store them locally. (Confirm with the user if a name/ID source is desired.)

**Placeholder scan:** No TBD/TODO. The one place that names an existing-but-unread symbol — the provisioning Wi-Fi orchestration reused in Task 7 (`wifi_setup_run`) — is explicitly called out as "locate/factor it," with the build/link check as the gate. UI screen construction in Task 6 references `ui_wifi.c` as the concrete pattern rather than reproducing ~300 lines of LVGL verbatim; the header API and per-widget behavior are fully specified.

**Type consistency:** `device_config_t.device.*` field names match across Tasks 1/2/4/7. `should_sleep` signature matches between Task 3 (def) and Task 4 (call). `settings_pin_verify` signature matches Task 5 (def) and Task 7 (call). `ui_settings_action_t` enumerators (`UI_SET_WIFI/TEST_PRINT/REBOOT/CLOSE`) and the `ui_settings_*`/`ui_consume_*` names match between Task 6 (def) and Task 7 (use). `display_apply_brightness` / `s_display_asleep` introduced in Task 2 and reused in Task 4.
