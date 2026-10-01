# On-Device "About" + "Device settings" (local override) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add two navigable Settings sub-screens to the firmware: **About** (read-only device info) and **Device settings** (interactive brightness + sleep that the device persists locally and applies *instead of* the admin's pushed policy).

**Architecture:** A pure, host-tested override module (`components/devcfg/overrides.c`) computes effective brightness/sleep from a local override + the cloud value, and reconciles (clears) an override when the admin changes that policy. app_state.c persists overrides in NVS, loads at boot, and uses the *effective* values for backlight + sleep. `ui_settings.c` gains two passive builders; `run_settings_flow` gains sub-screen navigation (menu → sub-screen → back).

**Tech Stack:** ESP32-P4, ESP-IDF 5.5, LVGL 9.3, C11. Pure logic host-tested via `tools/cfg-harness` (`make test`); UI verified on hardware.

## Global Constraints
- Repo **maratus-firmware**, branch **`feat/swipe-up-settings`**. Never commit on `main`.
- Build: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`; if kconfig complains, `export ESP_IDF_VERSION=5.5` (NEVER 5.5.4 — breaks Wi-Fi transport, see BUILD.md). Do NOT modify sdkconfig/Kconfig.
- Host tests: `cd tools/cfg-harness && make test` → `ALL TESTS PASSED`.
- Pure override logic lives in `components/devcfg/overrides.{c,h}` with NO esp/NVS/LVGL deps (host-testable), mirroring `sleep_policy.c`.
- LVGL callbacks stay PASSIVE (flags/values only); cross-thread flags `volatile`, public fns take `lvgl_port_lock(0)`.
- NVS namespace is `"ditto"` (see `appcfg.c`/`cloud.c`). Use `nvs_get_i32`/`nvs_set_i32` for overrides.
- Config fields: `cfg->device.brightness` (10..100), `cfg->device.sleep.enabled`, `cfg->device.sleep.timeout_seconds` (30..3600).
- Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Override model (the contract every task shares)
Encode each setting as one int:
- **brightness override** `ovr_br`: `-1` = follow admin, else `10..100`.
- **sleep override** `ovr_sl`: `-1` = follow admin, `0` = sleep OFF, `>0` = enabled with that timeout in seconds.
- Cloud sleep is encoded the same way: `cloud_sl = cfg->device.sleep.enabled ? cfg->device.sleep.timeout_seconds : 0`.

Each override stores the **baseline** cloud value captured when it was set (`ovr_br_base`, `ovr_sl_base`).
- **Reconcile (admin takes control back):** on each config apply, if an override is active AND the current cloud value differs from its stored baseline, clear that override (set to `-1`).
- **Effective:** `eff = (ovr >= 0) ? ovr : cloud`.
- Sleep "Off" options offered on-screen: Off / 1 / 2 / 5 / 10 min → encodes to `0 / 60 / 120 / 300 / 600`.

---

### Task 1: Pure override module (`overrides.c`) + host tests

**Files:** Create `components/devcfg/include/overrides.h`, `components/devcfg/overrides.c`; Modify `components/devcfg/CMakeLists.txt`, `tools/cfg-harness/Makefile`, `tools/cfg-harness/test_cfg.c`.

**Interfaces (Produces):**
```c
typedef struct {
    int brightness;       // -1 follow, else 10..100
    int brightness_base;  // cloud brightness captured when set
    int sleep;            // -1 follow, 0 off, >0 timeout secs
    int sleep_base;       // cloud sleep (encoded) captured when set
} overrides_t;

