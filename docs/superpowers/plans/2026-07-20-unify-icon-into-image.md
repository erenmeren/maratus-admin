# Unify icon→image + device widget parity + boot-fix extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Collapse the `icon` object type into `image` (uploads only), give the two seeded decorative icons default images, make the device's live widgets (esp. Wi-Fi) match the branding preview, and salvage the two boot-bar fixes onto a clean firmware branch.

**Architecture:** Cloud removes the `icon` type + preset system and converts any legacy `icon` object to `image` at read/save; the two seeded decorative spots point at static PNGs served from the Next app's `public/defaults/`. Firmware drops preset-icon rendering (a fresh branch off `main` never has it), restyles the Wi-Fi widget to the branding look, fixes the frozen-on-disconnect bug, and carries the cherry-picked boot fixes.

**Tech Stack:** Next.js 16 / React 19 / TS (cloud), ESP-IDF 5.5 / LVGL 9.3 / C11 (firmware), Node + sharp (PNG generation), Vitest (cloud tests), cfg-harness (firmware host tests).

## Global Constraints

- Two repos: **maratus-admin** (cloud) and **maratus-firmware**. Cloud + firmware changes ship on separate branches; firmware needs HIL before merge.
- The seeded decorative icons are `check` (Sent screen) and `wifi-off` (Error screen). Their lucide-static SVG filenames are `circle-check` and `wifi-off` (lucide 0.400 renamed check-circle→circle-check).
- Default images are **static app assets** at `public/defaults/check.png` and `public/defaults/wifi-off.png`, referenced by absolute URL (`BETTER_AUTH_URL` + path). NOT R2, no presigning.
- Backward compat is mandatory: an existing stored `icon` object must never error or render a broken box — it converts to `image` (uploaded-icon → image with that url; seeded-preset icon → the matching default image URL; any other preset → dropped).
- Firmware builds on ESP-IDF 5.5 (`. ~/.espressif/v5.5/esp-idf/export.sh`), target esp32p4.
- Firmware TDD reality: pure logic → cfg-harness; rendering/boot → build-clean + HIL. Cloud: Vitest for logic (normalize, seed).
- Commit after each task. Do NOT delete the abandoned `feat/m5b-preset-icons` branch.

---

### Task 1: Firmware — fresh branch with the salvaged boot fixes

**Files:** none authored; git surgery + build.

**Interfaces:** Produces branch `feat/image-unify-widgets` off `main` carrying the 3 boot commits, on which Task 2 builds.

- [ ] **Step 1: Create the branch off main and cherry-pick the boot commits**

```bash
cd /Users/eren/Projects/maratus-firmware
git switch main
git switch -c feat/image-unify-widgets
git cherry-pick a9dba88 72f10e6 6b66d83
```
Expected: three clean cherry-picks (they touch `main/app_state.c` + `components/cloud/cloud.{c,h}`; no icon files). If a conflict appears, STOP and report — it means an assumption is wrong.

- [ ] **Step 2: Build clean**

Run: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: success, no new warnings. (These commits already built clean on the old branch; this confirms they apply onto main.)

- [ ] **Step 3: Confirm the branch has no icon artifacts**

Run: `ls components/icons tools/gen-icons 2>&1 | head; git log --oneline main..HEAD`
Expected: `components/icons` and `tools/gen-icons` do NOT exist; log shows exactly the 3 boot commits.

- [ ] **Step 4: (no commit — cherry-picks already committed)** proceed to Task 2 on this branch.

---

### Task 2: Firmware — Wi-Fi widget parity + disconnect fix + defensive icon→image

**Files:**
- Modify: `components/ui/ui.c` (`render_wifi`; the `OBJ_ICON` dispatch case)
- Modify: `main/app_state.c` (drop Wi-Fi level on disconnect)

**Interfaces:**
- Consumes: existing `render_image`, `geom_box`, `s_wifi_level`, `ui_set_wifi_level`, `net_is_connected`, the poll loop.
- Produces: device Wi-Fi rendering matching the branding `WifiObject`; bars reflect disconnection; stray `icon` objects render as images.

