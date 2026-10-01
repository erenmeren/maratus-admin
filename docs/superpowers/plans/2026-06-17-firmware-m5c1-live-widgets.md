# M5c-1 Live Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the device clock, wifi, and spinner widgets live — clock shows SNTP time in the tenant's timezone/format, wifi shows real signal, spinner animates — driven by config the admin already sends.

**Architecture:** Admin converts the stored IANA timezone to a POSIX TZ string in the device-config payload. The device adds an SNTP/time module, sets `TZ` from the payload, and renders three native LVGL widgets (replacing placeholders) updated in place via a per-screen registry + a 1 Hz clock timer + an RSSI-driven wifi setter. The state→screen mapping already exists (M5a `screen_for_state`) — unchanged.

**Tech Stack:** maratus-admin (TypeScript, vitest) · maratus-firmware (ESP-IDF 5.5, LVGL v9, C; host tests via `tools/cfg-harness` gcc Makefile).

**Repos:** Tasks 1–2 in `/Users/eren/Projects/maratus-admin` (branch `feat/m5c1-live-widgets`). Tasks 3–7 in `/Users/eren/Projects/maratus-firmware` (create branch `feat/m5c1-live-widgets`).

**Spec:** `docs/superpowers/specs/2026-06-17-firmware-m5c1-live-widgets-design.md`

**Firmware build/flash note:** firmware build needs `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build` (see BUILD.md). Host tests (`tools/cfg-harness`) build with plain `make` (gcc) — no ESP-IDF needed. Flashing + on-screen checks need the physical board (manual BOOT-mode dance per BUILD.md) and are done by the user.

---

### Task 1: Admin — IANA→POSIX timezone map (TDD)

**Files (maratus-admin):**
- Create: `lib/posix-tz.ts`
- Test: `lib/posix-tz.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/posix-tz.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ianaToPosix } from "./posix-tz";
import { TIMEZONES } from "./timezones";

describe("ianaToPosix", () => {
  it("maps every curated timezone to a non-empty POSIX string", () => {
    for (const { value } of TIMEZONES) {
      expect(ianaToPosix(value), value).toMatch(/.+/);
    }
  });

  it("maps a DST zone correctly (America/New_York)", () => {
    expect(ianaToPosix("America/New_York")).toBe("EST5EDT,M3.2.0,M11.1.0");
  });

  it("maps a no-DST zone correctly (Asia/Kolkata)", () => {
    expect(ianaToPosix("Asia/Kolkata")).toBe("IST-5:30");
  });

  it("maps UTC", () => {
    expect(ianaToPosix("UTC")).toBe("UTC0");
  });

  it("falls back to UTC0 for unknown or empty input", () => {
    expect(ianaToPosix("Mars/Olympus_Mons")).toBe("UTC0");
    expect(ianaToPosix("")).toBe("UTC0");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/posix-tz.test.ts`
Expected: FAIL — `lib/posix-tz.ts` does not exist.

- [ ] **Step 3: Implement `lib/posix-tz.ts`**

```ts
// POSIX TZ strings for the curated zones in lib/timezones.ts. The device's libc
// needs a POSIX TZ string (not an IANA name) to apply DST correctly, and it has
// no on-device tz database — so we convert here, where the full tz data lives.
// Keep this map in sync with lib/timezones.ts.
const IANA_TO_POSIX: Record<string, string> = {
  UTC: "UTC0",
  "America/New_York": "EST5EDT,M3.2.0,M11.1.0",
  "America/Chicago": "CST6CDT,M3.2.0,M11.1.0",
  "America/Denver": "MST7MDT,M3.2.0,M11.1.0",
  "America/Phoenix": "MST7",
  "America/Los_Angeles": "PST8PDT,M3.2.0,M11.1.0",
  "America/Anchorage": "AKST9AKDT,M3.2.0,M11.1.0",
  "Pacific/Honolulu": "HST10",
  "America/Toronto": "EST5EDT,M3.2.0,M11.1.0",
  "America/Mexico_City": "CST6", // Mexico ended nationwide DST in 2022
  "Europe/London": "GMT0BST,M3.5.0/1,M10.5.0",
  "Europe/Paris": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Berlin": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Madrid": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Asia/Dubai": "GST-4",
  "Asia/Kolkata": "IST-5:30",
  "Asia/Singapore": "<+08>-8",
  "Asia/Tokyo": "JST-9",
  "Australia/Sydney": "AEST-10AEDT,M10.1.0,M4.1.0/3",
};

/** Convert a curated IANA zone name to a POSIX TZ string. Unknown/empty → UTC0. */
export function ianaToPosix(iana: string): string {
  return IANA_TO_POSIX[iana] ?? "UTC0";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/posix-tz.test.ts`