void overrides_init(overrides_t *o);                         // all -1
void override_set_brightness(overrides_t *o, int val, int cloud_now);
void override_clear_brightness(overrides_t *o);
void override_set_sleep(overrides_t *o, int encoded, int cloud_now);
void override_clear_sleep(overrides_t *o);
// Clear an override whose baseline no longer matches the cloud (admin changed it).
void override_reconcile(overrides_t *o, int cloud_brightness, int cloud_sleep_encoded);
int  override_eff_brightness(const overrides_t *o, int cloud_brightness);
int  override_eff_sleep(const overrides_t *o, int cloud_sleep_encoded);   // returns encoded
```

- [ ] **Step 1: Write failing host tests** in `tools/cfg-harness/test_cfg.c` (add `#include "overrides.h"`, a `test_overrides()` near `test_should_sleep`, and call it in `main()`):
```c
static void test_overrides(void) {
    overrides_t o; overrides_init(&o);
    assert(o.brightness == -1 && o.sleep == -1);
    // no override -> effective follows cloud
    assert(override_eff_brightness(&o, 54) == 54);
    assert(override_eff_sleep(&o, 300) == 300);
    // set brightness override -> wins
    override_set_brightness(&o, 80, 54);
    assert(override_eff_brightness(&o, 54) == 80);
    // admin unchanged (still 54) -> override holds
    override_reconcile(&o, 54, 300);
    assert(o.brightness == 80);
    // admin changed brightness (now 30) -> override cleared, follows cloud
    override_reconcile(&o, 30, 300);
    assert(o.brightness == -1);
    assert(override_eff_brightness(&o, 30) == 30);
    // sleep override: off
    override_set_sleep(&o, 0, 300);
    assert(override_eff_sleep(&o, 300) == 0);
    override_reconcile(&o, 30, 300);   // cloud sleep unchanged (300) -> holds
    assert(o.sleep == 0);
    override_reconcile(&o, 30, 600);   // admin changed sleep -> cleared
    assert(o.sleep == -1 && override_eff_sleep(&o, 600) == 600);
    override_clear_brightness(&o); override_clear_sleep(&o);
    assert(o.brightness == -1 && o.sleep == -1);
    printf("test_overrides OK\n");
}
```
- [ ] **Step 2: Run, watch it fail** (`make clean && make test` → undefined symbols).
- [ ] **Step 3: Implement** `overrides.h` (the interface above) and `overrides.c`:
```c
#include "overrides.h"
void overrides_init(overrides_t *o){ o->brightness=o->brightness_base=-1; o->sleep=o->sleep_base=-1; }
void override_set_brightness(overrides_t *o,int v,int base){ o->brightness=v; o->brightness_base=base; }
void override_clear_brightness(overrides_t *o){ o->brightness=-1; o->brightness_base=-1; }
void override_set_sleep(overrides_t *o,int e,int base){ o->sleep=e; o->sleep_base=base; }
void override_clear_sleep(overrides_t *o){ o->sleep=-1; o->sleep_base=-1; }
void override_reconcile(overrides_t *o,int cb,int cs){
    if(o->brightness>=0 && cb!=o->brightness_base) override_clear_brightness(o);
    if(o->sleep>=0 && cs!=o->sleep_base) override_clear_sleep(o);
}
int override_eff_brightness(const overrides_t *o,int cb){ return o->brightness>=0 ? o->brightness : cb; }
int override_eff_sleep(const overrides_t *o,int cs){ return o->sleep>=0 ? o->sleep : cs; }
```
Add `"overrides.c"` to `components/devcfg/CMakeLists.txt` SRCS and `../../components/devcfg/overrides.c` to the cfg-harness Makefile SRCS.
- [ ] **Step 4: Run tests** → `test_overrides OK`, `ALL TESTS PASSED`.
- [ ] **Step 5: Commit** (`feat(devcfg): pure local-override model for brightness/sleep`).

---

### Task 2: NVS persistence + effective-value integration (no UI)

**Files:** Modify `main/app_state.c` (load overrides at boot, persist helper, use effective values, reconcile on config apply).

**Interfaces (Produces, file-static in app_state.c):**
- `static overrides_t g_ovr;`
- `static void overrides_load(void);` / `static void overrides_save(void);` — NVS `"ditto"` keys `ovr_br`,`ovr_br_b`,`ovr_sl`,`ovr_sl_b` via `nvs_get_i32`/`nvs_set_i32` (default -1 when absent).
- `static int cloud_sleep_encoded(const device_config_t*);` → `enabled ? timeout_seconds : 0`.
- These are consumed by Task 4's device-settings handlers (it sets g_ovr + calls overrides_save).