- [ ] **Step 1: Restyle `render_wifi` to match the branding preview**

The branding `WifiObject` (maratus-admin `components/device-preview/printer-preview.tsx`) draws 4 bars: heights `[0.45, 0.65, 0.85, 1] × min(w,h)`, bar width `≈ 0.22 × base`, gap `≈ 0.14 × base`, corner radius `≈ 0.10 × base`, active bars `brand_fg` at ~85% opacity, inactive at ~20%, bottom-aligned. Replace the current linear-height/`radius 1`/`(i+1)/n` loop in `render_wifi` with these proportions. Example replacement for the bar loop (keep the container + `s_wifi_obj = cont;` bookkeeping):
```c
    const float heights[4] = {0.45f, 0.65f, 0.85f, 1.0f};
    int base = (b.w > 0 ? b.w : 40); if ((b.h > 0 ? b.h : 24) < base) base = (b.h > 0 ? b.h : 24);
    int barw = (int)(base * 0.22f); if (barw < 1) barw = 1;
    int gap  = (int)(base * 0.14f); if (gap < 1) gap = 1;
    int rad  = (int)(base * 0.10f);
    int maxh = (b.h > 0 ? b.h : 24);
    for (int i = 0; i < 4; i++) {
        lv_obj_t *bar = lv_obj_create(cont);
        int bh = (int)(maxh * heights[i]);
        lv_obj_set_size(bar, barw, bh);
        lv_obj_set_pos(bar, i * (barw + gap), maxh - bh);
        lv_obj_set_style_border_width(bar, 0, LV_PART_MAIN);
        lv_obj_set_style_radius(bar, rad, LV_PART_MAIN);
        lv_obj_set_style_bg_color(bar, lv_color_hex(fg), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(bar, i < s_wifi_level ? (lv_opa_t)217 : (lv_opa_t)51, LV_PART_MAIN); // ~85% / ~20%
        lv_obj_clear_flag(bar, LV_OBJ_FLAG_SCROLLABLE);
    }
```
Apply the same active/inactive opacity (217/51) in `ui_set_wifi_level`'s per-bar update loop so live level changes keep the new look.

- [ ] **Step 2: Drop the Wi-Fi level on disconnect in the poll loop**

In `main/app_state.c`, in the `if (!net_is_connected())` branch (the one that calls `ui_set_online(false)` then delays), also call `ui_set_wifi_level(0);` so the bars fall to empty when the network is lost (fixes the frozen-"connected" bug). Leave the successful-poll path (which sets the live RSSI level) unchanged.

- [ ] **Step 3: Route a stray `OBJ_ICON` to the image path (defensive)**

The cloud will stop sending `icon` objects (converted to `image`), but be defensive: in `ui.c`'s `build_screen` dispatch, change the `OBJ_ICON` case to render via the image path using `icon_url` when present, else skip (no placeholder box):
```c
            case OBJ_ICON:
                if (o->icon_url[0]) render_image(scr, o, fg);  // legacy: treat as an image
                break;
```
(`render_image` already reads `o->icon_url` for the `OBJ_ICON` type.) Do not reintroduce any preset/sprite code.

- [ ] **Step 4: Build clean**

