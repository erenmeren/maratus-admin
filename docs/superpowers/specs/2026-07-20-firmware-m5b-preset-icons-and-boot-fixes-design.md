# Firmware — M5b preset icons + boot-bar minor fixes (design)

Date: 2026-07-20
Repo touched: **maratus-firmware only** (cloud contract unchanged). Spec lives here in
maratus-admin per the cross-cutting-record convention.

Two independent firmware deliverables, shipped together:

1. **Preset icon rendering** — close the last M5b gap (preset icons still draw as
   placeholder outlines).
2. **Boot-bar minor fixes** — two deferred edge cases in the boot splash gate.

---

## Part 1 — Preset icon rendering

### Background / contract (already in place, do NOT change)

The cloud branding studio offers 16 curated **lucide** preset icons
(`lib/printer-layout.ts` `ICON_PRESETS`): `check, check-circle, heart, star, gift,
mail, thumbs-up, smile, clock, bell, alert-triangle, wifi-off, sparkles,
party-popper, badge-check, coffee`. Default = `check`.

An icon object is delivered in `/api/device/config` as
`{ type:"icon", icon:{ source:"preset", preset:"check", tint:"accent"|"muted"|"warn"|"none", circle:bool } }`.

The firmware already fully parses this (`components/devcfg/cfg_parse.c`):
`cfg_object_t.icon_src` (`ICON_PRESET`/`ICON_UPLOAD`), `.icon_preset` (name string,
`CFG_PRESET_LEN=24`), `.icon_tint` (`TINT_ACCENT/MUTED/WARN/NONE`), `.icon_circle`.
All brand colors are available: `device_config_t.brand_fg/brand_accent/brand_muted/
brand_warn` plus per-screen overrides `cfg_screen_t.col_fg/col_accent/col_muted`
(`has_colors`).

The ONLY missing piece is turning the preset name into pixels. Today
`components/ui/ui.c` (~line 565) does `else render_placeholder(...)` for
`ICON_PRESET`.

### Approach: embedded A8 alpha sprites (chosen)

Rasterize each of the 16 lucide SVGs to a fixed **128×128 8-bit alpha
(`LV_COLOR_FORMAT_A8`)** bitmap at build time, embed as `lv_image_dsc_t` C arrays,
and render via LVGL image with `recolor` = the tint color. The A8 alpha channel is
the anti-aliased mask; `recolor` supplies the color, so tint is free and the shapes
match lucide exactly. Reuses the existing `render_image` positioning + circle-clip
pattern.

Flash cost: 16 × 128×128 × 1 byte ≈ **256 KB** (32 MB flash, ~30% free — negligible).

Rejected alternative — icon TTF font subset (~16 KB, scales at any size) — because
lucide **stroke** icons don't convert cleanly to filled font glyphs (need
stroke-expansion) and the build-time font generation is fiddly. Fidelity beats the
flash saving here.

### New component `components/icons/`

- **`icon_sprites.c`** (GENERATED, committed like the font binaries) — one
  `static const uint8_t <name>_a8[128*128]` per icon + a
  `static const lv_image_dsc_t <name>_dsc = { .header.cf = LV_COLOR_FORMAT_A8,
  .header.w = 128, .header.h = 128, .header.stride = 128, .data = ..., .data_size =
  128*128 }`, plus a name→dsc table.
- **`icon_sprites.h`** — `const lv_image_dsc_t *icon_preset_lookup(const char *name);`
  Unknown / empty name → the `check` sprite (mirrors cloud `DEFAULT_ICON_PRESET`),
  never NULL.
- **`CMakeLists.txt`** — `idf_component_register(SRCS "icon_sprites.c" INCLUDE_DIRS
  "include" REQUIRES lvgl)`; add `icons` to the `ui` component's `REQUIRES`.

### Generator `tools/gen-icons/`

Build-time DEV tool (not run by CMake — output is committed). Self-contained: its
own `tools/gen-icons/package.json` with `sharp` + `lucide-static` as devDependencies
(`npm install` inside the tool dir — keeps maratus-firmware's + maratus-admin's roots
clean). `lucide-static` ships the raw per-icon SVGs; `sharp` is already present in
maratus-admin but the tool pins its own copy.