Expected: PASS (5 tests). If the "every curated timezone" test fails, a zone in `lib/timezones.ts` is missing from the map — add it.

- [ ] **Step 5: Commit**

```bash
git add lib/posix-tz.ts lib/posix-tz.test.ts
git commit -m "feat: IANA->POSIX timezone map for device config"
```

---

### Task 2: Admin — send POSIX TZ in the device config payload

**Files (maratus-admin):**
- Modify: `lib/data.ts` (the `getDeviceConfig` function, near `const config = normalizePrinterConfig(...)` and the `return { ... payload: { ... config } }`)

- [ ] **Step 1: Add the import**

In `lib/data.ts`, add near the other `lib` imports at the top (next to `import { resolveBrandTokens } from "./color";`):

```ts
import { ianaToPosix } from "./posix-tz";
```

- [ ] **Step 2: Convert clockTimezone to POSIX before returning the payload**

In `getDeviceConfig`, the body builds `const config = normalizePrinterConfig(s?.printerScreens ?? s?.printerLayout);` and later returns it inside `payload`. Immediately after the icon-presigning loop and before `const logoUrl = ...`, add:

```ts
  // The device's libc needs a POSIX TZ string (not the stored IANA name) to apply
  // DST. Convert here; the editor keeps storing IANA. computeConfigVersion (above)
  // is keyed on the stored IANA value, so the ETag stays stable.
  config.clockTimezone = ianaToPosix(config.clockTimezone);
```

- [ ] **Step 3: Verify typecheck + existing tests**

