# Firmware Wi-Fi Setup Screen Redesign — Design

**Date:** 2026-07-11
**Repo:** maratus-firmware (firmware-only; no cloud changes)
**Status:** Approved

## Problem

The first-boot Wi-Fi setup screen (`components/ui/ui_wifi.c`, M6a-2) works but has
UX defects reported from real use:

1. **Connect button overlaps the text field.** The button is aligned
   `TOP_RIGHT, -16, 352` while the 680-wide textarea (`TOP_MID, 0, 356`) spans
   x=20–700 — the button sits on top of the textarea's right end.
2. **SSID selection gives no feedback.** Tapping a list row only sets internal
   flags; the row is not highlighted and the chosen network name is never shown.
   The only cue is the textarea placeholder switching to "Password".
3. **Off-brand styling.** The screen uses LVGL's default theme (Montserrat font,
   blue buttons) while the rest of the device UI uses the brand font via
   `font_cache` on the Maratus-green background.

The on-screen keyboard is explicitly fine and must not change (size, position,
behavior, or styling).

## Decision

Staged two-panel flow on a **single LVGL screen**: a full-height network-list
stage, then a password stage that displays the chosen network's name. Panels are
toggled with `LV_OBJ_FLAG_HIDDEN`; all widgets (including the keyboard) are
created once in `ui_wifi_show()`. This keeps memory churn at zero on the
PSRAM-tight ESP32-P4 and is fully compatible with the existing passive
flag/consume API.

Rejected alternatives:
- **Separate `lv_screen` per stage** (slide animations): recreates the keyboard
  and widgets on every transition — memory churn, and complicates the passive
  API's object lifetime.
- **In-place fix only** (move button, highlight row): doesn't solve the cramped
  300px list or the "which network am I typing the password for?" gap.

## Screen flow (720×720)

### Stage 1 — List

Keyboard and textarea are hidden in this stage (today they occupy the bottom
440px for no reason while the user is only choosing a network).

- Title: `Choose your Wi-Fi` — brand font (bold, ~28px), white, top-center.
- Full-height network list, 680 × ~560 (from below the title to near the bottom
  edge): rows ~64px tall (finger-sized targets), `LV_SYMBOL_WIFI` + SSID.
- `Other network...` (`LV_SYMBOL_PLUS`) and `Rescan` (`LV_SYMBOL_REFRESH`) remain
  as trailing list rows.

### Stage 2 — Password

Shown when a secured network row is tapped. Layout (user-approved):

```
┌────────────────────────────────┐
│ [←]      Roastwell_5G          │  ← back button + network name (bold)
│                                │
│  Enter the Wi-Fi password      │  ← status line
│                                │
│ ┌─────────────────┐ ┌───────┐  │
│ │ ••••••••        │ │Connect│  │  ← side by side, no overlap
│ └─────────────────┘ └───────┘  │
│                                │
│ ┌────────────────────────────┐ │
│ │    KEYBOARD (unchanged)    │ │
│ └────────────────────────────┘ │
└────────────────────────────────┘
```

- Back button `[←]` top-left, ≥48×48 touch target (`LV_SYMBOL_LEFT`).
- **Selected network name as the bold title** — this is the selection feedback:
  the tap immediately transitions the screen and names the network.
- Status line below the title (`Enter the Wi-Fi password`, errors).
- Password textarea (~480px) and Connect button (~160px) side by side on one
  row, clear of each other.
- Keyboard at the bottom, 720×280, untouched.

### Special cases

- **Open network:** tapping it shows stage 2 with the input row hidden and
  status `Connecting...` — connects directly (no password step), matching the
  current orchestrator behavior.
- **Manual entry** (`Other network...`): same stage-2 panel with title
  `Other network`, placeholder `Network name`, button label `Next`. After a
  valid SSID is submitted the title becomes the typed SSID, the field switches
  to password mode (placeholder `Password`), and the button label becomes
  `Connect` — the existing two-press flow, now visually legible.
