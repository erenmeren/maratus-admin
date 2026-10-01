# Per-Screen Theming (Global + Optional Screen Override) — Design

**Date:** 2026-07-14
**Status:** Approved (brainstormed with owner; approach 1 of 3 selected)
**Scope:** Cloud only (admin studio + preview + device contract). Firmware rendering of per-screen colors is a separate maratus-firmware milestone.

## Problem

Branding colors (accent/background/text/muted) are tenant-wide: stored as four
`tenantSettings` columns and applied identically to all seven printer screens by
both the admin preview and the device firmware. Tenants want, e.g., a dark
"Midnight" error screen while keeping a light idle screen — today that is
impossible.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Override granularity | Full palette per screen (all 4 tokens: accent, bg, fg, muted) |
| Mode model | Global palette is the default; each screen may opt into an explicit override ("use custom colors for this screen"); turning the override off reverts the screen to global |
| Firmware rollout | Cloud ships first with a forward-compatible payload; old firmware ignores the new field and keeps rendering the global palette; a later maratus-firmware milestone consumes it |
| UI placement | Theme tab, below the (renamed) global colors section, scoped to the active screen selected via the filmstrip |
| Data location | Inside the `printerScreens` jsonb, on each screen entry (`screens[s].colors`) — no DB migration |

## Data model (`lib/printer-layout.ts`)

```ts
export interface ScreenColors {
  accent: string; // hex #rrggbb
  bg: string;
  fg: string;
  muted: string;
}

export interface ScreenLayout {
  objects: PrinterObject[];
  colors?: ScreenColors; // absent = inherit the global palette
}
```

- **All-or-nothing:** when `colors` is present all four fields must be valid hex.
  There is no partial override (mirrors the on/off switch in the UI).
- **Normalize** (`sanitizeScreen` inside `normalizePrinterConfig`): if the stored
  `colors` object has four valid hex strings (accepted with or without `#`,
  normalized to `#`-prefixed), keep it; otherwise drop the field so the screen
  inherits. Never throws.
- **v2→v3 migration** (`migrateV2ToConfig`) never produces `colors`.
- Seeded screens (`seededScreen`) never include `colors`.

## Effective palette resolution

New pure helper in `lib/printer-layout.ts` (exported, unit-tested):

```ts
export function screenColors(config: PrinterConfig, screen: PrinterScreen): ScreenColors | null
```

Returns the override or `null` (= use global). The preview merges it over the
global brand when computing root CSS variables:

- `PrinterPreview` already receives `config + screen`; before calling
  `printerRootStyle(brand)` it overlays the override (accent/bg/fg/muted) onto
  the `PrinterBrand` values. Object renderers are untouched — they all read the
  `--k-*` CSS variables.
- The filmstrip thumbnails therefore automatically render each screen with its
  own effective palette.
- The stage's accent-tinted glow and the active-thumbnail ring in
  `branding-studio.tsx` use the **active screen's effective accent** instead of
  the raw global accent.

## UI (Theme tab, `branding-studio.tsx`)

The Theme tab splits into two sections:

1. **Global colors** — the existing four color fields, suggested palettes, and
   preset themes, unchanged in behavior (section heading clarified to
   "Global colors"). Preset themes remain global-only.
2. **Screen colors — {active screen label}** — shows the active screen's name
   (selected via the filmstrip, same as today) with a hint that the screen is
   switched there, plus a switch: **"Use custom colors for this screen"**.
   - Turning the switch **on** seeds `screens[active].colors` from the current
     global palette and reveals: the same four color fields (scoped to the
     screen) and suggested palettes derived from the screen's accent.
   - Turning it **off** deletes `colors` from the screen entry (revert to
     global).

State flows through the existing draft: the override lives inside `config`, so
dirty tracking (`JSON.stringify` compare), Save (`printerScreens` form field),
Reset, and `router.refresh()` adoption all work without new plumbing.

## Editor hook (`use-printer-editor.ts`)

- **Bug-prevention fix (required):** `setObjects` currently replaces the whole
  screen entry with `{ objects: next }`, which would wipe `colors` on every
  object edit. Change to spread the existing entry:
  `{ ...config.screens[screen], objects: next }`.
- New editor method `setScreenColors(c: ScreenColors | null)` on `PrinterEditor`
  (the Theme panel reaches it via `draft.editor`) — writes/removes
  `screens[active].colors`; `null` removes the field. "Reset layout to default"
  keeps `colors` (it only reseeds `objects`); the stage-header Reset restores
  the entire server state as today.

## Device contract (`/api/device/config`)

- No payload shape change: the `config` object already ships verbatim; screen
  entries may now carry `colors`. Old firmware's cJSON parsing reads known keys
  only, so it ignores `colors` and keeps using the global `brandColor/bg/fg/muted`
  fields — graceful degradation, no breakage.
- The ETag (`computeConfigVersion`) is keyed on the stored `printerScreens`
  value, so adding/changing/removing an override invalidates the cache and
  devices re-fetch automatically.
- **Firmware follow-up (separate repo, out of scope here):** parse per-screen
  `colors` in `provisioning.c` into `device_config_t`, and have `build_screen()`
  prefer the screen palette when present. Until that ships, devices show the
  global palette everywhere while the admin preview shows per-screen colors.

## Edge cases

- Malformed/partial stored `colors` (missing key, bad hex, non-object) → dropped
  by normalize → screen inherits global. No crash path.
- Screens emptied to nothing still fall back to their seeds (existing behavior);
  seeds carry no `colors`.
- Turning the switch on and saving without changing any field persists an
  override equal to the global palette — harmless and explicit (the screen is
  now pinned; later global changes won't affect it). This is the intended
  semantic of the switch.

## Testing

Unit (`lib/printer-layout.test.ts`):
- normalize keeps a valid 4-color override (with and without `#` prefixes);
- normalize drops partial (3 of 4), invalid-hex, and non-object `colors`;
- v2 migration and seeded screens produce no `colors`;
- `screenColors()` returns the override when present, `null` otherwise.

Live QA (dev server, temp tenant recipe):
- switch on → screen preview + its filmstrip thumbnail change, other screens
  don't; switch off → reverts; object edits do NOT clear the override
  (setObjects fix); save round-trip persists; global edits still drive
  non-overridden screens.

## Files touched

- `lib/printer-layout.ts` — `ScreenColors`, `ScreenLayout.colors`, normalize,
  `screenColors()` helper
- `lib/printer-layout.test.ts` — new cases above
- `components/device-preview/printer-editor/use-printer-editor.ts` —
  `setObjects` spread fix, `setScreenColors`
- `components/device-preview/printer-preview.tsx` — overlay override onto brand
  when computing root style
- `components/branding-studio/branding-studio.tsx` — Theme tab split
  (Global colors / Screen colors + switch), effective-accent for glow/ring

No DB migration, no API route changes, no new dependencies.
