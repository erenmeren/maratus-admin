# M6a-2 — On-screen Wi-Fi provisioning

**Date:** 2026-06-20
**Status:** Approved (design); implementation plan to follow.
**Repo:** maratus-firmware (device only — no cloud changes). Continues
`2026-06-18-firmware-m6a-provisioning-design.md` (M6a claim flow shipped 2026-06-20).

## Goal

On first boot (no stored Wi-Fi credentials) the device shows an interactive **Wi-Fi
setup screen**: scan → pick a network (or "Other network…" for hidden SSIDs) → enter
the password on an on-screen keyboard → connect → persist creds to NVS → continue into
the existing M6a claim flow. Once creds are saved, this screen never appears again.

This removes the last hand-configured value (`sdkconfig` Wi-Fi creds): a fresh device
needs nothing pre-set.

## Decisions (locked during brainstorming)

1. **First-boot only.** Show Wi-Fi setup only when no creds resolve. No "re-enter Wi-Fi
   on later connect failure" for already-provisioned devices (deferred).
2. **Network pick = scan list + manual entry.** Tap a scanned SSID, or "Other network…"
   to type a hidden SSID.
3. **Creds resolution = NVS → Kconfig (dev fallback, if non-default) → on-screen setup.**
   Mirrors the M6a device-key pattern. Kconfig stays a dev convenience.
4. **Network types:** WPA2-personal (password) + **open** (skip password). WPA2-Enterprise
   out of scope (YAGNI).
5. **Controller task + passive UI** (see Architecture) — network ops never run on the
   LVGL/UI thread.

## Boot flow change

Today (`main/app_main.c`): `net_start()` connects with Kconfig creds *before* the
provisioning check. New order:

1. `net_init()` — bring up Wi-Fi hardware (esp_netif/event/esp_wifi_remote) **without
   connecting**. (Split out of today's `net_start`.)
2. Resolve creds: NVS → Kconfig (if non-default) → none.
3. **Creds resolved** → `net_connect(ssid, pass)` (blocking ~15–20 s). On success →
   continue. On failure with *stored* creds → log + keep retrying the connect in the
   background (the device does **not** drop into the Wi-Fi setup UI — that recovery case
   is deferred, decision 1). The Wi-Fi setup screen is **only** entered when step 4 applies.
4. **No creds resolve** → run the **Wi-Fi setup phase** (below). Inside the phase, if the
   *user-entered* creds fail to connect, show the error and retry within the phase (loop
   back to password entry). On success, persist creds to NVS, then continue.
5. Wi-Fi up → the existing M6a path: `appcfg_has_device_key()` ? normal (`app_state_run`
   + escpos) : provisioning (`DEV_SETUP` + claim-poll).

So the Wi-Fi setup screen appears exactly when no creds resolve (a fresh device), precedes
the M6a provisioning/normal paths, and retries are handled *within* the phase.

## Architecture — controller task + passive UI

Scan and connect are blocking network ops; they must **not** run inside LVGL event
callbacks (the UI thread, under the LVGL lock). So:

- **Wi-Fi-setup phase** (runs at the front of the provisioning task, before the claim-poll
  loop): a state machine —
  `SCAN → SHOW_LIST → AWAIT_SELECTION → AWAIT_PASSWORD → CONNECTING → CONNECTED | FAILED`.
  It calls `net_scan` / `net_connect`, and drives the screen via the `ui_wifi` setters.
- **`ui_wifi` screen** (bespoke, interactive — **not** config-object-driven, like
  `build_splash`): `lv_list` (scan results) + `lv_textarea` + `lv_keyboard` + Scan/Connect
  buttons. It is **passive**:
  - The task pushes state in, under the LVGL lock: `ui_wifi_set_scan_results(aps,n)`,
    `ui_wifi_set_status(text)`, `ui_wifi_show()`.
  - The UI hands user input back via **consume-flags** (mirrors the existing
    `ui_consume_tap`): `ui_wifi_consume_selection()` → the tapped SSID (or a "manual" marker
    + typed SSID), `ui_wifi_consume_connect()` → `{ssid, password}` when Connect is pressed,
    `ui_wifi_consume_rescan()`.
  - LVGL event callbacks only set these flags/strings (no network calls).

Rejected alternative: driving `net_scan`/`net_connect` from LVGL event callbacks (or
`lv_async_call`) — runs blocking network I/O on the UI thread.

## Components & responsibilities

- **`net`** (`components/net`): split the current `net_start` into
  - `net_init(void)` — hardware/stack init, no connect.
  - `net_connect(const char *ssid, const char *pass)` → `bool` — set STA config + connect,
    block up to ~15–20 s, return connected. Reusable for both stored-creds and user-entered.
  - `net_scan(wifi_ap_record_t *out, int max)` → `int` count — `esp_wifi_remote_scan_start`
    (blocking) + `…_get_ap_records`.
  - keep `net_is_connected()`. `net_start()` may remain as a convenience (init + connect
    with resolved creds) for the normal path, or app_main orchestrates init+connect.
- **`appcfg`**: `appcfg_wifi_ssid()` / `appcfg_wifi_password()` (NVS key `wifi_ssid` /
  `wifi_pass`, Kconfig fallback), `appcfg_store_wifi_creds(ssid, pass)`,
  `appcfg_has_wifi_creds()`. Same `"maratus"` NVS namespace + helpers as the device key.
- **`ui_wifi`** (new file in the `ui` component): the interactive screen + setters/consumers
  above. Uses the embedded fonts + brand defaults already available.
- **pure `wifi_util`** (`components/devcfg`, host-tested): `wifi_util_dedupe_sort(aps, n)` —
  drop empty SSIDs, dedupe by SSID keeping the strongest RSSI, sort descending by RSSI;
  `wifi_util_valid_password(open, pass)` — open: any (ignored); WPA2: length 8–63;
  `wifi_util_valid_ssid(ssid)` — non-empty, ≤32 bytes.

## Error handling

- Scan returns 0 APs → status "No networks found", offer **Rescan**.
- Selected AP is **open** (authmode `WIFI_AUTH_OPEN`) → skip password, connect directly.
- `net_connect` fails (wrong password / timeout) → status "Couldn't connect — check
  password", return to password entry (retry); keep the selected SSID.
- "Other network…" → SSID textarea+keyboard first, then password entry.
- After a successful connect, persist creds to NVS **before** continuing, so a reboot
  skips Wi-Fi setup.

## Testing

- **Host (`tools/cfg-harness`):** `wifi_util` — dedupe/sort (duplicate SSIDs, empty SSIDs,
  RSSI ordering) and validation (SSID length, WPA2 password 8–63, open allows empty).
- **Device:** `idf.py build` clean (host tests green).
- **Hardware (HIL):** `idf.py erase-flash` + flash → Wi-Fi setup screen → scan lists
  nearby APs → tap `test_EXT` → on-screen keyboard password → "Connecting…" → connects →
  flows into the M6a pairing-code screen → claim → device online. Power-cycle: boots
  straight through (creds + key in NVS, no Wi-Fi screen). Also exercise: open network
  (no password step), wrong password (error + retry), "Other network…" manual SSID.

## Out of scope (future)

- Re-entering Wi-Fi setup when an already-provisioned device can't connect (network changed).
- WPA2-Enterprise / 802.1X, captive portals.
- A "forget Wi-Fi" / change-network UI after provisioning.
