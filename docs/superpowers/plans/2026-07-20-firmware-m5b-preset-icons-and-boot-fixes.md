# Firmware M5b Preset Icons + Boot-bar Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the 16 lucide preset icons on-device (last M5b gap) and fix two deferred boot-splash edge cases.

**Architecture:** A build-time Node generator rasterizes the 16 lucide SVGs to 128×128 A8 sprites, emitting two generated C files in a new `components/icons/` component: a pure `icon_index.c` (name→index, host-testable) and an LVGL `icon_sprites.c` (the sprite arrays + `icon_preset_lookup`). `ui.c` gains `render_preset_icon` (LVGL image + `recolor`=tint + optional circle clip). Separately, `main/app_state.c` + `components/cloud` get two small boot-gate fixes.

**Tech Stack:** ESP-IDF 5.5, LVGL 9.3, C11, Node + `sharp` + `lucide-static` (generator only), cfg-harness (host C unit tests).

## Global Constraints

- **Repo: maratus-firmware ONLY.** Cloud contract is unchanged. (Spec + this plan live in maratus-admin per the cross-cutting-record convention.)
- **Build on ESP-IDF 5.5** (`. ~/.espressif/v5.5/esp-idf/export.sh`), target `esp32p4`. NOT 6.x.
- **Preset order is the contract:** the 16 names, in this exact order, mirror `maratus-admin/lib/printer-layout.ts` `ICON_PRESETS`: `check, check-circle, heart, star, gift, mail, thumbs-up, smile, clock, bell, alert-triangle, wifi-off, sparkles, party-popper, badge-check, coffee`. Index 0 (`check`) is the default for unknown/empty names (mirrors `DEFAULT_ICON_PRESET`).
- **Sprite format:** 128×128, `LV_COLOR_FORMAT_A8`, stride 128, `data_size` = 16384 bytes each.
- **Tint mapping:** `TINT_ACCENT`→accent, `TINT_MUTED`→muted, `TINT_WARN`→warn, `TINT_NONE`→fg; resolve against the per-screen palette (`cfg_screen_t.has_colors` → `col_accent/col_muted/col_fg`) first, else global `brand_*`. No per-screen `warn` column exists → warn always uses `brand_warn`.
- **Generated files are committed** (like the font binaries); CMake never runs the generator.
- **Firmware TDD reality:** only pure logic is host-tested (cfg-harness). Rendering + boot behavior are gated on `idf.py build` clean + hardware-in-the-loop (HIL). Do not fake a "unit test" for LVGL rendering.
- Commit after each task. Branch `feat/m5b-preset-icons`.

---

### Task 1: Icon sprite generator + generated C files

**Files:**
- Create: `tools/gen-icons/package.json`
- Create: `tools/gen-icons/gen-icons.mjs`
- Create: `tools/gen-icons/README.md`
- Create (GENERATED output): `components/icons/icon_index.c`
- Create (GENERATED output): `components/icons/icon_sprites.c`

**Interfaces:**
- Produces (consumed by Task 2/3): generated files declaring
  `#define ICON_PRESET_COUNT 16`, `extern const char *const ICON_PRESET_NAMES[ICON_PRESET_COUNT];`, `int icon_preset_index(const char *name);` (in `icon_index.c`), and `extern const lv_image_dsc_t ICON_PRESET_SPRITES[ICON_PRESET_COUNT];` + `const lv_image_dsc_t *icon_preset_lookup(const char *name);` (in `icon_sprites.c`). Headers are created in Task 2.

- [ ] **Step 1: Create the generator package manifest**

`tools/gen-icons/package.json`:
```json
{
  "name": "maratus-gen-icons",
  "private": true,
  "type": "module",
  "description": "Build-time: rasterize lucide preset icons to 128x128 A8 LVGL sprites. Output is committed; not run by CMake.",
  "scripts": { "gen": "node gen-icons.mjs" },
  "devDependencies": {
    "lucide-static": "^0.400.0",
    "sharp": "^0.33.0"
  }
}
```

- [ ] **Step 2: Write the generator**

