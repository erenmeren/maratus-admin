# Branding "Image" Object — Design

**Date:** 2026-06-24
**Repos:** `maratus-admin` (cloud/admin) + `maratus-firmware` (device)
**Status:** Approved design, pre-implementation

## Problem

The Branding page has a dedicated single-logo uploader: one tenant-wide image
(`tenantSettings.logoUrl`) that maps to a fixed `logo` widget on the device
screen. Users want to place **arbitrary images** anywhere on the screen, as
freely as they add text — not just one logo in one slot.

## Key facts that shaped the design

- An upload-capable layout object **already exists**: the `icon` object. Its
  `upload` source already does the whole job — R2 storage, presigned delivery,
  orphan cleanup, and on-device PNG rendering via the firmware's
  `render_image()`. The only thing making it "icon-ish" is the preset / tint /
  circle chrome and the name. So an `image` object is an icon-upload stripped of
  that chrome.
- On **actual hardware**, the `logo` widget renders **only** the uploaded image.
  When no logo is uploaded the device shows a placeholder outline — **not** a
  wordmark. The stylized wordmark (mark + `logoText`) exists only in the admin
  *preview*. The firmware has **no** text-wordmark rendering today.

  Consequence: making the logo slot "show the wordmark" is cleanest done by
  *migrating* the widget to the firmware's existing **text** renderer, not by
  writing new firmware wordmark code.

## Decisions (locked)

1. **Scope:** `image` is a real layout object you can add multiple times,
   anywhere — not a cosmetic rename.
2. **Logo's fate:** the dedicated single-logo uploader is **removed**; the
   top-level `logoUrl` is no longer sent to devices. Existing logos are
   migrated into the new model.
3. **Both repos** ship together: admin/cloud + firmware rendering + HIL verify.
4. **Modeling:** `image` is a **new first-class object type** that **reuses the
   `icon`-upload pipeline**, minus preset/tint/circle. (Rejected: reusing the
   `icon` type with a renamed button — conflates concepts; and an over-general
   "media" type — YAGNI.)
5. **Image resolution cap:** keep `normalizeUploadImage`'s 512px longest-side
   cap for now (matches icons, cheap PSRAM decode). Revisit only if visibly soft.

## Architecture

### A. New `image` object (maratus-admin)

**Type** (`lib/printer-layout.ts`)
- Add `"image"` to `OBJECT_TYPES`.
- `PrinterObject` gains `image?: PrinterImage` where
  `PrinterImage = { url?: string; signedUrl?: string }`.
  - `url` — R2 object key (persisted).
  - `signedUrl` — display-only presigned GET URL; **never persisted**.
- `sanitizeImage(raw)`: keep `url` if a non-empty string, drop `signedUrl`.
  Wire into `sanitizeObject`. Mirrors `sanitizeIcon`.
- `image` counts against the existing `MAX_CUSTOM` (20) per-screen cap, together
  with `text` + `icon`.

**Storage key** (`lib/storage.ts`)
- `imageStorageKey(orgId, assetId) => \`branding/${orgId}/images/${assetId}\``.

**Editor UI** (`components/device-preview/printer-editor/`, `components/branding-editor.tsx`)
- Add a **"+ Image"** button next to "+ Text" / "+ Icon" (`printer-controls.tsx`),
  gated by the same `atCustomCap` limit. Calls `editor.addImage()`
  (`use-printer-editor.ts`).
- Image properties panel: **upload / replace / remove** only (no preset, tint,
  circle).
- Upload flow mirrors icons exactly:
  - Client sets `image.url = "pending:<objectId>"` and
    `image.signedUrl = URL.createObjectURL(file)` for live preview; stashes the
    `File` in an `imageFiles` map keyed by objectId; on save sets
    `fd.set(\`image:${objectId}\`, file)`.
  - Client-side guard: `image/*` and ≤ 2 MB (toast on violation).

**Server action** (`app/(tenant)/tenant/branding/actions.ts`)
- After the existing icon-pending loop, add an image-pending loop: for each
  `o.type === "image"` with `o.image?.url?.startsWith("pending:")`, read the
  `image:<id>` file, validate (`image/*`, ≤ `MAX_LOGO_BYTES` 2 MB),
  `normalizeUploadImage` → PNG, `putObject(imageStorageKey(...), bytes,
  "image/png")`, rewrite `o.image.url` to the R2 key. Missing file → drop the
  object (or skip — see Edge cases).
- **Orphan cleanup:** extend the existing "delete R2 keys no longer referenced"
  pass to also collect `image` object keys (so removed/replaced images are
  deleted from R2).
- Remove the dedicated-logo upload handling and `logoUrl` write.

**Presign for delivery** (`lib/data.ts`)
- In both `getDeviceConfig` and `getTenantBranding`, the existing
  collect→presign→map-back walk also gathers `image` object `url`s and sets each
  object's `signedUrl`. (Can share one key-set pass with icons.)
- `getDeviceConfig`: stop presigning/sending the top-level `logoUrl`.
  `DeviceConfigPayload.logoUrl` is removed (or forced `null` for one release;
  see Compatibility).