- **Wrong password:** returns to the password panel; status line shows
  `Couldn't connect - check the password` (existing copy).
- **Back from stage 2:** returns to the list stage; state machine returns to
  `LIST`. Rescan is only reachable from the list stage (unchanged).

## API changes (`components/ui/ui_wifi.c`, `components/ui/include/ui.h`)

The passive pattern is preserved: LVGL callbacks only set volatile flags; the
orchestrator polls `consume_*` readers; every public function takes the LVGL
port lock. New/changed surface:

| Function | Change |
|---|---|
| `ui_wifi_show()` | Builds both panels once; starts in the list stage. |
| `ui_wifi_show_list()` | **New.** Switch to the list stage (Back, post-rescan). |
| `ui_wifi_show_connecting(const char *ssid)` | **New.** Stage-2 panel with input row hidden, status `Connecting...`. |
| `ui_wifi_consume_back()` | **New.** Back-button flag reader. |
| `ui_wifi_prompt_ssid()` | Same signature; now also switches to stage 2 in manual mode (title `Other network`, button `Next`). |
| `ui_wifi_prompt_password(ssid)` | Same signature; now also switches to stage 2 with the SSID as title and button `Connect`. |
| `ui_wifi_set_results / set_status / consume_selection / consume_rescan / consume_connect` | Signatures unchanged. `set_status` writes the stage-2 status line and the list-stage subtitle equivalently. |

## Orchestrator changes (`main/wifi_setup.c`)

The SCAN→LIST→PASSWORD→CONNECT state machine is nearly untouched; zero changes
to network logic (`net_scan`, `net_connect`, `appcfg_store_wifi_creds`,
`wifi_util_*` validation):

- `PASSWORD` state: add a `ui_wifi_consume_back()` branch → `ui_wifi_show_list()`,
  reset pending ssid, `st = LIST`.
- `CONNECT` state: call `ui_wifi_show_connecting(ssid)` before `net_connect()`
  (replaces the bare `set_status("Connecting...")`).
- Failure path unchanged: `prompt_password(ssid)` + error status → `PASSWORD`.

## Styling

- All labels move to the brand font via `font_cache_get()` (title bold ~28px,
  rows ~22px, status ~20px), matching `ui.c`'s screens. `ui_wifi_show()` calls
  `font_cache_begin_pass()` the way `build_screen()`/`build_splash()` do.
  (`font_cache_init` runs during UI init, which precedes `wifi_setup_run` —
  the splash is already up when Wi-Fi setup starts.)
- List rows restyled to the brand language: slightly translucent white row
  background on the Maratus-green screen, white text, rounded corners (~12px),
  taller rows.
- Connect button: white background, Maratus-green text — clear contrast on the
  green screen (replaces the default LVGL blue).
- Keyboard: no styling changes whatsoever.

## Error handling

Existing validation and copy are kept, surfaced on the status line:
`Enter a network name` (invalid manual SSID), `Password must be 8+ characters`,
`Couldn't connect - check the password`, `No networks - tap Rescan`.

## Testing / verification

- `wifi_util` host tests unaffected (no logic change).
- The UI itself is not host-testable; verification is clean build + HIL on the
  desk device (test AP `test_EXT`), covering: full-height list renders; tapping
  a secured SSID → password panel titled with that SSID; Back returns to the
  list; wrong password shows the error and stays recoverable; open-network
  direct connect; manual-entry two-step (`Next` → `Connect`); Rescan; and a
  successful connect persisting creds → device proceeds to claim flow.
- HIL note: Kconfig `MARATUS_WIFI_SSID/PASSWORD` must be `changeme` and
  `idf.py erase-flash` forces first boot (per M6a-2 notes).

## Scope guard

Firmware-only. No cloud/API changes, no keyboard changes, no signal-strength
icons or lock glyphs (explicitly deferred — user chose the staged redesign over
the "full polish" option).