`tools/gen-icons/gen-icons.mjs`:
```js
// Rasterize the 16 lucide preset icons to 128x128 A8 and emit two generated C
// files. Order MUST match maratus-admin lib/printer-layout.ts ICON_PRESETS.
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lucideDir = require.resolve("lucide-static/package.json").replace(/package\.json$/, "icons/");

const NAMES = [
  "check", "check-circle", "heart", "star", "gift", "mail", "thumbs-up", "smile",
  "clock", "bell", "alert-triangle", "wifi-off", "sparkles", "party-popper",
  "badge-check", "coffee",
];
const SIZE = 128;
const STROKE = 2; // lucide default; bump if any icon reads too thin on HW

async function alphaOf(name) {
  let svg = readFileSync(`${lucideDir}${name}.svg`, "utf8");
  // Force stroke width + full-canvas render; lucide is 24x24 viewBox, stroke-2, no fill.
  svg = svg.replace(/stroke-width="[^"]*"/g, `stroke-width="${STROKE}"`);
  const png = await sharp(Buffer.from(svg))
    .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  // Extract the alpha channel as an A8 plane.
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a8 = Buffer.alloc(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) a8[i] = data[i * info.channels + (info.channels - 1)];
  return a8;
}

function cArray(name, buf) {
  const id = name.replace(/-/g, "_");
  let out = `static const uint8_t ${id}_a8[${SIZE * SIZE}] = {\n`;
  for (let i = 0; i < buf.length; i += 16) {
    out += "  " + [...buf.subarray(i, i + 16)].map((b) => b).join(",") + ",\n";
  }
  return out + "};\n";
}

const buffers = [];
for (const n of NAMES) buffers.push([n, await alphaOf(n)]);

// icon_index.c — pure C, no LVGL (host-testable in cfg-harness).
let idx = `// GENERATED by tools/gen-icons/gen-icons.mjs — do not edit by hand.
#include "icon_index.h"
#include <string.h>

const char *const ICON_PRESET_NAMES[ICON_PRESET_COUNT] = {
${NAMES.map((n) => `  "${n}",`).join("\n")}
};

// Unknown / NULL / empty -> 0 (== "check", the cloud DEFAULT_ICON_PRESET).
int icon_preset_index(const char *name) {
  if (name && name[0]) {
    for (int i = 0; i < ICON_PRESET_COUNT; i++)
      if (strcmp(name, ICON_PRESET_NAMES[i]) == 0) return i;
  }
  return 0;
}
`;
writeFileSync(new URL("../../components/icons/icon_index.c", import.meta.url), idx);

// icon_sprites.c — LVGL descriptors (firmware only).
let spr = `// GENERATED by tools/gen-icons/gen-icons.mjs — do not edit by hand.
#include "icon_sprites.h"
#include "icon_index.h"

${buffers.map(([n, b]) => cArray(n, b)).join("\n")}
const lv_image_dsc_t ICON_PRESET_SPRITES[ICON_PRESET_COUNT] = {
${buffers.map(([n]) => {
  const id = n.replace(/-/g, "_");
  return `  { .header = { .magic = LV_IMAGE_HEADER_MAGIC, .cf = LV_COLOR_FORMAT_A8, .w = ${SIZE}, .h = ${SIZE}, .stride = ${SIZE} }, .data_size = ${SIZE * SIZE}, .data = ${id}_a8 },`;
}).join("\n")}
};

const lv_image_dsc_t *icon_preset_lookup(const char *name) {
  return &ICON_PRESET_SPRITES[icon_preset_index(name)];
}
`;
writeFileSync(new URL("../../components/icons/icon_sprites.c", import.meta.url), spr);
console.log(`generated ${NAMES.length} icons`);
```

- [ ] **Step 3: Write the README**

`tools/gen-icons/README.md`:
```markdown
# gen-icons

Rasterizes the 16 lucide preset icons to 128×128 A8 LVGL sprites and writes
`components/icons/icon_index.c` + `components/icons/icon_sprites.c` (both committed).

    cd tools/gen-icons && npm install && npm run gen

Order + names MUST match `maratus-admin/lib/printer-layout.ts` `ICON_PRESETS`. To
add/remove an icon: change the cloud list first, then update `NAMES` here and
regenerate. `STROKE` tunes line weight if an icon reads too thin on hardware.
Source: `lucide-static` (version pinned in package.json).
```

- [ ] **Step 4: Run the generator**

Run:
```bash
cd tools/gen-icons && npm install && npm run gen
```
Expected: `generated 16 icons`, and `components/icons/icon_index.c` + `icon_sprites.c` now exist.

- [ ] **Step 5: Verify the generated output**

Run:
```bash
cd tools/gen-icons
grep -c '_a8\[16384\]' ../../components/icons/icon_sprites.c        # expect 16
grep -c 'LV_COLOR_FORMAT_A8' ../../components/icons/icon_sprites.c  # expect 16
grep -c '"' ../../components/icons/icon_index.c                     # names present
```
Expected: 16 sprite arrays, 16 A8 descriptors, all names emitted. Spot-check one array is non-empty (an icon has non-zero alpha bytes).

- [ ] **Step 6: Commit**

```bash
git add tools/gen-icons components/icons/icon_index.c components/icons/icon_sprites.c
git commit -m "feat(icons): gen-icons tool + generated 128x128 A8 lucide preset sprites"
```

---

### Task 2: `components/icons/` component + host unit test for `icon_preset_index`

**Files:**
- Create: `components/icons/include/icon_index.h`
- Create: `components/icons/include/icon_sprites.h`
- Create: `components/icons/CMakeLists.txt`
- Modify: `tools/cfg-harness/Makefile` (add `icon_index.c` to `SRCS`)
- Modify: `tools/cfg-harness/test_cfg.c` (add `test_icon_index`)

**Interfaces:**
- Consumes: `icon_index.c` / `icon_sprites.c` from Task 1.
- Produces (consumed by Task 3): header `icon_sprites.h` → `const lv_image_dsc_t *icon_preset_lookup(const char *name);`

- [ ] **Step 1: Write the pure-index header**

`components/icons/include/icon_index.h`:
```c
#pragma once
#define ICON_PRESET_COUNT 16
extern const char *const ICON_PRESET_NAMES[ICON_PRESET_COUNT];
// Resolve a preset name to its sprite index. Unknown/NULL/"" -> 0 ("check").
int icon_preset_index(const char *name);
```

- [ ] **Step 2: Write the sprites header**

`components/icons/include/icon_sprites.h`:
```c
#pragma once
#include "lvgl.h"
#include "icon_index.h"
extern const lv_image_dsc_t ICON_PRESET_SPRITES[ICON_PRESET_COUNT];
// Never NULL: unknown/NULL/"" name resolves to the "check" sprite.
const lv_image_dsc_t *icon_preset_lookup(const char *name);
```

- [ ] **Step 3: Write the component CMakeLists**

`components/icons/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "icon_index.c" "icon_sprites.c"
                       INCLUDE_DIRS "include"
                       REQUIRES lvgl)
```

- [ ] **Step 4: Add the failing host test**

In `tools/cfg-harness/test_cfg.c`, add (and call from `main`, following the file's existing `RUN(test_...)`/assertion style):
```c
#include "icon_index.h"

static void test_icon_index(void) {
    // Every one of the 16 contract names resolves to a distinct, in-range index.
    for (int i = 0; i < ICON_PRESET_COUNT; i++) {
        int got = icon_preset_index(ICON_PRESET_NAMES[i]);
        assert(got == i);
    }
    // "check" is the default and index 0.
    assert(icon_preset_index("check") == 0);
    // Unknown / NULL / empty all fall back to the default (0 == "check").
    assert(icon_preset_index("not-a-real-icon") == 0);
    assert(icon_preset_index(NULL) == 0);
    assert(icon_preset_index("") == 0);
    printf("test_icon_index OK\n");
}
```

- [ ] **Step 5: Wire it into the Makefile and run to see it fail**

Add `../../components/icons/icon_index.c` to `SRCS` and `-I../../components/icons/include` to `CFLAGS` in `tools/cfg-harness/Makefile`. Then:
```bash
cd tools/cfg-harness && make test
```
Expected the FIRST time (before adding the `#include`/call correctly, or if the generated file is absent): a compile/link error. Once wired, it should build. Run to confirm the assertions execute.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd tools/cfg-harness && make test`
Expected: existing tests still pass AND `test_icon_index OK` prints; process exits 0.

- [ ] **Step 7: Commit**

```bash
git add components/icons/include tools/cfg-harness/Makefile tools/cfg-harness/test_cfg.c
git commit -m "feat(icons): icons component + host test for icon_preset_index"
```

---

### Task 3: `render_preset_icon` in `ui.c` + dispatch

**Files:**
- Modify: `components/ui/ui.c` (add `render_preset_icon`, change the `OBJ_ICON` dispatch)
- Modify: `components/ui/CMakeLists.txt` (add `icons` to `REQUIRES`)

**Interfaces:**
- Consumes: `icon_preset_lookup` (Task 2), existing `geom_box`, `cfg_screen_t`.
- Produces: on-device preset icon rendering (HIL-verified).

- [ ] **Step 1: Add `icons` to the ui component's REQUIRES**

In `components/ui/CMakeLists.txt`, add `icons` to the `REQUIRES` list so `icon_sprites.h` resolves.

- [ ] **Step 2: Add the tint resolver + render function**

In `components/ui/ui.c`, add `#include "icon_sprites.h"` with the other includes, then add near `render_image`:
```c
// Resolve an icon tint against the per-screen palette (when present) then the
// global brand palette. Warn has no per-screen column -> always brand_warn.
static uint32_t icon_tint_color(const cfg_object_t *o, const cfg_screen_t *sc) {
    switch (o->icon_tint) {
        case TINT_ACCENT: return sc->has_colors ? sc->col_accent : s_cfg->brand_accent;
        case TINT_MUTED:  return sc->has_colors ? sc->col_muted  : s_cfg->brand_muted;
        case TINT_WARN:   return s_cfg->brand_warn;
        case TINT_NONE:
        default:          return sc->has_colors ? sc->col_fg     : s_cfg->brand_fg;
    }
}

// A built-in preset icon: an embedded 128x128 A8 lucide sprite, recolored to the
// tint. No heap / async cache (unlike render_image) — the sprite is in flash.
static void render_preset_icon(lv_obj_t *scr, const cfg_object_t *o, const cfg_screen_t *sc) {
    const lv_image_dsc_t *dsc = icon_preset_lookup(o->icon_preset);  // never NULL
    px_box_t b = geom_box(o);
    lv_obj_t *img = lv_image_create(scr);
    lv_obj_set_pos(img, b.x, b.y);
    lv_obj_set_size(img, b.w > 0 ? b.w : 40, b.h > 0 ? b.h : 40);
    lv_image_set_inner_align(img, LV_IMAGE_ALIGN_CONTAIN);   // fit, keep aspect
    lv_obj_set_style_image_recolor(img, lv_color_hex(icon_tint_color(o, sc)), LV_PART_MAIN);
    lv_obj_set_style_image_recolor_opa(img, LV_OPA_COVER, LV_PART_MAIN);
    if (o->icon_circle) {
        lv_obj_set_style_radius(img, LV_RADIUS_CIRCLE, LV_PART_MAIN);
        lv_obj_set_style_clip_corner(img, true, LV_PART_MAIN);
    }
    lv_image_set_src(img, dsc);
}
```

- [ ] **Step 3: Change the dispatch**

In the `build_screen` switch (currently ~`ui.c:563-566`), change the `OBJ_ICON` case:
```c
            case OBJ_ICON:
                if (o->icon_src == ICON_UPLOAD) render_image(scr, o, fg);
                else render_preset_icon(scr, o, sc);
                break;
```
(`sc` is the `cfg_screen_t *` already in scope in `build_screen`.)

- [ ] **Step 4: Build clean**

Run:
```bash
. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build
```
Expected: build succeeds, no new warnings referencing `render_preset_icon`/`icon_sprites`. Flash usage rises ~256 KB (16 sprites) — still within budget.

- [ ] **Step 5: Commit**

```bash
git add components/ui/ui.c components/ui/CMakeLists.txt
git commit -m "feat(ui): render preset icons from embedded A8 sprites with tint + circle"
```

> **HIL gate (Task 6):** all 16 icons render as recognizable glyphs; accent/muted/warn/none tints correct; `circle:true` clips to a disc; a mixed screen (preset + uploaded icon + image) has no regression.

---

### Task 4: Boot-gate timeout overshoot fix

**Files:**
- Modify: `components/cloud/include/cloud.h` (add timeout variant)
- Modify: `components/cloud/cloud.c` (implement variant; existing call delegates)
- Modify: `main/app_state.c` (use remaining-budget timeout during the gate + re-check after the call)

**Interfaces:**
- Consumes: existing `cloud_get_commands`, `BOOT_GATE_TIMEOUT_MS`, `s_boot_gate`, `s_boot_start_ms`, `now_ms()`.
- Produces: bounded boot-splash overshoot.

- [ ] **Step 1: Add a timeout-parameterized variant in the header**

In `components/cloud/include/cloud.h`, next to `int cloud_get_commands(char *out, int cap);` add:
```c
// Like cloud_get_commands but caps the HTTP timeout (ms). timeout_ms <= 0 uses
// the default. Used during the boot gate to bound splash overshoot.
int cloud_get_commands_to(char *out, int cap, int timeout_ms);
```

- [ ] **Step 2: Implement it; make the original delegate**

In `components/cloud/cloud.c`, refactor so `cloud_get_commands(out, cap)` calls `cloud_get_commands_to(out, cap, 0)`. In the `_to` body, when `timeout_ms > 0`, set `esp_http_client_config_t.timeout_ms = timeout_ms` (else leave the existing default). Do not change any other behavior.

- [ ] **Step 3: Use the remaining gate budget during boot**

In `main/app_state.c` `poll_task`, replace the boot-gate command fetch so that while `s_boot_gate` is set the call is bounded by the remaining budget, and re-check the deadline immediately after:
```c
        int status;
        if (mqtt_up) {
            status = 200;
        } else if (s_boot_gate) {
            int64_t left = BOOT_GATE_TIMEOUT_MS - (now_ms() - s_boot_start_ms);
            int to = left < 1000 ? 1000 : (int)left;   // floor so a live poll can still finish
            status = cloud_get_commands_to(body, sizeof(body), to);
            if (status != 200 && now_ms() - s_boot_start_ms >= BOOT_GATE_TIMEOUT_MS) {
                s_boot_gate = false;
                ESP_LOGW(TAG, "boot gate timed out; starting offline");
                ui_boot_progress(BOOT_OFFLINE);
                vTaskDelay(pdMS_TO_TICKS(BOOT_OFFLINE_HOLD_MS));
                s_state = DEV_IDLE;
                ui_render_state(DEV_IDLE);
            }
        } else {
            status = cloud_get_commands(body, sizeof(body));
        }
```
(This complements — does not remove — the existing top-of-loop timeout check.)

- [ ] **Step 4: Build clean**

Run: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: builds; no unused-function or signature warnings.

- [ ] **Step 5: Commit**

```bash
git add components/cloud/include/cloud.h components/cloud/cloud.c main/app_state.c
git commit -m "fix(boot): bound splash overshoot with a gate-budget command timeout"
```

> **HIL gate (Task 6):** with cloud unreachable at boot, the splash falls to the offline idle screen within ~`BOOT_GATE_TIMEOUT_MS` + one slice (no long hang), then self-heals online.

---

### Task 5: Swipe-during-gate input suppression fix

**Files:**
- Modify: `main/app_state.c` (include `s_boot_gate` in suppression + guard consumers)

**Interfaces:**
- Consumes: `s_boot_gate`, `s_display_asleep`, `s_wake_guard_until`, `ui_set_input_suppressed`, `ui_consume_tap`, `ui_consume_swipeup`.
- Produces: no input processed while the boot splash is up.

- [ ] **Step 1: Include the boot gate in both suppression sites**

In `main/app_state.c`, at the two `ui_set_input_suppressed(...)` calls (idle-slice ~398 and poll-loop ~448), add `s_boot_gate ||` to the condition:
```c
        ui_set_input_suppressed(s_boot_gate || s_display_asleep || now_ms() < s_wake_guard_until);
```

- [ ] **Step 2: Guard the consumers during the gate**

In `poll_task`, before the `ui_consume_tap()` / `ui_consume_swipeup()` handling, short-circuit while booting so a queued gesture is drained without acting:
```c
        if (s_boot_gate) {
            ui_consume_tap();
            ui_consume_swipeup();
        } else {
            if (ui_consume_tap()) continue;
            if (ui_consume_swipeup()) { run_settings_flow(); continue; }
        }
```

- [ ] **Step 3: Build clean**

Run: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add main/app_state.c
git commit -m "fix(boot): suppress touch/swipe while the boot splash gate is up"
```

> **HIL gate (Task 6):** swiping/tapping during the splash does nothing; Settings never opens until booted; normal input resumes the instant the gate clears.

---

### Task 6: HIL verification, BUILD.md, version bump, merge

**Files:**
- Modify: `BUILD.md` (new entry)
- Modify: the firmware version constant (per repo convention — same place bumped to `0.7.0` in `b24636d`)

- [ ] **Step 1: Flash and run the HIL checklist**

Flash: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py -p <port> flash monitor` (enter download mode per BUILD.md if auto-reset fails). Then verify, on device:
- Branding screen with all 16 preset icons → each renders as its recognizable glyph.
- One icon per tint (accent/muted/warn/none) → correct colors vs the admin preview.
- An icon with `circle:true` → clipped to a disc.
- A screen mixing a preset icon + an uploaded icon + an image → all three render (M5b upload path not regressed).
- Boot with cloud reachable → splash → READY → idle (no regression).
- Boot with Wi-Fi/cloud unreachable → splash falls to offline idle within ~26 s.
- Swipe/tap during the splash → nothing happens; Settings opens only after boot.

- [ ] **Step 2: Bump the firmware version**

Bump the reported version constant one patch level above `0.7.0` (per the repo's convention/location used in commit `b24636d`).

- [ ] **Step 3: Write the BUILD.md entry**

Add a `## M5b preset icons + boot-bar fixes (<date>, HW-verified)` section summarizing: A8 sprite approach + generator, `render_preset_icon` tint/circle, and the two boot-gate fixes, with the confirmed HIL results from Step 1.

- [ ] **Step 4: Commit, merge to main, push**

```bash
git add BUILD.md <version-file>
git commit -m "docs(build): M5b preset icons + boot fixes — HW-verified <date>; bump version"
git switch main && git merge --no-ff feat/m5b-preset-icons && git push
```

---

## Self-Review

**Spec coverage:**
- Preset icon rendering (generator, A8 sprites, component, render path, tint, circle) → Tasks 1–3. ✓
- Host test for the pure lookup → Task 2 (`icon_preset_index`; the spec's "`icon_preset_lookup`" is split into a host-testable pure index + a thin LVGL lookup — see note below). ✓
- Boot overshoot fix → Task 4. ✓
- Swipe-during-gate fix → Task 5. ✓
- HIL + BUILD.md + version + merge → Task 6. ✓
- Out-of-scope items are not implemented. ✓

**Spec refinement note:** the spec described a single `icon_preset_lookup`; the plan splits it into `icon_preset_index` (pure, host-testable, LVGL-free — so it compiles in cfg-harness) + `icon_preset_lookup` (thin, LVGL, firmware-only). Same behavior; strictly more testable. Spec updated to match.

**Placeholder scan:** no TBD/TODO; every code step has concrete code. ✓

**Type consistency:** `icon_preset_index(const char*)→int`, `icon_preset_lookup(const char*)→const lv_image_dsc_t*`, `ICON_PRESET_SPRITES[16]`, `ICON_PRESET_NAMES[16]`, `render_preset_icon(scr,o,sc)`, `icon_tint_color(o,sc)`, `cloud_get_commands_to(out,cap,timeout_ms)` — consistent across tasks. ✓