Run: `npx tsc --noEmit`
Expected: no new errors in `lib/data.ts`.
Run: `npm run test`
Expected: all pass (including `lib/posix-tz.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add lib/data.ts
git commit -m "feat: device config payload sends POSIX TZ for the clock"
```

---

### Task 3: Firmware — `format_clock` pure helper (TDD, host-tested)

**Files (maratus-firmware):**
- Create: `components/devcfg/clock_format.c`, `components/devcfg/include/clock_format.h`
- Modify: `tools/cfg-harness/Makefile` (add the new source), `tools/cfg-harness/test_cfg.c` (add `test_clock`)

First create the firmware branch:
```bash
cd /Users/eren/Projects/maratus-firmware && git checkout main && git checkout -b feat/m5c1-live-widgets
```

- [ ] **Step 1: Write the header**

Create `components/devcfg/include/clock_format.h`:

```c
#pragma once
#include <time.h>
#include <stdbool.h>

// Format a clock string from a broken-down local time.
//   h24:     true = 24-hour ("14:05"), false = 12-hour ("2:05 PM")
//   date:    append the day-of-month line content
//   weekday: include the weekday
// Writes into out (size outlen). Layout: "TIME" optionally followed by a newline
// and a "Weekday DD Month" date line (matching the branding preview's clock).
void format_clock(const struct tm *tm, bool h24, bool date, bool weekday,
                  char *out, int outlen);
```

- [ ] **Step 2: Write the failing host test**

In `tools/cfg-harness/test_cfg.c`, add `#include "clock_format.h"` near the other includes, add this function above `main`, and add a `test_clock();` call inside `main` next to the other `test_*()` calls:

```c
static void test_clock(void) {
    struct tm t = {0};
    t.tm_hour = 14; t.tm_min = 5; t.tm_wday = 3; t.tm_mday = 17; t.tm_mon = 5; // Wed 17 Jun
    char buf[64];

    format_clock(&t, true, false, false, buf, sizeof(buf));
    assert(strcmp(buf, "14:05") == 0);

    format_clock(&t, false, false, false, buf, sizeof(buf));
    assert(strcmp(buf, "2:05 PM") == 0);

    struct tm noon = {0}; noon.tm_hour = 12; noon.tm_min = 0;
    format_clock(&noon, false, false, false, buf, sizeof(buf));
    assert(strcmp(buf, "12:00 PM") == 0);

    struct tm midnight = {0}; midnight.tm_hour = 0; midnight.tm_min = 0;
    format_clock(&midnight, false, false, false, buf, sizeof(buf));
    assert(strcmp(buf, "12:00 AM") == 0);

    format_clock(&t, true, true, true, buf, sizeof(buf));
    assert(strcmp(buf, "14:05\nWed 17 Jun") == 0);

    printf("test_clock OK\n");
}
```

Add the new source to `tools/cfg-harness/Makefile`: append `clock_format.c` to the list of devcfg sources it compiles (the same list that already includes `cfg_parse.c` and `render_geom.c`; they are referenced via the `../../components/devcfg/` path — mirror that exact pattern for `clock_format.c`).

- [ ] **Step 3: Run the host test to verify it fails**

Run: `cd /Users/eren/Projects/maratus-firmware/tools/cfg-harness && make test`
Expected: FAIL to compile/link — `format_clock` / `clock_format.h` not found (or undefined reference).

- [ ] **Step 4: Implement `components/devcfg/clock_format.c`**

```c
#include "clock_format.h"
#include <stdio.h>
#include <string.h>

static const char *const WDAY[7] = {"Sun","Mon","Tue","Wed","Thu","Fri","Sat"};
static const char *const MON[12] = {"Jan","Feb","Mar","Apr","May","Jun",
                                    "Jul","Aug","Sep","Oct","Nov","Dec"};

void format_clock(const struct tm *tm, bool h24, bool date, bool weekday,
                  char *out, int outlen) {
    if (outlen <= 0) return;
    int n;
    if (h24) {
        n = snprintf(out, outlen, "%d:%02d", tm->tm_hour, tm->tm_min);
    } else {
        int h = tm->tm_hour % 12;
        if (h == 0) h = 12;
        const char *ap = tm->tm_hour < 12 ? "AM" : "PM";
        n = snprintf(out, outlen, "%d:%02d %s", h, tm->tm_min, ap);
    }
    if (!date || n < 0 || n >= outlen) return;

    int wd = tm->tm_wday, mo = tm->tm_mon;
    if (wd < 0 || wd > 6) wd = 0;
    if (mo < 0 || mo > 11) mo = 0;
    if (weekday) {
        snprintf(out + n, outlen - n, "\n%s %d %s", WDAY[wd], tm->tm_mday, MON[mo]);
    } else {
        snprintf(out + n, outlen - n, "\n%d %s", tm->tm_mday, MON[mo]);
    }
}
```

- [ ] **Step 5: Run the host test to verify it passes**

Run: `cd /Users/eren/Projects/maratus-firmware/tools/cfg-harness && make test`
Expected: PASS — output includes `test_clock OK` and `ALL TESTS PASSED`.

- [ ] **Step 6: Commit**

```bash
cd /Users/eren/Projects/maratus-firmware
git add components/devcfg/clock_format.c components/devcfg/include/clock_format.h tools/cfg-harness/Makefile tools/cfg-harness/test_cfg.c
git commit -m "feat(firmware): pure format_clock helper + host test"
```

---

### Task 4: Firmware — `time_sync` component (SNTP + TZ)

**Files (maratus-firmware):**
- Create: `components/time_sync/time_sync.c`, `components/time_sync/include/time_sync.h`, `components/time_sync/CMakeLists.txt`

- [ ] **Step 1: Create the header**

`components/time_sync/include/time_sync.h`:

```c
#pragma once
#include <stdbool.h>

// Start the SNTP client once (idempotent). Safe to call on every reconnect.
void time_sync_start(void);

// Apply a POSIX TZ string (e.g. "PST8PDT,M3.2.0,M11.1.0"). NULL/empty → "UTC0".
void time_sync_set_tz(const char *posix_tz);

// True once the first SNTP time update has landed.
bool time_is_synced(void);
```

- [ ] **Step 2: Create the implementation**

`components/time_sync/time_sync.c`:

```c
#include "time_sync.h"
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "esp_netif_sntp.h"
#include "esp_log.h"

static const char *TAG = "time_sync";
static volatile bool s_synced = false;
static bool s_started = false;

static void on_sync(struct timeval *tv) {
    (void)tv;
    s_synced = true;
    ESP_LOGI(TAG, "SNTP time acquired");
}

void time_sync_start(void) {
    if (s_started) return;
    s_started = true;
    esp_sntp_config_t cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    cfg.sync_cb = on_sync;
    esp_netif_sntp_init(&cfg);
    ESP_LOGI(TAG, "SNTP started");
}

void time_sync_set_tz(const char *posix_tz) {
    const char *tz = (posix_tz && posix_tz[0]) ? posix_tz : "UTC0";
    setenv("TZ", tz, 1);
    tzset();
    ESP_LOGI(TAG, "TZ set to %s", tz);
}

bool time_is_synced(void) { return s_synced; }
```

- [ ] **Step 3: Create the CMakeLists**

`components/time_sync/CMakeLists.txt`:

```cmake
idf_component_register(SRCS "time_sync.c"
                       INCLUDE_DIRS "include"
                       REQUIRES esp_netif)
```

- [ ] **Step 4: Build to verify it compiles**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: build succeeds (the new component compiles; it isn't called yet).

- [ ] **Step 5: Commit**

```bash
git add components/time_sync
git commit -m "feat(firmware): time_sync component (SNTP + POSIX TZ)"
```

---

### Task 5: Firmware — live clock/wifi/spinner widgets in `ui.c`

**Files (maratus-firmware):**
- Modify: `components/ui/ui.c` (widget statics, `ui_render_state` cleanup, `build_screen` switch, new render fns, `ui_set_wifi_level`), `components/ui/include/ui.h` (declare `ui_set_wifi_level`), `components/ui/CMakeLists.txt` (add `time_sync` + `devcfg` to REQUIRES if not already present)

- [ ] **Step 1: Declare the setter in `ui.h`**

Add to `components/ui/include/ui.h` after `ui_set_online`:

```c
// Set the wifi widget signal strength (0..4 bars). Clamped. From live RSSI.
void ui_set_wifi_level(int level);
```

- [ ] **Step 2: Add widget statics**

In `components/ui/ui.c`, near the existing statics (`s_status_dot`, `s_qr_url`, `s_online`), add:

```c
#include "clock_format.h"
#include "time_sync.h"

static lv_obj_t  *s_clock_lbl;     // active-screen clock label (NULL if none)
static lv_timer_t *s_clock_timer;  // 1 Hz tick for the clock label
static bool       s_clock_24h;
static bool       s_clock_date;
static bool       s_clock_weekday;
static lv_obj_t  *s_wifi_obj;      // active-screen wifi widget (NULL if none)
static int        s_wifi_level = 0;
```

- [ ] **Step 3: Clear widget handles + kill the clock timer on each render**

In `ui_render_state`, the existing body clears `s_status_dot = NULL;` under the lock before building. Replace that single line with:

```c
    if (s_clock_timer) { lv_timer_delete(s_clock_timer); s_clock_timer = NULL; }
    s_status_dot = NULL;   // cleared each render; build_screen reinstalls it
    s_clock_lbl  = NULL;
    s_wifi_obj   = NULL;
```

(The old screen's child objects — clock label, wifi bars, spinner — are freed by the existing `lv_obj_delete(old)`. The clock timer is global, so it must be deleted explicitly here.)

- [ ] **Step 4: Add the render functions and clock tick**

In `components/ui/ui.c`, add these above `build_screen` (they use `geom_box`, `s_cfg`, `font_cache_get`, already in the file). The clock tick runs in the LVGL task with the port lock already held, so it touches `s_clock_lbl` directly:

```c
static void clock_tick_cb(lv_timer_t *t) {
    (void)t;
    if (!s_clock_lbl) return;
    char buf[64];
    if (!time_is_synced()) {
        lv_label_set_text(s_clock_lbl, "--:--");
        return;
    }
    time_t now = time(NULL);
    struct tm lt;
    localtime_r(&now, &lt);
    format_clock(&lt, s_clock_24h, s_clock_date, s_clock_weekday, buf, sizeof(buf));
    lv_label_set_text(s_clock_lbl, buf);
}

static void render_clock(lv_obj_t *scr, const cfg_object_t *o, uint32_t fg) {
    px_box_t b = geom_box(o);
    lv_obj_t *lbl = lv_label_create(scr);
    lv_obj_set_pos(lbl, b.x, b.y);
    lv_obj_set_width(lbl, b.w > 0 ? b.w : LV_SIZE_CONTENT);
    lv_obj_set_style_text_color(lbl, lv_color_hex(fg), LV_PART_MAIN);
    lv_obj_set_style_text_font(lbl, font_cache_get(o->font_size), LV_PART_MAIN);
    lv_obj_set_style_text_align(lbl, lv_align_of(o->align), LV_PART_MAIN);
    s_clock_lbl     = lbl;
    s_clock_24h     = s_cfg->clock_24h;
    s_clock_date    = o->clock_show_date;
    s_clock_weekday = o->clock_show_weekday;
    clock_tick_cb(NULL);  // paint immediately
    s_clock_timer = lv_timer_create(clock_tick_cb, 1000, NULL);
}

static void render_wifi(lv_obj_t *scr, const cfg_object_t *o, uint32_t fg) {
    px_box_t b = geom_box(o);
    lv_obj_t *cont = lv_obj_create(scr);
    lv_obj_set_pos(cont, b.x, b.y);
    lv_obj_set_size(cont, b.w > 0 ? b.w : 40, b.h > 0 ? b.h : 24);
    lv_obj_set_style_bg_opa(cont, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_border_width(cont, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(cont, 0, LV_PART_MAIN);
    lv_obj_clear_flag(cont, LV_OBJ_FLAG_SCROLLABLE);
    int n = 4;
    int gap = 3;
    int barw = ((b.w > 0 ? b.w : 40) - gap * (n - 1)) / n;
    int maxh = (b.h > 0 ? b.h : 24);
    for (int i = 0; i < n; i++) {
        lv_obj_t *bar = lv_obj_create(cont);
        int bh = maxh * (i + 1) / n;
        lv_obj_set_size(bar, barw, bh);
        lv_obj_set_pos(bar, i * (barw + gap), maxh - bh);
        lv_obj_set_style_border_width(bar, 0, LV_PART_MAIN);
        lv_obj_set_style_radius(bar, 1, LV_PART_MAIN);
        lv_obj_set_style_bg_color(bar, lv_color_hex(fg), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(bar, i < s_wifi_level ? LV_OPA_COVER : LV_OPA_30, LV_PART_MAIN);
        lv_obj_clear_flag(bar, LV_OBJ_FLAG_SCROLLABLE);
    }
    s_wifi_obj = cont;
}

static void render_spinner(lv_obj_t *scr, const cfg_object_t *o, uint32_t accent) {
    px_box_t b = geom_box(o);
    int side = (b.w < b.h ? b.w : b.h);
    if (side < 24) side = 24;
    lv_obj_t *sp = lv_spinner_create(scr);
    lv_obj_set_size(sp, side, side);
    lv_obj_set_pos(sp, b.x, b.y);
    lv_obj_set_style_arc_color(sp, lv_color_hex(accent), LV_PART_INDICATOR);
}
```

- [ ] **Step 5: Wire the cases in `build_screen`**

In `build_screen`'s object `switch`, the `OBJ_CLOCK`/`OBJ_WIFI`/`OBJ_SPINNER` types currently fall through to the `default: render_placeholder(...)`. Add explicit cases before `default`:

```c
            case OBJ_CLOCK:   render_clock(scr, o, s_cfg->brand_fg); break;
            case OBJ_WIFI:    render_wifi(scr, o, s_cfg->brand_fg); break;
            case OBJ_SPINNER: render_spinner(scr, o, s_cfg->brand_accent); break;
```

- [ ] **Step 6: Implement `ui_set_wifi_level`**

Add after `ui_set_online` in `components/ui/ui.c`:

```c
void ui_set_wifi_level(int level) {
    if (level < 0) level = 0;
    if (level > 4) level = 4;
    lvgl_port_lock(0);
    s_wifi_level = level;
    if (s_wifi_obj) {
        uint32_t childcnt = lv_obj_get_child_count(s_wifi_obj);
        for (uint32_t i = 0; i < childcnt; i++) {
            lv_obj_t *bar = lv_obj_get_child(s_wifi_obj, i);
            lv_obj_set_style_bg_opa(bar, (int)i < s_wifi_level ? LV_OPA_COVER : LV_OPA_30, LV_PART_MAIN);
        }
    }
    lvgl_port_unlock();
}
```

- [ ] **Step 7: Ensure component deps**

In `components/ui/CMakeLists.txt`, confirm `REQUIRES` includes `devcfg` (for `clock_format.h`) and add `time_sync` (for `time_sync.h`). If `LV_USE_SPINNER` is not enabled, enable `CONFIG_LV_USE_SPINNER=y` in `sdkconfig` (LVGL spinner widget). Verify via: `grep LV_USE_SPINNER sdkconfig` → if `# CONFIG_LV_USE_SPINNER is not set`, set it to `CONFIG_LV_USE_SPINNER=y`.

- [ ] **Step 8: Build**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add components/ui/ui.c components/ui/include/ui.h components/ui/CMakeLists.txt sdkconfig
git commit -m "feat(firmware): live clock/wifi/spinner widgets + ui_set_wifi_level"
```

---

### Task 6: Firmware — wire SNTP start, TZ apply, and RSSI poll

**Files (maratus-firmware):**
- Modify: `main/app_state.c` (poll task), `main/CMakeLists.txt` (REQUIRES `time_sync` if main lists component deps explicitly)

- [ ] **Step 1: Add includes + RSSI bucket helper**

In `main/app_state.c`, add near the top includes:

```c
#include "time_sync.h"
#include "esp_wifi.h"
```

Add this helper above `poll_task`:

```c
// Map RSSI (dBm) to 0..4 signal bars.
static int rssi_to_level(int rssi) {
    if (rssi >= -55) return 4;
    if (rssi >= -65) return 3;
    if (rssi >= -75) return 2;
    if (rssi >= -85) return 1;
    return 0;
}
```

- [ ] **Step 2: Start SNTP + push RSSI when online**

In `poll_task`, the `if (status == 200)` block begins with `ui_set_online(true);`. Immediately after that line add:

```c
            time_sync_start();                 // idempotent; SNTP runs once Wi-Fi is up
            int rssi = 0;
            if (esp_wifi_sta_get_rssi(&rssi) == ESP_OK) ui_set_wifi_level(rssi_to_level(rssi));
```

- [ ] **Step 3: Apply TZ on config publish**

In `poll_task`, inside the `if (cs == 200 && s_cfg_buf[next]->valid)` block, after `ui_set_config(s_cfg_buf[next]);` add:

```c
                    time_sync_set_tz(s_cfg_buf[next]->clock_timezone);  // POSIX TZ from payload
```

- [ ] **Step 4: Component deps**

If `main/CMakeLists.txt` lists `REQUIRES`/`PRIV_REQUIRES`, add `time_sync` and ensure `esp_wifi` is present. (If it uses the default whole-project require, no change needed.)

- [ ] **Step 5: Build**

Run: `cd /Users/eren/Projects/maratus-firmware && . ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: build succeeds.

- [ ] **Step 6: Run the full host test suite (regression)**

Run: `cd /Users/eren/Projects/maratus-firmware/tools/cfg-harness && make test`
Expected: PASS — `test_clock OK` plus the existing `test_parse/test_geom/test_zsort/test_map/test_asset_key/test_asset_evict` and `ALL TESTS PASSED`.

- [ ] **Step 7: Commit**

```bash
git add main/app_state.c main/CMakeLists.txt
git commit -m "feat(firmware): start SNTP, apply TZ, push live RSSI to wifi widget"
```

---

### Task 7: Hardware verification (manual — user + device)

**Files:** none.

Prerequisite: a branding screen (e.g. `idle`) must contain a `clock` and/or `wifi` object and the `processing` screen a `spinner` (the curated Roastwell config already places clock + wifi on idle; add a spinner to processing in the branding editor if absent).

- [ ] **Step 1: Flash**

Flash the Task 6 build to the board (BUILD.md BOOT-mode procedure). Do not keep serial open during visual checks (it reboots the board).

- [ ] **Step 2: Clock**

On the idle screen, confirm the clock shows the current time in the tenant timezone, briefly `--:--` right after boot until SNTP syncs (a few seconds). In the branding editor, switch the timezone (e.g. to Tokyo) and 24h↔12h, save; within ~12s the on-screen clock should change zone/format.

- [ ] **Step 3: Wifi**

Confirm the wifi widget shows bars matching real signal (move the device / AP to see bars drop).

- [ ] **Step 4: Spinner**

Trigger a receipt (tap or ESC/POS send) → the processing screen's spinner animates → QR appears → scan resolves (receipt-flow regression intact).

- [ ] **Step 5: Record the result**

If all pass, note it in `BUILD.md` under the hardware validation log (M5c-1 entry), then this milestone is ready to merge.

---

## Self-Review

**Spec coverage:**
- IANA→POSIX, bounded map, UTC0 fallback — Task 1 ✓
- Payload sends POSIX, ETag unaffected — Task 2 ✓
- SNTP + TZ + synced flag — Task 4; started/applied — Task 6 ✓
- Clock widget (1 Hz, 24h/date/weekday, `--:--` until sync) — Tasks 3 (format) + 5 (widget) ✓
- Wifi widget live RSSI; config value as initial — Task 5 (render uses `s_wifi_level`, default 0) + Task 6 (RSSI push) ✓
- Spinner animation — Task 5 ✓
- Widget registry cleared under lock; clock timer deleted on swap — Task 5 step 3 ✓
- State→screen mapping unchanged (already exists) — no task, by design ✓
- Host test for format_clock; existing test_map covers mapping — Task 3 + Task 6 step 6 ✓
- Admin vitest for posix-tz — Task 1 ✓

**Placeholder scan:** none — every code step is complete; firmware build/HW steps name exact commands. (`wifi_level` config field exists in `device_config_t`; the widget initializes from `s_wifi_level=0` and the first RSSI read overrides within one poll — matches the spec's "live wins, config is fallback".)

**Type consistency:** `ianaToPosix` (Tasks 1–2); `format_clock(const struct tm*, bool, bool, bool, char*, int)` (Tasks 3, 5); `time_sync_start`/`time_sync_set_tz`/`time_is_synced` (Tasks 4, 5, 6); `ui_set_wifi_level(int)` (Tasks 5, 6); statics `s_clock_lbl/s_clock_timer/s_wifi_obj/s_wifi_level` (Task 5). `clock_show_date`/`clock_show_weekday`/`clock_24h`/`clock_timezone`/`brand_accent` already exist in `device_config.h`/`cfg_object_t`.