- [ ] **Step 1:** Add `#include "overrides.h"` and `#include "nvs_flash.h"`/`nvs.h` (check existing includes) to app_state.c. Add `g_ovr` + `overrides_load/save` + `cloud_sleep_encoded`. Call `overrides_load()` once in `app_state_run()`/init before the poll loop (find where init happens — near where the first render/NVS use is).
- [ ] **Step 2:** In the config-apply block (poll_task, where `display_apply_brightness(s_cfg_buf[next]->device.brightness)` is called, ~line 376): FIRST `override_reconcile(&g_ovr, next->device.brightness, cloud_sleep_encoded(next));` then if reconcile changed anything `overrides_save();` then apply **effective** brightness: `display_apply_brightness(override_eff_brightness(&g_ovr, next->device.brightness));`.
- [ ] **Step 3:** In `idle_wait_or_qr_expiry`, replace the sleep decision inputs with effective sleep: compute `int es = override_eff_sleep(&g_ovr, cloud_sleep_encoded(cfg));` then `bool sleep_en = es > 0; int sleep_to = es > 0 ? es : 0;` and feed `should_sleep(now, last, sleep_to, sleep_en, s_state)` / the enabled branch. Keep the existing wake logic; just source enabled/timeout from `es`. When `es == 0` (off) treat as sleep disabled (ensure panel on).
- [ ] **Step 4:** At boot apply effective brightness once where boot brightness is set (search `display_apply_brightness` at boot) → use `override_eff_brightness(&g_ovr, cfg->device.brightness)`.
- [ ] **Step 5:** Build (`idf.py build`) + host tests green. Manually reason: with no override (g_ovr all -1, fresh NVS) behavior is identical to today (effective == cloud). 
- [ ] **Step 6:** Commit (`feat(app): NVS-persisted overrides drive effective brightness/sleep`).

---

### Task 3: "About" screen (read-only) + menu row + back navigation

**Files:** Modify `components/ui/ui_settings.c`, `components/ui/include/ui.h`, `main/app_state.c`.

**Interfaces (Produces):**
```c
// add to ui_settings_action_t: UI_SET_ABOUT, UI_SET_DEVICE, UI_SET_BACK
void ui_settings_show_about(lv_obj_t *parent, const char *info_block);  // read-only rows; a Back button latches UI_SET_BACK via the shared action flag
```
The About content is a pre-formatted multi-line string built by app_state (`build_about_info`), one `key\tvalue` per line; the builder renders each line as a row (label muted left, value fg right) using the same brand palette as the menu. Reuse `s_action`/`s_action_set` + `ui_settings_consume_action` for the Back button (latch `UI_SET_BACK`).

- [ ] **Step 1:** In `ui.h`, extend the enum with `UI_SET_ABOUT`, `UI_SET_DEVICE`, `UI_SET_BACK`; declare `ui_settings_show_about`. In `ui_settings.c`, implement `ui_settings_show_about(parent, info)`: a `StaffHeader`-style header ("About" + a back button that latches `UI_SET_BACK`), then a card list of rows parsed from `info_block` (split on `\n`, each line `label\tvalue`), styled like the menu cards (palette via `settings_palette()`), with green/red `StatusDot`-style chips for any line whose value is "Online"/"Offline"/"Listening". Keep it PASSIVE.
- [ ] **Step 2:** In `ui_settings_show_menu`, add an **About** row (icon `LV_SYMBOL_LIST` or similar, label "About", sub "Device info") latching `UI_SET_ABOUT`. (Menu now: Network & Wi-Fi, About, Test print, Restart — Device settings row added in Task 4. Shrink row heights so all fit 720 with the Close button.)
- [ ] **Step 3:** Add `build_about_info(char *out, size_t n)` in app_state.c: firmware version (`appcfg_fw_version()` or CONFIG_DITTO_FW_VERSION), IP (`esp_netif`), MAC (`esp_wifi_get_mac`/`esp_read_mac`), Wi-Fi SSID + signal, Online (`net_is_connected()`), Print listener (":9100 Listening"). Format as `label\tvalue\n` lines.
- [ ] **Step 4:** In `run_settings_flow` menu loop, handle `UI_SET_ABOUT`: build about info, `ui_settings_show_about(scr, info)`, then an inner loop `for(;;){ if(s_settings_abort){...return;} if(ui_settings_consume_action(&act) && act==UI_SET_BACK){ break; } vTaskDelay(50);} ` then re-show the menu (`ui_settings_show_menu(scr)`); both build into the same `scr`. No new screen-load needed (in-place rebuild within the active settings screen).
- [ ] **Step 5:** Build + host tests green; commit (`feat(ui): About sub-screen with device info`).

---

### Task 4: "Device settings" screen (interactive brightness + sleep) + override wiring

**Files:** Modify `components/ui/ui_settings.c`, `components/ui/include/ui.h`, `main/app_state.c`.