- Reads the 16 lucide SVGs by `ICON_PRESETS` name from `lucide-static`.
- Rasterizes each SVG to 128×128, extracts the alpha channel → a 16384-byte A8
  buffer. Lucide viewBox is 24×24 stroke-width 2; scaled to 128 the stroke reads
  well at the on-device icon sizes (~115–144 px). Stroke width is a tunable constant
  in the generator (default: lucide's 2), bump if any icon reads too thin on HW.
- Emits `components/icons/icon_sprites.c` from a template + a `README` noting the
  source (lucide-static version) and how to regenerate.
- The 16 names are hard-coded to match `ICON_PRESETS` exactly; a mismatch is a
  generator error (keeps firmware ↔ cloud in lockstep).

### Render path `components/ui/ui.c`

New `render_preset_icon(lv_obj_t *scr, const cfg_object_t *o, const cfg_screen_t
*screen)` — parallels `render_image` but simpler (no heap, no async cache, no
delete-cb):

1. `const lv_image_dsc_t *dsc = icon_preset_lookup(o->icon_preset);`
2. `lv_obj_t *img = lv_image_create(scr);` set pos/size from `geom_box(o)`;
   `lv_image_set_inner_align(img, LV_IMAGE_ALIGN_CONTAIN);`
3. Tint → color: resolve `o->icon_tint` against the per-screen palette first
   (`screen->has_colors` → `col_accent/col_muted/col_fg`), else the global
   `brand_accent/brand_muted/brand_warn/brand_fg`. `TINT_NONE` → fg. (Warn has no
   per-screen override column today → falls back to `brand_warn`; acceptable.)
4. `lv_obj_set_style_image_recolor(img, lv_color_hex(tint), LV_PART_MAIN);`
   `lv_obj_set_style_image_recolor_opa(img, LV_OPA_COVER, LV_PART_MAIN);`
5. `o->icon_circle` → `lv_obj_set_style_radius(img, LV_RADIUS_CIRCLE, MAIN)` +
   `clip_corner(true)` (same as `render_image`).
6. `lv_image_set_src(img, dsc);`

Dispatch change at ~`ui.c:565`: `else render_preset_icon(scr, o, screen);`. The
`build_screen` loop must have the current `cfg_screen_t*` in scope to pass the
palette; if it currently passes only `fg`, thread the screen pointer through (small,
local).

### Testing

- **Host (`tools/cfg-harness`)**: the lookup is split so it's host-testable without
  LVGL — a pure `int icon_preset_index(const char *name)` (LVGL-free, in
  `icon_index.c`) plus a thin `icon_preset_lookup` = `&ICON_PRESET_SPRITES[
  icon_preset_index(name)]` (LVGL, firmware-only, in `icon_sprites.c`). The host
  test covers `icon_preset_index`: every one of the 16 names → its own index,
  and unknown / NULL / "" → 0 (`check`, the default). No LVGL rendering on host.
- **HIL (correctness gate)**: put all 16 preset icons on a branding screen →
  each renders as the correct recognizable glyph; tint accent/muted/warn/none each
  shows the right color; `circle:true` clips to a disc; a screen mixing a preset
  icon + an uploaded icon + an image still renders all three (no regression to the
  M5b upload path).

---

## Part 2 — Boot-bar minor fixes (`main/app_state.c`)

Both are deferred edge cases in the boot splash gate (`s_boot_gate`, stays on the
staged splash until the first successful cloud poll or `BOOT_GATE_TIMEOUT_MS`=25 s).

### 2a. Timeout overshoot

`s_boot_gate` elapsed is only checked at the TOP of the poll loop (app_state.c
~438). A blocking `cloud_get_commands` (~471) can run past the 25 s window, so the
splash can persist noticeably longer than intended.

Fix: bound the overshoot to at most one slice.
- `cloud_get_commands(char *out, int cap)` has no timeout parameter today (uses
  cloud.c's default `esp_http_client` timeout). Add a boot-scoped variant
  `cloud_get_commands_to(out, cap, timeout_ms)` (or a `timeout_ms` param threaded
  through) so, while `s_boot_gate` is set, the call's timeout is capped to the
  remaining gate budget (`BOOT_GATE_TIMEOUT_MS - elapsed`, floored at a small
  minimum). A hung first poll then can't blow past the deadline. The non-boot poll
  path keeps the existing default timeout unchanged.
- Re-check the gate deadline immediately after the blocking call returns non-200 and
  before the backoff `vTaskDelay`, transitioning to the offline idle screen the
  moment the deadline passes.

Result: splash never persists more than `BOOT_GATE_TIMEOUT_MS` + one loop slice.

### 2b. Swipe-during-gate blank splash

Input suppression (`ui_set_input_suppressed`, app_state.c ~398 and ~448) is keyed
only on `s_display_asleep || now_ms() < s_wake_guard_until` — NOT on `s_boot_gate`.
So a swipe/tap during the boot splash is processed (opening Settings / consuming a
tap over a not-ready UI), which can blank the splash.

Fix: include `s_boot_gate` in the suppression condition at both sites, and guard the
`ui_consume_tap()` / `ui_consume_swipeup()` consumers to no-op while `s_boot_gate` is
set. Input is released normally the instant the gate clears (online or timeout).

### Testing (HIL)

- Cloud reachable: splash advances to READY and idle as today (no regression).
- Cloud unreachable at boot: splash falls to the offline idle screen within
  ~`BOOT_GATE_TIMEOUT_MS` + one slice (no long overshoot), then self-heals online in
  the background.
- Swiping / tapping during the splash does nothing; Settings does not open until the
  device is booted.

---

## Delivery

- Branch `feat/m5b-preset-icons` in maratus-firmware (both parts; they're small and
  ship together as one HW-verification pass). Subagent-driven.
- Host harness green + `idf.py build` clean before flashing.
- HIL per the gates above. On pass: `BUILD.md` entry (M5b preset icons + boot fixes),
  merge to `main` (HW-verified convention), push.
- Version bump per the repo's convention.

## Out of scope (YAGNI)

- Per-object arbitrary icon color (contract only has the 4 tints).
- Multi-resolution sprites / runtime SVG rendering (fixed 128×128 + CONTAIN scaling
  is enough for the branding icon sizes).
- New preset icons beyond the cloud's 16 (add cloud-side first, then regenerate).
- A per-screen `warn` override column (not in the cloud contract today).
