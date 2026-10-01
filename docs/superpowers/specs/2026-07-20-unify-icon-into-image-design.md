# Unify "icon" into "image" + device widget parity + boot-fix extraction (design)

Date: 2026-07-20
Repos: **maratus-admin** (cloud) + **maratus-firmware**. Supersedes the preset-icon
approach in `2026-07-20-firmware-m5b-preset-icons-and-boot-fixes-design.md` (the
preset-icon half of that is dropped; its two boot-bar fixes are salvaged here).

## Why

Product decision: there is no real difference between an "icon" object and an
"image" object. Collapse them into one **image** type — companies upload whatever
picture they want. Separately, the device's hand-drawn widgets (notably the Wi-Fi
signal) look cruder than the branding-page preview; the device should match the
nicer branding rendering so preview and hardware are identical.

Consequence: the firmware preset-icon sprite work (branch `feat/m5b-preset-icons`)
is no longer needed — the device already renders uploaded images (M5b, HIL-passed).
Only that branch's two boot-bar fixes are kept.

## Decisions (from brainstorming)

1. Seeded Sent (`check`) / Error (`wifi-off`) decorative icons → **default images**
   (lucide rendered to PNG), so those screens still look complete out of the box.
2. Default images are served as **static assets from the Next app** (`public/defaults/…`),
   referenced by absolute URL — NOT R2. Static defaults never rotate, need no
   presigning, and are always available; preview and device fetch the same URL, so
   they render identically. (Refinement of the earlier "R2" idea — simpler for
   static assets.)
3. Device live widgets (Wi-Fi bars, spinner, countdown) restyled to match the
   branding preview; live behavior preserved. Clock already matches (shipped).
4. Firmware `feat/m5b-preset-icons` branch abandoned; its boot fixes are
   cherry-picked onto a fresh branch and shipped on their own.

---

## Part 0 — Firmware: extract the boot-bar fixes onto a clean branch

The two boot fixes are independent of the icon work (they touch `main/app_state.c`
+ `components/cloud/cloud.{c,h}`; the icon commits touch `components/ui/ui.c`,
`components/icons/`, `tools/gen-icons/`).

- New branch `fix/boot-bar-overshoot-swipe` off `main` (`b24636d`).
- Cherry-pick, in order: `a9dba88` (overshoot bound via gate-budget timeout),
  `72f10e6` (suppress swipe/tap during boot gate), `6b66d83` (extract
  `boot_gate_fallback_offline` + skip spurious poll-failed).
- Clean `idf.py build`. This branch merges after its HIL (reboot with cloud
  unreachable → splash falls to offline idle within ~26 s; swipe during splash is a
  no-op). `feat/m5b-preset-icons` is left abandoned (not merged, not deleted yet).

## Part 1 — Cloud: remove the `icon` object type (maratus-admin)

`icon` collapses into `image`. Files/areas (verify against current code):

- **`lib/printer-layout.ts`**: remove `PrinterIcon`, `IconPreset`, `IconTint`,
  `ICON_PRESETS`, `DEFAULT_ICON_PRESET`, `sanitizeIcon`, the `icon?` field on the
  object, and `"icon"` from the type unions / `OBJECT_TYPE_LABELS` / `ADDABLE_TYPES`
  / default-size maps. Keep `image`.
- **`lib/printer-icons.ts`**: delete the file (and its test) — no more lucide preset
  resolution.
- **`components/device-preview/printer-preview.tsx`**: delete `IconObject`; the
  `"icon"` case in the object switch is removed.
- **Editor** (`components/device-preview/printer-editor/`): remove any icon add /
  icon property affordances (there is no preset picker today, so this is small);
  ensure **Add image** is a first-class add-object button with upload (today the add
  toolbar only lists Clock + Wi-Fi — add Image + Text if not already addable).