- `getTenantBranding`: drop `logoUrl` / `hasLogo` from the returned view-model
  once the uploader UI is gone.

**Preview** (`components/device-preview/printer-preview.tsx`)
- Add an `ImageObject` case: `<img src={signedUrl ?? url} className="size-full
  object-contain" />`. Aspect ratio preserved.
- Remove/retire the `LogoObject` special-casing (kept only if needed for legacy
  parse; post-migration no `logo` objects are emitted).

**ETag** (`lib/device-config.ts`)
- No change needed: `printerScreens` already participates in
  `computeConfigVersion`, so adding/removing image objects rotates the ETag.
  Remove `logoUrl` from the version input once it's no longer delivered.

### B. One-time data migration (maratus-admin)

A migration script (TS, run once against Neon; loads env via
`lib/db/load-env.ts`) walks every `tenantSettings` row:

For each screen in `printerScreens`, replace each `logo` widget **in place**
(preserve `id`, `x`, `y`, `w`, `h`, `z`, `visible`):
- Org **has** `logoUrl` → becomes an **`image`** object with
  `image.url = <existing logoUrl key>` (reuse the existing R2 object; it's
  already a normalized PNG under `logos/`).
- Org has **no** `logoUrl` → becomes a **`text`** object with
  `text = logoText || organization.name`, sensible default `fontSize`/`align`
  (center). Preserves the brand-name slot via existing text rendering.

Then set `tenantSettings.logoUrl = null`. ETag rotates automatically; devices
re-fetch on next poll.

Idempotent: re-running finds no remaining `logo` widgets and is a no-op.

### C. Firmware (maratus-firmware)

Small, mirrors the icon-upload path.

- `components/devcfg/include/device_config.h`: add `OBJ_IMAGE` to
  `cfg_obj_type_t`; add `char image_url[CFG_URL_LEN]` to `cfg_object_t`.
- `components/devcfg/cfg_parse.c`:
  - `type_of`: `"image"` → `OBJ_IMAGE`.
  - per-object parse: for `OBJ_IMAGE`, read `image.signedUrl` → `image_url`.
  - Keep `OBJ_LOGO` parsing tolerant (legacy NVS configs) — see below.
- `components/ui/ui.c`:
  - `render_image()` URL routing: `OBJ_IMAGE` → `o->image_url`.
  - render dispatch: `case OBJ_IMAGE: render_image(scr, o); break;`.
  - `OBJ_LOGO`: becomes a no-op/placeholder (cloud stops emitting it; old NVS
    configs degrade gracefully instead of crashing).
- `main/app_state.c`: asset prefetch/evict gathers `OBJ_IMAGE` `image_url`s
  alongside icon upload URLs.
- Host test: `tools/cfg-harness/` — add `test_image_parse()` + an `image` object
  in a fixture; assert type + `image_url` capture.
- HIL: flash, upload an image in admin, confirm it renders on hardware
  aspect-correct; confirm a migrated org still shows its logo/wordmark.

## Compatibility / rollout

- **Firmware first or cloud first?** Either order is safe because the firmware
  change is tolerant: old firmware ignores unknown `image` objects (renders
  placeholder); new firmware ignores legacy `logo` objects. Recommended: land
  firmware-tolerant build, run the migration, then remove the logo uploader UI.
- `DeviceConfigPayload.logoUrl`: drop it. Old firmware that still reads top-level
  `logoUrl` simply gets `undefined` and renders the (now-migrated-away) logo
  placeholder — acceptable transient state, resolved once devices poll the
  migrated config.

## Edge cases

- **Pending image with no file on save:** drop the object (don't persist a
  dangling `pending:` marker). Matches the icon fallback intent.
- **MAX_CUSTOM cap:** image now shares the 20-object budget with text + icon;
  update the cap tooltip/label wording if it says "text and icons".
- **Orphan R2 objects:** replacing or deleting an image must delete its old key;
  reuse the icon orphan-cleanup pass.
- **Migration of multi-screen logos:** the same `logoUrl` key may be referenced
  by `logo` widgets on several screens; each becomes an `image` object pointing
  at the same key — presign dedups by key, fine.
- **Soft full-width images:** 512px cap may look soft at full width on the 720px
  panel; accepted for now, revisit.

## Testing

- **Admin unit:** `lib/printer-layout.test.ts` — `sanitizeImage` drops
  `signedUrl` / preserves `url`; normalize round-trip; cap enforcement counts
  image objects. Migration transform unit test (logo→image when logoUrl present,
  logo→text otherwise; logoUrl cleared; idempotent).
- **Firmware host:** `cfg-harness` `test_image_parse` + fixture.
- **Manual + HIL:** upload → place → preview parity → `/api/device/config`
  payload shows `image.signedUrl` → renders on hardware aspect-correct; migrated
  org verified.

## Out of scope

- New firmware wordmark/text-logo rendering (avoided via the text migration).
- Image transforms beyond contain-fit (cover/fill, rotation, crop).
- Raising the 512px resolution cap.