Run: `. ~/.espressif/v5.5/esp-idf/export.sh && idf.py build`
Expected: success, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add components/ui/ui.c main/app_state.c
git commit -m "feat(ui): Wi-Fi widget matches branding style + drops on disconnect; icon->image fallback"
```

> **HIL gate (later, user):** Wi-Fi bars look like the branding preview; killing Wi-Fi empties the bars; uploaded images + default images still render; boot fixes still hold.

---

### Task 3: Cloud — generate default decorative PNGs + a URL helper

**Files:**
- Create: `scripts/gen-default-images.mjs` (or reuse/retarget `tools/gen-icons`)
- Create: `public/defaults/check.png`, `public/defaults/wifi-off.png`
- Create/Modify: `lib/printer-layout.ts` (add a `DEFAULT_IMAGE_URL` helper) — or a small `lib/default-images.ts`

**Interfaces:**
- Produces: `defaultImageUrl(name: "check" | "wifi-off"): string` returning `${base}/defaults/${name}.png` (base from `BETTER_AUTH_URL`, no trailing slash). Consumed by Tasks 4 (normalize) and 5 (seed).

- [ ] **Step 1: Write the PNG generator**

`scripts/gen-default-images.mjs` — Node + `sharp` (already a dependency). Read the lucide-static SVGs `circle-check.svg` and `wifi-off.svg` (add `lucide-static` as a devDependency if not present: `npm i -D lucide-static`), render each to a 256×256 transparent PNG with a solid dark stroke (`stroke="#111827"`, width ~2 on the 24-viewBox, scaled), write to `public/defaults/check.png` and `public/defaults/wifi-off.png`.
```js
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dir = require.resolve("lucide-static/package.json").replace(/package\.json$/, "icons/");
mkdirSync("public/defaults", { recursive: true });
for (const [out, file] of [["check", "circle-check"], ["wifi-off", "wifi-off"]]) {
  let svg = readFileSync(`${dir}${file}.svg`, "utf8")
    .replace(/stroke="currentColor"/g, 'stroke="#111827"')
    .replace(/stroke-width="[^"]*"/g, 'stroke-width="2"');
  const png = await sharp(Buffer.from(svg)).resize(256, 256, { fit: "contain", background: { r:0,g:0,b:0,alpha:0 } }).png().toBuffer();
  writeFileSync(`public/defaults/${out}.png`, png);
  console.log(`wrote public/defaults/${out}.png (${png.length} bytes)`);
}
```

- [ ] **Step 2: Run it and verify**

```bash
node scripts/gen-default-images.mjs
file public/defaults/check.png public/defaults/wifi-off.png   # PNG image data, 256 x 256
```
Expected: two non-empty 256×256 PNGs.

- [ ] **Step 3: Add the URL helper**

Create `lib/default-images.ts`:
```ts
import { env } from "@/lib/env";
export type DefaultImageName = "check" | "wifi-off";
/** Absolute URL of a bundled default decorative image (served from public/defaults). */
export function defaultImageUrl(name: DefaultImageName): string {
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  return `${base}/defaults/${name}.png`;
}
```
(Confirm `env.BETTER_AUTH_URL` is the exported name in `lib/env.ts`; adjust if different.)

- [ ] **Step 4: Unit-test the helper**

`lib/default-images.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { defaultImageUrl } from "./default-images";
describe("defaultImageUrl", () => {
  it("builds an absolute /defaults URL with no double slash", () => {
    const u = defaultImageUrl("check");
    expect(u).toMatch(/\/defaults\/check\.png$/);
    expect(u).not.toMatch(/([^:])\/\//); // no accidental double slash outside protocol
  });
});
```
Run: `npx vitest run lib/default-images.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-default-images.mjs public/defaults lib/default-images.ts lib/default-images.test.ts package.json
git commit -m "feat(branding): default decorative PNGs (check, wifi-off) + defaultImageUrl helper"
```

---

### Task 4: Cloud — remove the `icon` type; convert legacy icons to images

**Files:**
- Modify: `lib/printer-layout.ts` (remove icon type/model/presets/`sanitizeIcon`; icon→image in `sanitizeObject`)
- Delete: `lib/printer-icons.ts` and `lib/printer-icons.test.ts`
- Modify: `components/device-preview/printer-preview.tsx` (remove `IconObject` + its switch case)
- Modify: editor as needed (`components/device-preview/printer-editor/*`) so no icon affordance remains (Add-image already exists — `ADDABLE_TYPES = ["text","image"]`, `editor.addImage`)
- Modify: `lib/printer-layout.test.ts` (icon→image conversion cases)

**Key anchors (verified 2026-07-20):**
- `sanitizeObject(raw, fallbackZ): PrinterObject | null` — line ~482; the per-object dispatch. Currently `if (type === "icon") { ... icon: sanitizeIcon(o.icon) }` at ~505, `if (type === "image")` at ~512.
- The keep-filter at ~548: `if (o.type === "text" || o.type === "icon" || o.type === "image")` inside `normalizePrinterConfig`.
- `normalizePrinterConfig(raw): PrinterConfig` — line ~588; the REAL (v3, per-screen) entry point. Called by `lib/data.ts:1097` and `:1239`, which feed BOTH the branding UI and the device config — so converting here fixes both automatically. (`normalizePrinterLayout` at 366 is the legacy v2 path; the v3 `sanitizeObject` is what matters.)

**Interfaces:**
- Consumes: `defaultImageUrl` (Task 3).
- Produces: an object model with only `image` (no `icon`); `sanitizeObject` maps legacy `icon`→`image` so `normalizePrinterConfig` never emits an icon.

- [ ] **Step 1: Write failing tests for the legacy conversion**

`sanitizeObject` is not exported, so test through `normalizePrinterConfig`. Read `normalizePrinterConfig` (line ~588) and `sanitizeObject` (~482) to learn the exact v3 input shape (screens/objects), then add tests to `lib/printer-layout.test.ts` constructing a config that shape accepts with an `icon` object, asserting it comes out as `image`:
```ts
// Sketch — fill the real v3 config shape from normalizePrinterConfig:
it("converts a legacy uploaded icon to an image", () => {
  const cfg = normalizePrinterConfig(/* v3 config w/ a screen holding
    { type:"icon", icon:{ source:"upload", url:"https://r2/x.png" }, ...box } */);
  const o = /* find that object in cfg.screens[…].objects */;
  expect(o.type).toBe("image");
  expect(o.image?.url).toBe("https://r2/x.png");
});
it("converts a legacy check preset icon to the default image", () => {
  const cfg = normalizePrinterConfig(/* …icon:{ source:"preset", preset:"check" } */);
  const o = /* find it */;
  expect(o.type).toBe("image");
  expect(o.image?.url).toMatch(/\/defaults\/check\.png$/);
});
```
Run to confirm FAIL (still "icon"): `npx vitest run lib/printer-layout.test.ts`.

- [ ] **Step 2: Remove the icon model from `lib/printer-layout.ts`**

Delete `ICON_PRESETS`, `DEFAULT_ICON_PRESET`, `IconPreset`, `IconTint`, `PrinterIcon`, `sanitizeIcon`, `ICON_TINTS`, the `icon?: PrinterIcon` field on the object type, and `"icon"` from `OBJECT_TYPES` / `TYPE_LABEL` / any size/default maps. Keep `image`/`PrinterImage`/`sanitizeImage`. (`ADDABLE_TYPES` already excludes icon.)

- [ ] **Step 3: Convert icon→image inside `sanitizeObject`**

In `sanitizeObject` (~482), replace the `if (type === "icon") {…}` branch so an icon becomes an image: build the object with `type: "image"`, preserving `id`/box/`visible`/`z`/`name`, and `image: { url: <u> }` where `<u>` = `icon.source === "upload" && icon.url ? icon.url : defaultImageUrl("check"|"wifi-off")` for a seeded preset (`check`→check, `wifi-off`→wifi-off); any OTHER preset → `return null` (drop). Then run it through the same `sanitizeImage` shape as a normal image. Update the keep-filter at ~548 to `o.type === "text" || o.type === "image"` (drop `"icon"`). Import `defaultImageUrl` from `@/lib/default-images`. Read the surrounding code to match the exact object-construction style.

- [ ] **Step 4: Delete `lib/printer-icons.ts` + its test; remove `IconObject`**

```bash
git rm lib/printer-icons.ts lib/printer-icons.test.ts
```
In `components/device-preview/printer-preview.tsx` remove the `IconObject` function, its `import { resolveIconComponent }`, and the `case "icon":` in the object switch.

- [ ] **Step 5: Clean the editor**

Remove any icon references in `components/device-preview/printer-editor/*` (properties/controls). Ensure an **Add image** button exists in the add-object toolbar (wire `editor.addImage`, which already exists). Remove `createIconObject` if still present anywhere.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run lib/printer-layout.test.ts lib/default-images.test.ts` → PASS (conversion tests now green). Then `npx tsc --noEmit` → no errors (catches any missed `icon` reference). Fix any dangling references the compiler finds.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(branding): remove icon object type; convert legacy icons to images"
```

---

### Task 5: Cloud — seed Sent/Error with the default images

**Files:**
- Modify: `lib/printer-layout.ts` (the Sent + Error seed layouts)
- Modify: `lib/printer-layout.test.ts` (seed assertions)

**Interfaces:**
- Consumes: `defaultImageUrl` (Task 3), the image object model (Task 4).

- [ ] **Step 1: Point the seeded Sent/Error decorative objects at default images**

The seed is `seededScreen(screen)` (line ~245); the `sent` case seeds a `check` preset icon and the `error` case a `wifi-off` preset icon (built via the `obj({...})` helper at ~235). Replace those `icon` objects with `image` objects at the same geometry: Sent → `obj({ …, type:"image", image:{ url: defaultImageUrl("check") } })`; Error → `image` with `defaultImageUrl("wifi-off")`. Keep x/y/w/h/z. (Circle/tint are gone — the PNG carries its own look.) Import `defaultImageUrl`.

- [ ] **Step 2: Assert the seed uses images**

Add to `lib/printer-layout.test.ts` (use the real `seededScreen` entry + `PrinterScreen` names `"sent"`/`"error"`):
```ts
it("seeds Sent and Error with default image objects (no icon type)", () => {
  const sent = seededScreen("sent").objects;
  const err  = seededScreen("error").objects;
  expect([...sent, ...err].every((o) => (o.type as string) !== "icon")).toBe(true);
  expect(sent.find((o) => o.type === "image")?.image?.url).toMatch(/\/defaults\/check\.png$/);
  expect(err.find((o) => o.type === "image")?.image?.url).toMatch(/\/defaults\/wifi-off\.png$/);
});
```
Run: `npx vitest run lib/printer-layout.test.ts` → PASS.

- [ ] **Step 2b: Smoke the preview locally**

Run `npm run dev`, open the branding studio, confirm the Sent + Error screens show the default check / wifi-off images (fetched from `/defaults/...`) and there is no "icon" anywhere in the editor; Add image works.

- [ ] **Step 3: Commit**

```bash
git add lib/printer-layout.ts lib/printer-layout.test.ts
git commit -m "feat(branding): seed Sent/Error with default decorative images"
```

---

## Self-Review

**Spec coverage:** Part 0 → Task 1; Part 3 (icon removal + Wi-Fi parity + disconnect fix) → Task 2; Part 2 (default PNGs) → Task 3 + seed in Task 5; Part 1 (remove icon type + backward compat) → Task 4. All covered.

**Placeholder scan:** the test/seed entry-point names (`normalizeObject`, `defaultConfig`) are marked "adjust to the real API" because they must be verified against the actual `lib/printer-layout.ts` exports at implementation time — the implementer is instructed to match the real names, not invent them. No other placeholders.

**Type consistency:** `defaultImageUrl(name)→string`, `DefaultImageName = "check"|"wifi-off"`, image objects use `image.url`. Consistent across Tasks 3–5. Firmware Task 2 reuses existing `render_image`/`ui_set_wifi_level` signatures.

**Sequencing:** Task 3 (helper) precedes Tasks 4–5 (which import it). Task 1 precedes Task 2 (same firmware branch). Cloud (3→4→5) and firmware (1→2) are independent tracks.
