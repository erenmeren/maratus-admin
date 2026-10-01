# M6a Firmware — On-screen provisioning + claim-poll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unprovisioned maratus-firmware device (no key in NVS) boots into a setup screen showing a device-generated pairing code, polls the cloud's `GET /api/device/claim`, stores the returned key in NVS, and activates — no hand-pasted keys.

**Architecture:** A new pure `provisioning` module (devcfg) generates the pairing code and a built-in default setup screen (an unclaimed device can't fetch config — no key — so the setup UI must be firmware-built-in). `appcfg_device_key()` reads NVS first, falling back to Kconfig. On boot, if no key, the app enters `DEV_SETUP`, renders the built-in setup screen, and runs a claim-poll loop (`cloud_claim_poll`, unauthenticated GET) until it gets the key → NVS → reboot into normal mode. Two new LVGL widgets (`OBJ_PAIRING_CODE`, `OBJ_STEPS`) render the code + steps.

**Tech Stack:** ESP-IDF 5.5 (C), LVGL v9, esp_http_client + cJSON, NVS. Host tests via `tools/cfg-harness` (`make -C tools/cfg-harness test`). Build: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`. Flash: `idf.py -p /dev/cu.usbmodem5A671704091 flash`. Repo: `/Users/eren/Projects/maratus-firmware`.

This is **Plan 2 of 2** for M6a; it consumes the cloud endpoint from Plan 1 (`GET /api/device/claim?code=` → `{status:"pending"}` or `{status:"claimed", deviceKey}`). Spec: `docs/superpowers/specs/2026-06-18-firmware-m6a-provisioning-design.md`. Work on a new branch `feat/m6a-provisioning` off firmware `main`.

**Wi-Fi stays from Kconfig this slice** (on-screen Wi-Fi = M6a-2).

---

### Task 0: Branch

- [ ] **Step 1:** From `/Users/eren/Projects/maratus-firmware` on `main` (clean): `git checkout -b feat/m6a-provisioning`.

---

### Task 1: Pairing-code generator (pure, host-tested)

A device pairing code in the admin's human-typeable format `XXXX-XXXX` from the unambiguous alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (matches `lib/ids.ts` `pairingCode()` in admin). Pure: takes a byte source so it's deterministic in tests.

**Files:**
- Create: `components/devcfg/provisioning.c`, `components/devcfg/include/provisioning.h`
- Modify: `components/devcfg/CMakeLists.txt` (add source), `tools/cfg-harness/Makefile` (add source)
- Test: `tools/cfg-harness/test_cfg.c`

- [ ] **Step 1: Write the header**

Create `components/devcfg/include/provisioning.h`:
```c
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

// Pairing code: "XXXX-XXXX" (8 chars from an unambiguous alphabet + dash). Needs
// 9 bytes + NUL. `rand_byte` supplies entropy (esp_random on device; deterministic
// in tests). Writes into out (must be >= 10 bytes); returns false if out too small.
bool provisioning_make_code(char *out, size_t out_len, uint8_t (*rand_byte)(void));

// Parse the claim-poll JSON response. On a "claimed" body with a deviceKey, copies
// it into key_out (size key_len) and returns true. Returns false for "pending",
// missing key, or malformed JSON. key_out is always NUL-terminated.
bool provisioning_parse_claim(const char *json, char *key_out, size_t key_len);
```

- [ ] **Step 2: Write failing tests**

In `tools/cfg-harness/test_cfg.c`, add `#include "provisioning.h"` near the other includes, add this test, and call `test_provisioning();` from `main()`:
```c
static uint8_t seq_byte(void) { static uint8_t n; return n++; }

static void test_provisioning(void) {
    char code[16];
    assert(provisioning_make_code(code, sizeof(code), seq_byte));
    // format: 4 + dash + 4
    assert(strlen(code) == 9);
    assert(code[4] == '-');
    const char *ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (int i = 0; i < 9; i++) {
        if (i == 4) continue;
        assert(strchr(ALPHA, code[i]) != NULL);   // only unambiguous chars
    }
    // too-small buffer rejected
    char tiny[5];
    assert(!provisioning_make_code(tiny, sizeof(tiny), seq_byte));

    // claim parse
    char key[64];
    assert(provisioning_parse_claim("{\"status\":\"claimed\",\"deviceKey\":\"dvk_xyz\"}", key, sizeof(key)));
    assert(strcmp(key, "dvk_xyz") == 0);
    assert(!provisioning_parse_claim("{\"status\":\"pending\"}", key, sizeof(key)));
    assert(key[0] == '\0');
    assert(!provisioning_parse_claim("not json", key, sizeof(key)));
    printf("test_provisioning OK\n");
}
```

- [ ] **Step 3: Run to verify failure**

Run: `make -C tools/cfg-harness test`
Expected: FAIL — `provisioning.h` not found / undefined references.

- [ ] **Step 4: Implement**

Create `components/devcfg/provisioning.c`:
```c
#include "provisioning.h"
#include <string.h>
#include "cJSON.h"

static const char ALPHA[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no ambiguous

bool provisioning_make_code(char *out, size_t out_len, uint8_t (*rand_byte)(void)) {
    if (!out || out_len < 10 || !rand_byte) return false;
    int j = 0;
    for (int i = 0; i < 8; i++) {
        if (i == 4) out[j++] = '-';
        out[j++] = ALPHA[rand_byte() & 31];   // 32-char alphabet → mask 5 bits
    }
    out[j] = '\0';
    return true;
}

bool provisioning_parse_claim(const char *json, char *key_out, size_t key_len) {
    if (key_out && key_len) key_out[0] = '\0';
    if (!json || !key_out || key_len == 0) return false;
    cJSON *root = cJSON_Parse(json);
    if (!root) return false;
    bool ok = false;
    const char *k = cJSON_GetStringValue(cJSON_GetObjectItem(root, "deviceKey"));
    if (k && k[0]) {
        strncpy(key_out, k, key_len - 1);
        key_out[key_len - 1] = '\0';
        ok = true;
    }
    cJSON_Delete(root);
    return ok;
}
```

- [ ] **Step 5: Wire the build**

In `components/devcfg/CMakeLists.txt`, add `"provisioning.c"` to the component `SRCS`.
In `tools/cfg-harness/Makefile`, add `../../components/devcfg/provisioning.c` to `SRCS` (cJSON is already vendored there as `vendor/cJSON.c`).

- [ ] **Step 6: Run tests to verify pass**

Run: `make -C tools/cfg-harness test`
Expected: PASS — `test_provisioning OK` and `ALL TESTS PASSED`.

- [ ] **Step 7: Commit**

```bash
git add components/devcfg/provisioning.c components/devcfg/include/provisioning.h components/devcfg/CMakeLists.txt tools/cfg-harness/Makefile tools/cfg-harness/test_cfg.c
git commit -m "feat(firmware): pairing-code generator + claim-poll parser (host-tested)"
```

---

### Task 2: Built-in default setup config

An unclaimed device has no key → cannot GET /api/device/config → no server config. So the setup screen must be firmware-built-in. Add a function that fills a `device_config_t` with brand defaults + a `SCREEN_SETUP` screen containing a title (text), a `steps` widget, and a `pairingCode` widget. Positions mirror the admin `seededScreen("setup")` (logo 0.34,0.05; title 0.1,0.18; sub 0.15,0.26; steps 0.18,0.34 w0.64 h0.28; pairingCode 0.25,0.66 w0.3 h0.12).

**Files:**
- Modify: `components/devcfg/provisioning.c` / `provisioning.h` (add `provisioning_default_setup_config`)
- Test: `tools/cfg-harness/test_cfg.c`

- [ ] **Step 1: Add the declaration**

In `provisioning.h`:
```c
#include "device_config.h"

// Fill cfg with a firmware-built-in setup screen (brand defaults + title, steps,
// and a pairingCode widget) for an unprovisioned device that can't fetch config.
// Sets cfg->valid = true. Other screens are left empty.
void provisioning_default_setup_config(device_config_t *cfg);
```

- [ ] **Step 2: Write the failing test**

In `test_cfg.c` `test_provisioning()`, append:
```c
    device_config_t pc;
    provisioning_default_setup_config(&pc);
    assert(pc.valid);
    cfg_screen_t *setup = &pc.screens[SCREEN_SETUP];
    bool has_code = false, has_steps = false;
    for (int i = 0; i < setup->n; i++) {
        if (setup->objects[i].type == OBJ_PAIRING_CODE) has_code = true;
        if (setup->objects[i].type == OBJ_STEPS) has_steps = true;
    }
    assert(has_code && has_steps);
```
Run `make -C tools/cfg-harness test` → FAIL (undefined `provisioning_default_setup_config`).

- [ ] **Step 3: Implement**

In `provisioning.c` (read `components/devcfg/include/device_config.h` first to use the exact `device_config_t` / `cfg_object_t` field names — `brand_bg`, `brand_fg`, `brand_accent`, `screens[]`, each screen's `objects[]` + `n`, and object fields `type,x,y,w,h,z,visible,text,font_size,align`):
```c
void provisioning_default_setup_config(device_config_t *cfg) {
    memset(cfg, 0, sizeof(*cfg));
    cfg->brand_bg = 0x0B5D3B;     // Maratus green fallback
    cfg->brand_fg = 0xFFFFFF;
    cfg->brand_accent = 0x10A765;
    cfg_screen_t *s = &cfg->screens[SCREEN_SETUP];
    int i = 0;
    // title
    cfg_object_t *t = &s->objects[i++];
    t->type = OBJ_TEXT; t->visible = true; t->x = 0.1f; t->y = 0.14f; t->w = 0.8f; t->h = 0.08f;
    t->font_size = 34; t->align = CFG_ALIGN_CENTER; t->z = 0;
    strncpy(t->text, "Pair this device", CFG_TEXT_LEN - 1);
    // steps
    cfg_object_t *st = &s->objects[i++];
    st->type = OBJ_STEPS; st->visible = true; st->x = 0.18f; st->y = 0.34f; st->w = 0.64f; st->h = 0.28f; st->z = 1;
    // pairing code
    cfg_object_t *pc = &s->objects[i++];
    pc->type = OBJ_PAIRING_CODE; pc->visible = true; pc->x = 0.2f; pc->y = 0.66f; pc->w = 0.6f; pc->h = 0.14f; pc->z = 2;
    s->n = i;
    cfg->valid = true;
}
```
(If `device_config.h` field names differ from the above, adapt to the actual names; do not invent fields. If `CFG_TEXT_LEN` / `CFG_ALIGN_CENTER` are named differently, use the actual names.)

- [ ] **Step 4: Verify** — `make -C tools/cfg-harness test` → PASS.

- [ ] **Step 5: Commit**
```bash
git add components/devcfg/provisioning.c components/devcfg/include/provisioning.h tools/cfg-harness/test_cfg.c
git commit -m "feat(firmware): built-in default setup-screen config for provisioning"
```

---

### Task 3: NVS device-key + pairing-code persistence; appcfg NVS fallback

Store the claimed key + the device-generated code in NVS (namespace `"ditto"`, keys `"device_key"`, `"pairing_code"`), mirroring `cloud.c`'s `cfg_save_nvs`/`cloud_config_load_cached`. Make `appcfg_device_key()` return the NVS key when present, else the Kconfig default.

**Files:**
- Modify: `components/appcfg/appcfg.c`, `components/appcfg/include/appcfg.h`
- (appcfg's CMakeLists must depend on `nvs_flash` — add to `REQUIRES` if missing.)

- [ ] **Step 1: Add accessors to `appcfg.h`**
```c
// Provisioning (NVS-backed). Namespace "ditto".
bool appcfg_has_device_key(void);                 // true if a key is stored in NVS
void appcfg_store_device_key(const char *key);    // persist claimed key to NVS
const char *appcfg_pairing_code(void);            // cached code (generates+persists on first call if absent)
```

- [ ] **Step 2: Implement in `appcfg.c`**

Read the current `appcfg.c` first. Add (using `nvs.h`, the `"maratus"` namespace, and static buffers so the returned `const char *` stays valid):
```c
#include <string.h>
#include <stdbool.h>
#include "nvs.h"
#include "esp_random.h"
#include "provisioning.h"

#define MARATUS_NS "maratus"
static char s_dev_key[80];
static char s_pair[16];

static bool nvs_read(const char *key, char *out, size_t cap) {
    nvs_handle_t h; out[0] = '\0';
    if (nvs_open(MARATUS_NS, NVS_READONLY, &h) != ESP_OK) return false;
    size_t len = cap;
    esp_err_t e = nvs_get_str(h, key, out, &len);
    nvs_close(h);
    return e == ESP_OK && out[0];
}
static void nvs_write(const char *key, const char *val) {
    nvs_handle_t h;
    if (nvs_open(MARATUS_NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_str(h, key, val); nvs_commit(h); nvs_close(h);
}
static uint8_t rand_byte(void) { return (uint8_t)esp_random(); }

bool appcfg_has_device_key(void) {
    char tmp[80];
    return nvs_read("device_key", tmp, sizeof(tmp));
}
void appcfg_store_device_key(const char *key) {
    if (key && key[0]) nvs_write("device_key", key);
}
const char *appcfg_device_key(void) {
    if (nvs_read("device_key", s_dev_key, sizeof(s_dev_key))) return s_dev_key;
    return CONFIG_DITTO_DEVICE_KEY;   // Kconfig fallback (dev)
}
const char *appcfg_pairing_code(void) {
    if (s_pair[0]) return s_pair;
    if (nvs_read("pairing_code", s_pair, sizeof(s_pair))) return s_pair;
    provisioning_make_code(s_pair, sizeof(s_pair), rand_byte);
    nvs_write("pairing_code", s_pair);
    return s_pair;
}
```
Add `nvs_flash`, `esp_hw_support` (for esp_random), and `devcfg` to `components/appcfg/CMakeLists.txt` `REQUIRES`.

- [ ] **Step 3: Build** — `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`. Expected: compiles clean.

- [ ] **Step 4: Commit**
```bash
git add components/appcfg
git commit -m "feat(firmware): NVS-backed device key + pairing code (appcfg)"
```

---

### Task 4: `cloud_claim_poll` (unauthenticated claim GET)

**Files:** Modify `components/cloud/cloud.c`, `components/cloud/include/cloud.h`.

- [ ] **Step 1: Declare in `cloud.h`**
```c
// Poll GET /api/device/claim?code= (UNAUTHENTICATED). On a claimed response with a
// device key, copies it into key_out (size key_len) and returns true. Returns false
// while pending or on error. key_out is NUL-terminated.
bool cloud_claim_poll(const char *code, char *key_out, size_t key_len);
```

- [ ] **Step 2: Implement in `cloud.c`**

Mirror `cloud_get_commands` (read it first) but with NO Authorization header and parse via `provisioning_parse_claim`:
```c
bool cloud_claim_poll(const char *code, char *key_out, size_t key_len) {
    if (key_out && key_len) key_out[0] = '\0';
    char body[256];
    resp_t resp = { .buf = body, .cap = sizeof(body), .len = 0 };
    char url[256];
    snprintf(url, sizeof(url), "%s/api/device/claim?code=%s", appcfg_base_url(), code);
    esp_http_client_config_t cfg = {
        .url = url, .method = HTTP_METHOD_GET, .event_handler = on_evt,
        .user_data = &resp, .crt_bundle_attach = esp_crt_bundle_attach, .timeout_ms = 10000,
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    bool got = false;
    if (esp_http_client_perform(c) == ESP_OK) {
        int status = esp_http_client_get_status_code(c);
        body[resp.len] = '\0';
        ESP_LOGI(TAG, "GET /claim -> %d", status);
        if (status == 200) got = provisioning_parse_claim(body, key_out, key_len);
    } else {
        ESP_LOGW(TAG, "GET /claim failed");
    }
    esp_http_client_cleanup(c);
    return got;
}
```
Add `#include "provisioning.h"` to cloud.c and ensure the `cloud` component `REQUIRES` `devcfg` (it likely already does — verify).

- [ ] **Step 3: Build** — `idf.py build` clean.

- [ ] **Step 4: Commit**
```bash
git add components/cloud
git commit -m "feat(firmware): cloud_claim_poll unauthenticated claim GET"
```

---

### Task 5: Pairing-code + steps widgets (LVGL)

Implement `render_pairing_code` (large mono-ish code, centered — matches admin `PairingCodeObject`) and `render_steps` (numbered lines — matches `StepsObject`), add a `ui_set_pairing_code(code)` setter (mirror `ui_set_qr_url`), wire both into `build_screen`'s switch.

**Files:** Modify `components/ui/ui.c`, `components/ui/include/ui.h`.

- [ ] **Step 1: Add setter + static** — read `ui.c` (the `s_qr_url` static + `ui_set_qr_url` at ~462). Add a `static char s_pairing_code[16];` and:
```c
void ui_set_pairing_code(const char *code) {
    lvgl_port_lock(0);
    if (!code) s_pairing_code[0] = '\0';
    else { strncpy(s_pairing_code, code, sizeof(s_pairing_code) - 1); s_pairing_code[sizeof(s_pairing_code) - 1] = '\0'; }
    lvgl_port_unlock();
}
```
Declare `void ui_set_pairing_code(const char *code);` in `ui.h`.

- [ ] **Step 2: Implement the two render fns** (model on `render_text`/`render_clock`; box from `geom_box(o)`):
```c
static void render_pairing_code(lv_obj_t *scr, const cfg_object_t *o, uint32_t fg) {
    px_box_t b = geom_box(o);
    int box_h = b.h > 0 ? b.h : 80;
    lv_obj_t *lbl = lv_label_create(scr);
    lv_obj_set_width(lbl, b.w > 0 ? b.w : LV_SIZE_CONTENT);
    lv_label_set_text(lbl, s_pairing_code[0] ? s_pairing_code : "----");
    lv_obj_set_style_text_color(lbl, lv_color_hex(fg), LV_PART_MAIN);
    lv_obj_set_style_text_font(lbl, font_cache_get(box_h * 2 / 3, true), LV_PART_MAIN); // bold, large
    lv_obj_set_style_text_align(lbl, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_obj_set_style_text_letter_space(lbl, 2, LV_PART_MAIN);
    lv_obj_set_pos(lbl, b.x, b.y);
}

static const char *const SETUP_STEPS[] = {
    "1.  Open your Maratus dashboard",
    "2.  Add a printer to a store",
    "3.  Enter the code below",
};
static void render_steps(lv_obj_t *scr, const cfg_object_t *o, uint32_t fg) {
    px_box_t b = geom_box(o);
    int n = (int)(sizeof(SETUP_STEPS) / sizeof(SETUP_STEPS[0]));
    int fs = o->font_size > 0 ? o->font_size : 22;
    int line_h = (b.h > 0 ? b.h : 120) / n;
    for (int i = 0; i < n; i++) {
        lv_obj_t *lbl = lv_label_create(scr);
        lv_obj_set_width(lbl, b.w > 0 ? b.w : LV_SIZE_CONTENT);
        lv_label_set_text(lbl, SETUP_STEPS[i]);
        lv_obj_set_style_text_color(lbl, lv_color_hex(fg), LV_PART_MAIN);
        lv_obj_set_style_text_font(lbl, font_cache_get(fs, false), LV_PART_MAIN);
        lv_obj_set_pos(lbl, b.x, b.y + i * line_h);
    }
}
```

- [ ] **Step 3: Wire the switch** — in `build_screen`, replace the `default→placeholder` fall-through for these types with explicit cases:
```c
        case OBJ_PAIRING_CODE: render_pairing_code(scr, o, s_cfg->brand_fg); break;
        case OBJ_STEPS:        render_steps(scr, o, s_cfg->brand_fg); break;
```

- [ ] **Step 4: Build** — `idf.py build` clean.

- [ ] **Step 5: Commit**
```bash
git add components/ui
git commit -m "feat(firmware): pairingCode + steps widgets for the setup screen"
```

---

### Task 6: Boot decision + claim-poll task

On boot, if `appcfg_has_device_key()` is false → provisioning mode: render the built-in setup config (with the device's pairing code) and run a claim-poll task; on success store the key and reboot. Otherwise normal flow.

**Files:** Modify `main/app_main.c`; add a small provisioning task (in `main/app_main.c` or a new `main/provisioning_task.c`).

- [ ] **Step 1: Add the provisioning entry** — in `app_main.c`, read the boot flow (steps 2b→4). After Wi-Fi is up (`net_start()`), branch:
```c
    if (!appcfg_has_device_key()) {
        // Unprovisioned: show the built-in setup screen with our pairing code, poll to claim.
        static device_config_t setup_cfg;
        provisioning_default_setup_config(&setup_cfg);
        ui_set_config(&setup_cfg);
        ui_set_pairing_code(appcfg_pairing_code());
        ui_render_state(DEV_SETUP);
        xTaskCreate(provisioning_task, "ditto_provision", 8192, NULL, 5, NULL);
        return;   // do NOT start the normal poll/ingest path until claimed
    }
```
Place this AFTER `net_start()` and `assets_fs_mount()` but BEFORE `app_state_run()`/`escpos_server_start()`. Include `provisioning.h` and `appcfg.h`.

- [ ] **Step 2: Implement `provisioning_task`** (in app_main.c above app_main, or a new file added to `main/CMakeLists.txt`):
```c
static void provisioning_task(void *arg) {
    (void)arg;
    const char *code = appcfg_pairing_code();
    char key[80];
    for (;;) {
        if (net_is_connected() && cloud_claim_poll(code, key, sizeof(key))) {
            ESP_LOGI(TAG, "claimed; storing device key + rebooting");
            appcfg_store_device_key(key);
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_restart();   // clean transition into normal mode with the new key
        }
        vTaskDelay(pdMS_TO_TICKS(3000));   // poll every ~3s
    }
}
```
(`esp_restart` from `esp_system.h`. Reboot is the chosen activation transition — simplest, avoids re-init ordering.)

- [ ] **Step 3: Build** — `idf.py build` clean.

- [ ] **Step 4: Commit**
```bash
git add main
git commit -m "feat(firmware): boot into provisioning mode + claim-poll task when unkeyed"
```

---

### Task 7: Host tests green + on-device HIL verification

- [ ] **Step 1: Host tests** — `make -C tools/cfg-harness test` → ALL TESTS PASSED.
- [ ] **Step 2: Build** — `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build` → clean.
- [ ] **Step 3: Erase NVS + flash** — to force provisioning mode on a previously-keyed device:
  `idf.py -p /dev/cu.usbmodem5A671704091 erase-flash` then `idf.py -p /dev/cu.usbmodem5A671704091 flash`.
  (Erase wipes the stored key + code so the device boots unprovisioned. The cloud (Plan 1) must be running/deployed and reachable; set `MARATUS_API_BASE_URL` to it.)
- [ ] **Step 4: HIL checklist (needs user + board + the Plan-1 cloud reachable):**
  - Device boots to the **setup screen**: title, numbered steps, and a `XXXX-XXXX` pairing code.
  - In the dashboard (Plan 1 cloud), claim a store with that code.
  - Within ~3s the device logs "claimed; storing device key + rebooting", reboots, and lands on the **idle** screen.
  - A receipt (ESC/POS harness) round-trips → the device is fully active.
  - Power-cycle → device boots straight to idle (key persisted in NVS; no re-provision).
- [ ] **Step 5:** Add a BUILD.md M6a validation-log entry; then this branch is ready to merge alongside the Plan-1 cloud branch (deploy cloud + firmware together).

---

## Self-Review

**Spec coverage (firmware section of the M6a spec):**
- Boot decision (NVS key present/absent) → Task 6. ✓
- Device-generated `XXXX-XXXX` code, persisted in NVS → Tasks 1 + 3. ✓
- Built-in setup screen (an unkeyed device can't fetch config) → Task 2 (resolves spec gap #8). ✓
- `pairingCode` + `steps` widgets → Task 5. ✓
- `cloud_claim_poll` unauthenticated GET + parse → Tasks 1 (parser) + 4 (HTTP). ✓
- Key → NVS, activate via reboot → Tasks 3 + 6. ✓
- `appcfg_device_key()` NVS-first, Kconfig fallback → Task 3. ✓
- Tests: pure code-gen/parser/default-config host-tested (Tasks 1–2); device glue build-verified + HIL (Task 7). ✓
- Wi-Fi stays Kconfig (out of scope) ✓.

**Placeholder scan:** all code provided; the only "adapt to actual field names" notes (Tasks 2, 5) are explicit instructions to match real `device_config.h`/`ui.c` identifiers, with the fallback rule "don't invent fields."

**Type/name consistency:** `provisioning_make_code` / `provisioning_parse_claim` / `provisioning_default_setup_config` (Tasks 1–2) are used consistently by appcfg (Task 3), cloud (Task 4), and app_main (Task 6). `appcfg_has_device_key`/`appcfg_store_device_key`/`appcfg_pairing_code`/`ui_set_pairing_code` declared where defined and called in Task 6. NVS namespace `"ditto"` + keys `"device_key"`/`"pairing_code"` consistent across appcfg.

**Risk note:** Task 6's `return` from `app_main` after spawning the provisioning task means the ESC/POS server + normal poll don't start until after the post-claim reboot — intended. Verify on HW that the reboot path cleanly re-enters normal mode with the NVS key.
