# M5c-2 Countdown + Auto-Return Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live, tenant-configurable countdown on the receipt/QR screen that auto-returns the device to idle when it reaches zero.

**Architecture:** Admin adds a `qrTimeoutSeconds` shared field (default 60, clamp 15–180) to the printer config + an editor control + live preview value. The device parses it, renders a ticking "Code expires M:SS" + progress bar via a 1 Hz LVGL timer, sets an expired flag at zero, and the poll task consumes that flag (checked on a 500 ms slice while in `DEV_QR`) to return to idle.

**Tech Stack:** maratus-admin (TypeScript, vitest, React editor/preview) · maratus-firmware (ESP-IDF 5.5, LVGL v9, C; host tests via `tools/cfg-harness`).

**Repos:** Tasks 1–2 in `/Users/eren/Projects/maratus-admin` (branch `feat/m5c2-countdown`). Tasks 3–7 in `/Users/eren/Projects/maratus-firmware` (create branch `feat/m5c2-countdown`).

**Spec:** `docs/superpowers/specs/2026-06-18-firmware-m5c2-countdown-design.md`

**Firmware build:** single combined command (shell state doesn't persist between Bash calls): `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`. Host tests: `cd tools/cfg-harness && make test` (gcc, no ESP-IDF). Flash + on-screen checks (Task 7) are done by the user.

---

### Task 1: Admin — `qrTimeoutSeconds` config field (TDD)

**Files (maratus-admin):**
- Modify: `lib/printer-layout.ts` (PrinterConfig interface; `seededAll()` and `migrateV2ToConfig` defaults; `normalizePrinterConfig` clamp)
- Test: `lib/printer-layout.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `lib/printer-layout.test.ts` (inside the existing top-level describe or as new `it`s — use whatever harness the file already uses; it imports from `./printer-layout`):

```ts
import { normalizePrinterConfig } from "./printer-layout";

describe("qrTimeoutSeconds", () => {
  it("defaults to 60 when absent", () => {
    const c = normalizePrinterConfig({ version: 3, screens: {} });
    expect(c.qrTimeoutSeconds).toBe(60);
  });
  it("passes a valid value through", () => {
    const c = normalizePrinterConfig({ version: 3, screens: {}, qrTimeoutSeconds: 90 });
    expect(c.qrTimeoutSeconds).toBe(90);
  });
  it("clamps below 15 up to 15 and above 180 down to 180", () => {
    expect(normalizePrinterConfig({ version: 3, screens: {}, qrTimeoutSeconds: 5 }).qrTimeoutSeconds).toBe(15);
    expect(normalizePrinterConfig({ version: 3, screens: {}, qrTimeoutSeconds: 999 }).qrTimeoutSeconds).toBe(180);
  });
  it("rounds non-integers", () => {
    expect(normalizePrinterConfig({ version: 3, screens: {}, qrTimeoutSeconds: 42.7 }).qrTimeoutSeconds).toBe(43);
  });
  it("defaults to 60 when migrating a v2 layout", () => {
    const c = normalizePrinterConfig({ version: 2, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, objects: [] });
    expect(c.qrTimeoutSeconds).toBe(60);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/printer-layout.test.ts`
Expected: FAIL — `qrTimeoutSeconds` missing on the returned config (type error and/or undefined).

- [ ] **Step 3: Implement**

In `lib/printer-layout.ts`:

(a) Add the field to the `PrinterConfig` interface (after `wifiLevel: number;`):
```ts
  qrTimeoutSeconds: number; // receipt/QR screen display timeout, 15..180
```

(b) In `normalizePrinterConfig`, the `seededAll()` helper returns
`{ version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, screens }`.
Add `qrTimeoutSeconds: 60`:
```ts
    return { version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60, screens };
```

(c) In `normalizePrinterConfig`'s final `return { version: 3, clockTimezone: tz, ... }` (the v3 success path), add the clamped field (reuse the existing `clamp` + `num` helpers):
```ts
    qrTimeoutSeconds: clamp(Math.round(num(cfg.qrTimeoutSeconds, 60)), 15, 180),
```

(d) Find `migrateV2ToConfig` (it builds a `version: 3` PrinterConfig from a normalized v2 layout) and add `qrTimeoutSeconds: 60` to the config object it returns (v2 had no such field).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/printer-layout.test.ts`
Expected: PASS. Then `npx tsc --noEmit` → no new errors (the interface field is now satisfied everywhere a PrinterConfig is constructed; if tsc flags another construction site missing `qrTimeoutSeconds`, add `qrTimeoutSeconds: 60` there).

- [ ] **Step 5: Commit**

```bash
git add lib/printer-layout.ts lib/printer-layout.test.ts
git commit -m "feat: add qrTimeoutSeconds (15-180, default 60) to printer config"
```

---

### Task 2: Admin — editor control + live preview value

**Files (maratus-admin):**
- Modify: `components/device-preview/printer-editor/use-printer-editor.ts` (`setShared` type, 2 spots)
- Modify: `components/device-preview/printer-editor/printer-controls.tsx` (add control)
- Modify: `components/device-preview/printer-preview.tsx` (`CountdownObject` + dispatch)

- [ ] **Step 1: Widen `setShared` to accept the new field**

In `components/device-preview/printer-editor/use-printer-editor.ts`, the type appears twice (the interface field ~line 47 and the implementation ~line 164). Change both occurrences of:
```ts
Partial<Pick<PrinterConfig, "clockTimezone" | "clock24h" | "wifiLevel">>
```
to:
```ts
Partial<Pick<PrinterConfig, "clockTimezone" | "clock24h" | "wifiLevel" | "qrTimeoutSeconds">>
```

- [ ] **Step 2: Add the editor control**

In `components/device-preview/printer-editor/printer-controls.tsx`, the shared section already has a Timezone `Select` and a 24-hour `Switch` (around the `clock-24h` Switch) and a "Signal level" wifi control. Add a "Receipt timeout" control next to them. Place this block right after the `Signal level` control's closing `</div>` (the wifi block near `editor.config.wifiLevel`):

```tsx
          <div className="space-y-1">
            <Label htmlFor="qr-timeout" className="text-xs text-muted-foreground">Receipt timeout (seconds)</Label>
            <input
              id="qr-timeout"
              type="number"
              min={15}
              max={180}
              step={5}
              value={editor.config.qrTimeoutSeconds}
              disabled={disabled}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (Number.isFinite(n)) editor.setShared({ qrTimeoutSeconds: Math.min(180, Math.max(15, n)) });
              }}
              className="h-8 w-full rounded-md border bg-transparent px-2 text-sm disabled:opacity-50"
            />
          </div>
```

(If the file imports a shared `Input` component used elsewhere, prefer that over a raw `<input>` to match style — check the imports at the top; a raw input is acceptable if there's no `Input` component already imported.)

- [ ] **Step 3: Make the preview countdown reflect the configured duration**

In `components/device-preview/printer-preview.tsx`:

(a) Change the `CountdownObject` signature + body (currently hardcodes `remain = "0:48"`, `progress = 0.34`) to take `seconds` and show it as a full (not-yet-elapsed) bar:
```tsx
function CountdownObject({ object: _object, brand: _brand, seconds }: { object: PrinterObject; brand: PrinterBrand; seconds: number }) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const remain = `${m}:${String(s).padStart(2, "0")}`;
  const progress = 0; // editor preview is static — show the full duration
```
(Leave the rest of the component — the `Code expires` row and the bar `div`s — unchanged; with `progress = 0` the bar renders full width.)

(b) Update the dispatch (the `case "countdown":` line) to pass the configured seconds:
```tsx
    case "countdown":
      return <CountdownObject object={object} brand={brand} seconds={config.qrTimeoutSeconds} />;
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors in the three files (pre-existing unrelated `kiosk-*` errors ignored).
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add "components/device-preview/printer-editor/use-printer-editor.ts" "components/device-preview/printer-editor/printer-controls.tsx" components/device-preview/printer-preview.tsx
git commit -m "feat: receipt-timeout editor control + live countdown preview value"
```

---

### Task 3: Firmware — `format_mmss` pure helper (host TDD)

**Files (maratus-firmware):**
- Modify: `components/devcfg/clock_format.c`, `components/devcfg/include/clock_format.h`, `tools/cfg-harness/test_cfg.c`

Create the firmware branch first:
```bash
cd /Users/eren/Projects/maratus-firmware && git checkout main && git checkout -b feat/m5c2-countdown
```

- [ ] **Step 1: Declare in `components/devcfg/include/clock_format.h`** (add below `format_clock`):

```c
// Format a remaining-seconds count as "M:SS" (e.g. 48 -> "0:48", 125 -> "2:05").
// Negative inputs clamp to 0. Writes into out (size outlen).
void format_mmss(int seconds, char *out, int outlen);
```

- [ ] **Step 2: Add the failing host test** in `tools/cfg-harness/test_cfg.c` — add this function above `main` and a `test_mmss();` call next to the other `test_*()` calls:

```c
static void test_mmss(void) {
    char buf[16];
    format_mmss(0, buf, sizeof(buf));   assert(strcmp(buf, "0:00") == 0);
    format_mmss(48, buf, sizeof(buf));  assert(strcmp(buf, "0:48") == 0);
    format_mmss(125, buf, sizeof(buf)); assert(strcmp(buf, "2:05") == 0);
    format_mmss(600, buf, sizeof(buf)); assert(strcmp(buf, "10:00") == 0);
    format_mmss(-5, buf, sizeof(buf));  assert(strcmp(buf, "0:00") == 0);
    printf("test_mmss OK\n");
}
```

- [ ] **Step 3: Run host tests, confirm FAIL**

Run: `cd /Users/eren/Projects/maratus-firmware/tools/cfg-harness && make test`
Expected: FAIL — `format_mmss` undefined.

- [ ] **Step 4: Implement in `components/devcfg/clock_format.c`** (append):

```c
void format_mmss(int seconds, char *out, int outlen) {
    if (outlen <= 0) return;
    if (seconds < 0) seconds = 0;
    snprintf(out, outlen, "%d:%02d", seconds / 60, seconds % 60);
}
```

- [ ] **Step 5: Run host tests, confirm PASS**

Run: `cd /Users/eren/Projects/maratus-firmware/tools/cfg-harness && make test`
Expected: PASS — includes `test_mmss OK` and `ALL TESTS PASSED`.

- [ ] **Step 6: Commit**

```bash
cd /Users/eren/Projects/maratus-firmware
git add components/devcfg/clock_format.c components/devcfg/include/clock_format.h tools/cfg-harness/test_cfg.c
git commit -m "feat(firmware): format_mmss helper + host test"
```

---

### Task 4: Firmware — parse `qrTimeoutSeconds` (host TDD)

**Files (maratus-firmware):**
- Modify: `components/devcfg/include/device_config.h`, `components/devcfg/cfg_parse.c`, `tools/cfg-harness/test_cfg.c`

- [ ] **Step 1: Add the field** to `device_config_t` in `components/devcfg/include/device_config.h`, next to `int wifi_level;`:

```c
    int      qr_timeout_seconds;  // receipt/QR auto-return timeout, 15..180
```

- [ ] **Step 2: Write the failing host test.** In `tools/cfg-harness/test_cfg.c`, find how `test_parse` invokes the parser on a JSON string (`cfg_parse_json` or similar) and follow that exact pattern. Add a `test_qr_timeout()` (and call it in `main`) that parses a minimal payload and asserts the field. Model it on `test_parse`; the assertions are:
  - a config JSON with `"config":{"qrTimeoutSeconds":90}` → `cfg.qr_timeout_seconds == 90`
  - absent → `== 60`
  - `5` → `== 15`; `999` → `== 180`

(Use the same JSON-building + `cfg_parse_*` call `test_parse` uses; only the asserted field differs.)

- [ ] **Step 3: Run host tests, confirm FAIL**

Run: `cd /Users/eren/Projects/maratus-firmware/tools/cfg-harness && make test`
Expected: FAIL — `qr_timeout_seconds` is always 0 / field unset.

- [ ] **Step 4: Implement the parse** in `components/devcfg/cfg_parse.c`, right after the existing `wifi_level` parse block (which reads `config`'s `"wifiLevel"` and clamps 0..4):

```c
    cJSON *qt = config ? cJSON_GetObjectItem(config, "qrTimeoutSeconds") : NULL;
    cfg->qr_timeout_seconds = cJSON_IsNumber(qt) ? (int)qt->valuedouble : 60;
    if (cfg->qr_timeout_seconds < 15)  cfg->qr_timeout_seconds = 15;
    if (cfg->qr_timeout_seconds > 180) cfg->qr_timeout_seconds = 180;
```

- [ ] **Step 5: Run host tests, confirm PASS**

Run: `cd /Users/eren/Projects/maratus-firmware/tools/cfg-harness && make test`
Expected: PASS — `test_qr_timeout OK` + `ALL TESTS PASSED`.

- [ ] **Step 6: Commit**

```bash
git add components/devcfg/include/device_config.h components/devcfg/cfg_parse.c tools/cfg-harness/test_cfg.c
git commit -m "feat(firmware): parse qrTimeoutSeconds (clamp 15..180, default 60)"
```

---

### Task 5: Firmware — live countdown widget in `ui.c`

**Files (maratus-firmware):**
- Modify: `components/ui/ui.c`, `components/ui/include/ui.h`

Context: `ui.c` uses a per-render registry of statics cleared under `lvgl_port_lock(0)` at the top of `ui_render_state` (see the clock: `s_clock_lbl`/`s_clock_timer` nulled there, rebuilt by `build_screen`). `geom_box(o)`, `font_cache_get`, `lv_align_of`, `s_cfg->brand_fg`/`brand_accent` are available. `format_mmss` is in `clock_format.h` (already included by Task 5's edits if not, add it).

- [ ] **Step 1: Declare setters in `components/ui/include/ui.h`** (after `ui_set_wifi_level`):

```c
// Arm the receipt-screen countdown to start at `seconds` on the next render of a
// screen that contains a countdown object. Resets the expired flag.
void ui_set_countdown(int seconds);

// True (once) if the countdown reached 0 since the last call. Cleared on read.
bool ui_consume_countdown_expired(void);
```

- [ ] **Step 2: Add statics** in `components/ui/ui.c` near the clock statics:

```c
static lv_obj_t  *s_cd_time;       // "M:SS" remaining label (NULL if none)
static lv_obj_t  *s_cd_bar;        // progress bar (NULL if none)
static lv_timer_t *s_cd_timer;     // 1 Hz tick
static int        s_cd_pending = 60; // duration the next render should arm
static int        s_cd_remaining;  // seconds left on the active widget
static bool       s_cd_expired;    // set at 0, consumed by the state machine
```

- [ ] **Step 3: Tear down per render.** In `ui_render_state`, alongside the existing `if (s_clock_timer) { ... }` and the NULL-clears, add:

```c
    if (s_cd_timer) { lv_timer_delete(s_cd_timer); s_cd_timer = NULL; }
    s_cd_time = NULL;
    s_cd_bar  = NULL;
```

- [ ] **Step 4: Add the tick + render fn** above `build_screen`. The tick runs in the LVGL task (lock held):

```c
static void cd_tick_cb(lv_timer_t *t) {
    (void)t;
    if (s_cd_remaining > 0) {
        s_cd_remaining--;
        if (s_cd_time) {
            char buf[16];
            format_mmss(s_cd_remaining, buf, sizeof(buf));
            lv_label_set_text(s_cd_time, buf);
        }
        if (s_cd_bar) lv_bar_set_value(s_cd_bar, s_cd_remaining, LV_ANIM_OFF);
        if (s_cd_remaining == 0) s_cd_expired = true;
    }
}

static void render_countdown(lv_obj_t *scr, const cfg_object_t *o, uint32_t fg, uint32_t accent) {
    px_box_t b = geom_box(o);
    int total = s_cd_pending;
    s_cd_remaining = total;

    // "Code expires" + remaining time on the top row of the box.
    lv_obj_t *label = lv_label_create(scr);
    lv_label_set_text(label, "Code expires");
    lv_obj_set_style_text_color(label, lv_color_hex(fg), LV_PART_MAIN);
    lv_obj_set_style_text_font(label, font_cache_get(o->font_size > 0 ? o->font_size : 18), LV_PART_MAIN);
    lv_obj_set_pos(label, b.x, b.y);

    char buf[16];
    format_mmss(total, buf, sizeof(buf));
    lv_obj_t *tlbl = lv_label_create(scr);
    lv_label_set_text(tlbl, buf);
    lv_obj_set_style_text_color(tlbl, lv_color_hex(fg), LV_PART_MAIN);
    lv_obj_set_style_text_font(tlbl, font_cache_get(o->font_size > 0 ? o->font_size : 18), LV_PART_MAIN);
    lv_obj_set_style_text_align(tlbl, LV_TEXT_ALIGN_RIGHT, LV_PART_MAIN);
    lv_obj_set_width(tlbl, b.w > 0 ? b.w : 120);
    lv_obj_set_pos(tlbl, b.x, b.y);
    s_cd_time = tlbl;

    // Progress bar below the row, depleting as time runs out.
    lv_obj_t *bar = lv_bar_create(scr);
    int barh = 8;
    lv_obj_set_size(bar, b.w > 0 ? b.w : 160, barh);
    lv_obj_set_pos(bar, b.x, b.y + (b.h > 0 ? b.h - barh : 28));
    lv_bar_set_range(bar, 0, total > 0 ? total : 1);
    lv_bar_set_value(bar, total, LV_ANIM_OFF);
    lv_obj_set_style_bg_opa(bar, LV_OPA_30, LV_PART_MAIN);
    lv_obj_set_style_bg_color(bar, lv_color_hex(fg), LV_PART_MAIN);
    lv_obj_set_style_bg_color(bar, lv_color_hex(accent), LV_PART_INDICATOR);
    lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, LV_PART_INDICATOR);
    s_cd_bar = bar;

    if (s_cd_timer) { lv_timer_delete(s_cd_timer); s_cd_timer = NULL; }
    s_cd_timer = lv_timer_create(cd_tick_cb, 1000, NULL);
}
```

- [ ] **Step 5: Wire the case** in `build_screen`'s object switch, next to the other widget cases:

```c
            case OBJ_COUNTDOWN: render_countdown(scr, o, s_cfg->brand_fg, s_cfg->brand_accent); break;
```

- [ ] **Step 6: Implement the setters** after `ui_set_wifi_level`:

```c
void ui_set_countdown(int seconds) {
    if (seconds < 15) seconds = 15;
    if (seconds > 180) seconds = 180;
    lvgl_port_lock(0);
    s_cd_pending = seconds;
    s_cd_expired = false;
    lvgl_port_unlock();
}

bool ui_consume_countdown_expired(void) {
    lvgl_port_lock(0);
    bool e = s_cd_expired;
    s_cd_expired = false;
    lvgl_port_unlock();
    return e;
}
```

Make sure `#include "clock_format.h"` is present near the top of `ui.c` (added in M5c-1; if absent, add it).

- [ ] **Step 7: Build**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: build SUCCEEDS. (If `lv_bar_*` symbols are missing, ensure `CONFIG_LV_USE_BAR=y` in `sdkconfig` — it's on by default; set it if needed.)

- [ ] **Step 8: Commit**

```bash
git add components/ui/ui.c components/ui/include/ui.h sdkconfig
git commit -m "feat(firmware): live countdown widget (Code expires M:SS + bar) + setters"
```

---

### Task 6: Firmware — arm countdown on QR + auto-return to idle

**Files (maratus-firmware):**
- Modify: `main/app_state.c`

Context: `poll_task` (in `app_state.c`) reaches `DEV_QR` in two places — `run_test_ingest` (around `ui_set_qr_url(url); ui_render_state(DEV_QR);`) and the config/command flow. `s_cfg_live`/`s_cfg_buf[s_cfg_live]` is the live `device_config_t`. The success path ends with `vTaskDelay(pdMS_TO_TICKS(POLL_IDLE_MS));` (POLL_IDLE_MS = 12000).

- [ ] **Step 1: Arm the countdown when entering DEV_QR.** At each site that does `ui_set_qr_url(url); ui_render_state(DEV_QR);`, insert `ui_set_countdown(...)` BEFORE the render so `render_countdown` picks up the duration. Use the live config's value:

```c
        ui_set_qr_url(url);
        ui_set_countdown(s_cfg_buf[s_cfg_live]->qr_timeout_seconds);
        s_state = DEV_QR;
        ui_render_state(DEV_QR);
```

(Apply at both DEV_QR transition sites — `run_test_ingest` and `render_job.c` if it does the same. Check `main/render_job.c`: if it sets `DEV_QR`, add the same `ui_set_countdown(...)` line there too, using the config it has access to, or expose a small accessor. If `render_job.c` has no config handle, leave its QR path as-is and note it — the auto-return simply won't arm for that path; the primary path is `app_state`.)

- [ ] **Step 2: Add the short-slice idle wait** above `poll_task`:

```c
// Wait up to total_ms, but break early (~500ms granularity) to auto-return from
// the receipt screen when its countdown expires. Avoids extra cloud polls.
static void idle_wait_or_qr_expiry(int total_ms) {
    const int slice = 500;
    for (int waited = 0; waited < total_ms; waited += slice) {
        if (s_state == DEV_QR && ui_consume_countdown_expired()) {
            s_state = DEV_IDLE;
            ui_render_state(DEV_IDLE);
            return;
        }
        vTaskDelay(pdMS_TO_TICKS(slice));
    }
}
```

- [ ] **Step 3: Use it on the success path.** Replace the success-path `vTaskDelay(pdMS_TO_TICKS(POLL_IDLE_MS));` with:

```c
            idle_wait_or_qr_expiry(POLL_IDLE_MS);
```

(Leave the disconnected/backoff `vTaskDelay`s unchanged.)

- [ ] **Step 4: Build**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: build SUCCEEDS.

- [ ] **Step 5: Full host-test regression**

Run: `cd /Users/eren/Projects/maratus-firmware/tools/cfg-harness && make test`
Expected: PASS — `test_mmss OK`, `test_qr_timeout OK`, plus all prior tests and `ALL TESTS PASSED`.

- [ ] **Step 6: Commit**

```bash
git add main/app_state.c main/render_job.c
git commit -m "feat(firmware): arm countdown on QR, auto-return to idle on expiry"
```

---

### Task 7: Hardware verification (manual — user + board)

**Files:** none.

Prerequisite: the receipt/`qr` branding screen must contain a `countdown` object (the default layout already places one).

- [ ] **Step 1:** Flash the Task 6 build (BUILD.md BOOT procedure; stay off serial during visual checks).
- [ ] **Step 2:** Trigger a receipt (tap or ESC/POS send) → on the QR screen, confirm "Code expires M:SS" counts down each second and the bar depletes.
- [ ] **Step 3:** Let it reach 0:00 → the device auto-returns to the idle screen (within ~1 s).
- [ ] **Step 4:** Trigger another receipt and tap before expiry → confirm tap behavior is unchanged.
- [ ] **Step 5:** In branding, change "Receipt timeout" (e.g. to 20 s), save → next receipt's countdown starts from the new value.
- [ ] **Step 6:** Record the result in `BUILD.md` (M5c-2 entry); milestone ready to merge.

---

## Self-Review

**Spec coverage:**
- `qrTimeoutSeconds` field default 60 / clamp 15–180, no version bump — Task 1 ✓
- Editor control — Task 2 ✓; preview shows configured duration — Task 2 ✓
- `format_mmss` host helper — Task 3 ✓
- Device parse + clamp — Task 4 ✓
- Countdown widget (Code expires + M:SS + bar, 1 Hz, expired flag) — Task 5 ✓
- Arm on DEV_QR + auto-return via expired flag on 500 ms slice — Task 6 ✓
- No-countdown safety: deadline armed inside `render_countdown` (only a countdown object creates the timer/flag) — Task 5 ✓
- UI/state separation via `ui_consume_countdown_expired` — Tasks 5 + 6 ✓
- Tests: `format_mmss`, `cfg_parse`, normalize — Tasks 1, 3, 4 ✓

**Placeholder scan:** none — full code in every code step; firmware build/HW steps name exact commands. Task 4 step 2 intentionally defers to the existing `test_parse` harness pattern (the engineer must read the harness's parse-invocation style) rather than guessing the cJSON-fixture API — the assertions are fully specified.

**Type consistency:** `qrTimeoutSeconds` (TS, Tasks 1–2); `qr_timeout_seconds` (C, Tasks 4–6); `format_mmss(int, char*, int)` (Tasks 3, 5); `ui_set_countdown(int)` / `ui_consume_countdown_expired(void)` (Tasks 5, 6); statics `s_cd_*` (Task 5). `brand_accent`/`brand_fg`, `geom_box`, `font_cache_get` already exist.