**Interfaces (Produces):**
```c
// Build the device-settings screen into parent, seeded with current effective values
// and whether each is locally overridden. Back button latches UI_SET_BACK.
void ui_settings_show_device(lv_obj_t *parent, int brightness, int sleep_encoded,
                             bool br_overridden, bool sl_overridden);
// True (once) if the brightness slider moved; *val = 10..100. (live apply)
bool ui_settings_consume_brightness(int *val);
// True (once) if a sleep option was chosen; *encoded = 0/60/120/300/600.
bool ui_settings_consume_sleep(int *encoded);
// True (once) if user tapped "Follow admin" for brightness / sleep respectively.
bool ui_settings_consume_follow_brightness(void);
bool ui_settings_consume_follow_sleep(void);
```

- [ ] **Step 1:** Implement `ui_settings_show_device` in `ui_settings.c`: header ("Device settings" + back→`UI_SET_BACK`), a **brightness** card with an `lv_slider` (range 10..100, value=brightness) whose `LV_EVENT_VALUE_CHANGED` cb latches `s_dev_brightness`+value, plus a small "Follow admin" ghost button (latches `s_dev_follow_br`) shown only when `br_overridden`; a **sleep** card with 5 option chips (Off/1/2/5/10 min) highlighting the one matching `sleep_encoded`, each latching `s_dev_sleep`+encoded value, plus its "Follow admin" (when `sl_overridden`). PASSIVE: callbacks set volatile flags only. Add the four `consume_*` readers. Use the brand palette.
- [ ] **Step 2:** Add the **Device settings** menu row (icon `LV_SYMBOL_SETTINGS`, label "Device settings", sub "Brightness, sleep") latching `UI_SET_DEVICE` in `ui_settings_show_menu`.
- [ ] **Step 3:** In `run_settings_flow` menu loop, handle `UI_SET_DEVICE`: compute current effective values + overridden flags from `g_ovr`+cfg, `ui_settings_show_device(scr, eff_br, eff_sl, g_ovr.brightness>=0, g_ovr.sleep>=0)`, then an inner loop:
  - `if (s_settings_abort) { ... return; }`
  - `if (ui_settings_consume_brightness(&v)) { override_set_brightness(&g_ovr, v, cfg->device.brightness); overrides_save(); display_apply_brightness(v); }` (live).
  - `if (ui_settings_consume_sleep(&e)) { override_set_sleep(&g_ovr, e, cloud_sleep_encoded(cfg)); overrides_save(); s_last_activity_ms = now_ms(); }`
  - `if (ui_settings_consume_follow_brightness()) { override_clear_brightness(&g_ovr); overrides_save(); display_apply_brightness(cfg->device.brightness); /* re-show to update UI */ ui_settings_show_device(scr, ...); }`
  - same for follow_sleep.
  - `if (ui_settings_consume_action(&act) && act==UI_SET_BACK) break;`
  - `vTaskDelay(50);`
  then re-show the menu. (`cfg` here must be re-read each iteration as `s_cfg_buf[s_cfg_live]` is stable during the flow since poll_task is blocked — capture once is fine.)
- [ ] **Step 4:** Build + host tests green. Commit (`feat(ui): Device settings screen with persistent local override`).

---

### Task 5: Final review + merge prep
- [ ] Whole-branch review focused on: the new screen navigation lifecycle (sub-screen rebuilds into `scr`, no leaks/UAF), override reconcile correctness, NVS save frequency (don't thrash on every slider tick — debounce: only save on slider RELEASE, not each VALUE_CHANGED; adjust Task 4 Step 1 to latch on `LV_EVENT_RELEASED` for persistence while applying live on `VALUE_CHANGED`).
- [ ] HIL: brightness slider changes screen live + persists across reboot; sleep option persists; "Follow admin" reverts; an admin change to brightness/sleep clears the override; About shows correct info; back navigation works; tap/test-print/receipt-interrupt still fine.
- [ ] BUILD.md entry; merge to firmware `main`.

## Self-Review
- Spec coverage: override model (T1), persistence+effective apply (T2), About (T3), Device settings interactive+override (T4), review/merge (T5). Sync rule (admin-change clears override) = `override_reconcile` (T1) called on config apply (T2). Covered.
- Placeholder scan: none — code given for T1/T2; T3/T4 specify exact widgets, flags, signatures, and the run_settings_flow integration.
- NVS thrash risk flagged (T5: persist on slider RELEASE, live-apply on VALUE_CHANGED).
- Type consistency: `overrides_t` + fn names consistent T1↔T2↔T4; `UI_SET_ABOUT/DEVICE/BACK` + `ui_settings_show_about/device` + the four `consume_*` consistent T3↔T4.