- **Backward compatibility (critical):** existing tenant configs may contain stored
  `icon` objects. In the config `normalize`/parse path, convert a legacy `icon`
  object to an `image` object: an `icon` with `source:"upload"` and a url → an
  `image` with that url; a preset-source `icon` (no uploaded file) → mapped to the
  matching default image URL (Part 2) when it's one of the seeded presets
  (`check`/`wifi-off`), otherwise dropped. No config should error or render a broken
  object. This runs at read time, so no DB migration is required, but a one-shot
  normalization on save is acceptable.

## Part 2 — Default decorative images for Sent / Error

- Render lucide `check` and `wifi-off` (using the current lucide names
  `circle-check` / `wifi-off`) to PNG at a suitable size (e.g. 256×256, transparent
  background, the brand-neutral stroke). Reuse the already-written lucide→raster
  tooling (`tools/gen-icons` from the abandoned branch) retargeted to emit PNGs — or
  a small standalone script; either way the output is committed static files.
- Place them at `public/defaults/check.png` and `public/defaults/wifi-off.png` in
  maratus-admin.
- Seed layout (`lib/printer-layout.ts` seed for Sent/Error) references them as
  `image` objects with an absolute URL built from the app base
  (`BETTER_AUTH_URL` + `/defaults/check.png`). The data layer passes this URL
  through as the image `url` (no presigning for these). Both the branding preview
  (`ImageObject` uses `signedUrl ?? url`) and the device (fetches the URL via the
  asset cache) render the identical PNG.
- Note: these are decorative defaults; a tenant can replace either via Add image.

## Part 3 — Firmware: remove icon rendering + match branding widget styling

New branch (off `main`, or stacked after Part 0 lands) `feat/image-unify-widgets`.

- **Remove icon rendering:** delete the `OBJ_ICON` preset path and the
  `components/icons/` component + `tools/gen-icons/` (from the abandoned branch — so
  on a fresh branch they simply never exist). In `ui.c`'s dispatch, `OBJ_ICON` (if
  any legacy config still sends it) routes to the image renderer via `icon_url`;
  preferably the cloud stops sending `icon` entirely, so the firmware can treat a
  stray `icon` as an image or ignore it. Keep the existing `OBJ_IMAGE` path
  (M5b, HIL-passed) as the single picture renderer.
- **Wi-Fi widget parity:** restyle `render_wifi` (`ui.c`) to match the branding
  `WifiObject`: 4 bars with heights proportional to `[0.45, 0.65, 0.85, 1]` of the
  box, rounded corners (radius ~ bar-width × 0.1), inter-bar gap ~14 % of the fit
  size, filled `brand_fg` at `LV_OPA` ≈ 85 % for active bars and ≈ 20 % for
  inactive — visually identical to the preview. Live RSSI level preserved.
- **Wi-Fi disconnect fix (the bug the user hit):** today `ui_set_wifi_level` is only
  updated on a successful poll, so on network loss the bars freeze "connected."
  On `!net_is_connected()` in the poll loop, drop the level (e.g. to 0) so the bars
  reflect the outage. (The removed on-device status dot is not revived; the Wi-Fi
  widget is the connectivity signal.)
- **Spinner / countdown:** audit against the branding preview; align only if there's
  a visible mismatch, otherwise leave. Clock already matches (shipped) — do not
  touch.

## Testing

- **Cloud (local):** icon type gone from the editor; Add image works (upload → object
  renders); Sent/Error show the default images by default; a saved config that
  previously had an `icon` object loads and renders as an image (no error/broken
  box) — test both a legacy uploaded-icon and a legacy preset-icon config via the
  normalize path (unit test the conversion).
- **Firmware (HIL):** device Wi-Fi bars look like the branding preview; killing Wi-Fi
  drops the bars (no longer frozen "connected"); Sent/Error render the default
  images fetched from the app URL; no regression to uploaded-image rendering; boot
  fixes (from Part 0) still hold.

## Out of scope (YAGNI)

- Preset icon library / picker (removed entirely — uploads only).
- Reviving the on-device online status dot.
- Restyling clock (already parity) or non-mismatched widgets.
- Any R2 changes (default images are static app assets).
- Deleting the abandoned `feat/m5b-preset-icons` branch (leave it; just don't merge).
