# Addable Brand-Name Wordmark — Design

**Date:** 2026-06-25
**Repo:** `maratus-admin` (admin/editor only — no firmware change)
**Status:** Approved design, pre-implementation
**Follows:** [2026-06-24 Branding image object](2026-06-24-branding-image-object-design.md)

## Problem

The branding "image object" feature repurposed the on-screen `logo` widget to render
the brand **wordmark** (the organization name). For orgs that had an uploaded logo, the
one-time migration **converted their `logo` widgets into `image` objects** — so those
orgs have no `logo` widget left. Because `logo` is a non-addable, non-deletable widget
singleton, once such an org deletes its image there is **no way to show the brand-name
wordmark** from the editor. (Discovered on hardware 2026-06-25: deleting Roastwell's
image left an empty slot, no wordmark.)

## Goal

Let any org place the brand-name wordmark on any screen — including orgs whose logo was
migrated away — by making the wordmark widget **addable and deletable** in the layout
editor, as a per-screen singleton.

## Key facts that shape the design

- The device firmware already renders `OBJ_LOGO` as the wordmark, and the cloud already
  emits `logo` objects + a top-level `wordmark` field. Both were HIL-verified on
  2026-06-25. **So this change is entirely admin-side** — no firmware, no payload, no
  ETag, no new HIL.
- `logo` is in `WIDGET_TYPES` (singleton, ≤1 per screen) but **not** in `ADDABLE_TYPES`,
  and the editor treats it as non-deletable. `normalizePrinterConfig`'s `sanitizeScreen`
  already dedups widget singletons to ≤1 per screen.
- The preview's `LogoObject` already renders `brand.logoText` (the org name) as centered
  text. No preview change needed.

## Decisions (locked)

1. **Singleton:** at most one brand-name (`logo`) widget per screen. The "Add" control
   appears only when the screen has none.
2. **Wire type stays `logo`.** Only the UI label changes to "Brand name". This keeps the
   firmware/cloud contract untouched.
3. **Addable + deletable + hideable + movable.** Drag to move and the eye-toggle to hide
   already work; this adds add + delete.
4. **Does not count against `MAX_CUSTOM` (20).** It's a widget singleton, separate from
   the custom text/icon/image budget.

## Architecture

All changes in `lib/printer-layout.ts` and the editor components. No data-flow,
payload, preview, or firmware changes.

### `lib/printer-layout.ts`
- `TYPE_LABEL.logo`: `"Logo"` → `"Brand name"`. (`objectLabel()` derives from this, so
  the object list and properties header update automatically.)
- New factory `createBrandNameObject(z: number): PrinterObject` — a `logo`-type object
  with a sensible default box (reuse the seed logo geometry, ~`{x:0.25, y:0.32, w:0.5,
  h:0.16}`), `visible: true`, the given `z`, `id: "logo"`.
- No change to `OBJECT_TYPES`/`WIDGET_TYPES`/`ADDABLE_TYPES`/`sanitizeScreen`: `logo`
  stays a widget singleton; normalize already enforces ≤1 per screen and preserves it.

### `components/device-preview/printer-editor/use-printer-editor.ts`
- `hasBrandName: boolean` — true if the active screen already has a `logo` object.
- `addBrandName(): void` — if `!hasBrandName` and not disabled, append
  `createBrandNameObject(maxZ+1)` and select it. No-op if one already exists.
- Add both to the `PrinterEditor` interface and the returned object.

### `components/device-preview/printer-editor/printer-controls.tsx`
- Add a **"+ Brand name"** button beside "+ Text" / "+ Icon" / "+ Image", rendered only
  when `!editor.hasBrandName` (singleton guard); disabled when the editor is disabled.
  Calls `editor.addBrandName()`.
- Add `logo` to the object-list delete-button condition (currently
  `text | icon | image`) so the brand name can be removed.

## Data flow / preview / firmware

Unchanged. A `logo` widget in the config → cloud sends `wordmark` (= org name) + the
`logo` object → firmware `render_wordmark` draws the org name; preview `LogoObject` draws
`brand.logoText`. All already implemented and HIL-verified.

## Edge cases

- **Screen already has a logo widget** (non-migrated orgs, seeded screens): the "+ Brand
  name" button is hidden; the existing widget is now deletable.
- **Delete then re-add:** delete removes the `logo` object → button reappears → re-add
  restores it.
- **Reset layout:** `seededScreen` still includes a `logo` widget on some screens; after
  reset the button hides (already present). Unchanged behavior.
- **Two `logo` objects in stored data** (shouldn't happen): `sanitizeScreen` already
  keeps only the first — existing invariant, no new code.

## Cleanup

Remove the test `logo` widget injected into Roastwell's idle screen during the 2026-06-25
HIL session, so Roastwell starts clean and the new "+ Brand name" button can be dogfooded
to restore it.

## Testing

- **`lib/printer-layout.test.ts`:** `createBrandNameObject` returns a `logo` object with
  the default box; `TYPE_LABEL.logo === "Brand name"`; `normalizePrinterConfig` keeps at
  most one `logo` per screen (feed two → one survives) and preserves a single one.
- **Editor behavior (manual / component reasoning):** "+ Brand name" shows only when the
  screen has no `logo`; `addBrandName` is a no-op when one exists; delete removes it and
  the button returns.
- **Manual:** on a migrated org (Roastwell), add the brand name, confirm the preview
  shows the org name, save, confirm persistence; delete it, confirm the button returns.

## Out of scope

- Multiple brand-name widgets per screen.
- Any firmware change or new HIL (the device already renders it).
- Editing the wordmark text (it is always the org name, dynamic on rename).
