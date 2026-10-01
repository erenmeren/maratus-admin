# Firmware M-Wi-Fi — IDF 5.5 Migration + C6 SDIO + Cloud Connectivity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the ESP32-P4 firmware from "display-only on ESP-IDF 5.4.4" to "full cloud printer" — migrate to ESP-IDF 5.5, enable the ESP32-C6 Wi-Fi over **SDIO** (esp_hosted), re-verify the display still renders, then re-enable networking and prove the device associates to Wi-Fi and reaches Maratus Cloud (online, config, ingest).

**Architecture:** Staged, hardware-in-the-loop migration. Each stage builds → flashes → verifies on the physical board, with an explicit success gate and rollback point. The display subsystem is re-validated on 5.5 **before** networking is touched, so a regression is attributed to the right cause. Wi-Fi uses esp_hosted's SDIO transport to the on-board C6; the root cause of the 5.4.4 failure (esp_wifi_remote's slave-select Kconfig not sourced → co-proc target defaulted to ESP32-H2 → SPI → crash) is resolved by 5.5, where `SLAVE_IDF_TARGET_ESP32C6` is selected (the Waveshare `brookesia` demo proves display+Wi-Fi on 5.5, same board).

**Tech Stack:** ESP-IDF **5.5**, Waveshare `esp32_p4_wifi6_touch_lcd_4b` BSP (ST7703 MIPI-DSI panel), `esp_wifi_remote` + `esp_hosted` (C6 over SDIO), LVGL v9 + `esp_lvgl_port`, the M1 cloud contract (`/api/device/*`). Repo: `~/Projects/maratus-firmware`.

**Testing model (read this — same as prior firmware milestones):** Hardware-in-the-loop. There are no host unit tests; each stage's gate is **build → flash → observe on-device**. Two device-handling facts learned in M2–M5 bring-up that this plan depends on:
- **Flashing:** use the **USB-to-UART** Type-C port. `idf.py -p <port> flash` works (auto-reset). If a flash ever fails to connect, enter download mode manually: unplug → hold `BOOT` → replug → release after ~2s; the port **re-enumerates** to a new `/dev/cu.usbmodem*` name (rediscover with `ls`).
- **Reading logs:** `idf.py monitor` drives this board's DTR/RTS and traps it in download mode — **do not use it**. Read the UART0 console passively instead (script in the Appendix), holding DTR/RTS low for normal boot.

**Starting point:** `main` of `maratus-firmware` builds + flashes on IDF 5.4.4 and boots to the "Maratus Ready" idle screen; networking is `#if 0` in `main/app_main.c`; touch is skipped via `tools/patch-deps.sh`. That commit is the rollback anchor.

---

## Expected 5.4 → 5.5 incompatibilities to check up front

Check these before/while building Stage 2; each has a likely fix:
- **esp_lcd MIPI-DSI panel API** — 5.4→5.5 had fewer breaks than 5.4→6.0, but verify `esp_lcd_dpi_panel_config_t` / `esp_lcd_panel_dev_config_t` fields the BSP + ST7703 driver use still exist. The BSP/ST7703 versions resolved for 5.5 may differ from 5.4; the component manager will re-pin. If a field is gone, it'll be a compile error in `managed_components/waveshare__*` — patch via `tools/patch-deps.sh` (same approach as the 5.4 `color_space`→`rgb_ele_order` fix, which on 5.5 may be unnecessary).
- **`esp_wifi_remote` Kconfig slave-select** — the whole point: on 5.5 confirm `SLAVE_IDF_TARGET_ESP32C6` is actually defined+selected (Stage 3 validates this explicitly). The `WIFI_RMT_*` `#ifndef` patch in `patch-deps.sh` may be a **no-op on 5.5** (its Kconfig may be complete) — the script is idempotent and prints "anchor not found" if so; that's fine.
- **LVGL / esp_lvgl_port versions** — the component manager re-resolves for 5.5. Keep `lvgl/lvgl: "~9.3.0"`; if `esp_lvgl_port` resolves to a version needing a different LVGL, adjust the pin (Stage 2 surfaces it as a compile error like the `RGB565_SWAPPED` one).
- **Driver split** — already handled (BSP REQUIRES `esp_driver_ledc`/`gpio`/`i2s`/`i2c`/`spi`/`sdmmc` via `patch-deps.sh`); 5.5 keeps the split. No action expected.
- **`json` vs `cjson`** — 5.5 still bundles `json` (cJSON); keep `REQUIRES json` in `components/cloud`. (The `cjson` swap was a 6.0-only thing.)
- **NVS / esp_http_client / esp-tls / nvs_flash APIs** — stable 5.4→5.5; no action expected.
- **`usb` component** — 5.5 still bundles `usb` in core (the BSP's `PRIV_REQUIRES usb`); do **not** add `espressif/usb` (that was a 6.0-only fix).

---

### Task 1: Rollback anchor — branch off the working 5.4.4 build

**Files:** (git only)

- [x] **Step 1: Confirm the working baseline** — clean tree on `main` at `767597a` (display-only).

```bash
cd ~/Projects/maratus-firmware
git status --short            # expect clean
git log --oneline -1          # expect the display-only commit (767597a-ish)
```
Expected: clean tree on `main`, last commit is the stable display-only state.

- [x] **Step 2: Create the migration branch** — on `m-wifi-idf55`.

```bash
git checkout -b m-wifi-idf55
```

- [x] **Step 3: Commit a marker (so rollback is one command)** — marker `9b825be`, `main` untouched.

```bash
git commit --allow-empty -m "chore: start M-Wi-Fi (IDF 5.5 migration) from working 5.4.4 display-only build"
```

**Success criteria:** on branch `m-wifi-idf55`, `main` untouched.
**Rollback (any later stage):** `git checkout main` + reflash the 5.4.4 build (re-activate 5.4.4, `idf.py build flash`) restores the known-good display-only device.

---

### Task 2: Install ESP-IDF 5.5

**Files:** (toolchain only)

- [ ] **Step 1: Clone + install IDF 5.5 (skip if already present)**

```bash
ls -d ~/.espressif/v5.5* 2>/dev/null && echo "5.5 present" || echo "need install"
# if needed (multi-GB, ~10-30 min):
mkdir -p ~/esp && cd ~/esp
git clone -b release/v5.5 --depth 1 --recursive https://github.com/espressif/esp-idf.git esp-idf-v5.5
cd ~/esp/esp-idf-v5.5 && ./install.sh esp32p4
```

- [ ] **Step 2: Verify activation + version**

```bash
source ~/esp/esp-idf-v5.5/export.sh      # or the activate_idf script if installed under ~/.espressif
idf.py --version
```
Expected: `ESP-IDF v5.5...`. **Note the exact activation command — every later build/flash command in this plan assumes IDF 5.5 is activated in the shell.**

**Success criteria:** `idf.py --version` reports 5.5 in a fresh shell after sourcing.
**Rollback:** none needed — installing 5.5 doesn't touch 5.4.4; the firmware still builds on 5.4.4 from `main`.

---

### Task 3: Clean rebuild of the (still display-only) firmware on IDF 5.5

This re-validates the display BEFORE networking is reintroduced. Networking stays `#if 0`.

**Files:**
- Modify: `tools/patch-deps.sh` (only if a new managed-component break appears)

- [x] **Step 1: Clean everything (force fresh dependency resolution for 5.5)** — done on IDF v5.5.4.

```bash
cd ~/Projects/maratus-firmware
source ~/esp/esp-idf-v5.5/export.sh
rm -rf build managed_components dependencies.lock sdkconfig
idf.py set-target esp32p4
```

- [x] **Step 2: First build (re-fetches managed components for 5.5)** — components re-fetched; existing patch-deps anchors all matched (WIFI_RMT + BSP touch-skip applied).

```bash
idf.py build
```
Expected outcomes:
- If it fails fetching/compiling a vendored component (BSP/ST7703/esp_lvgl_port) with a 5.5 API error, that's an expected migration break — go to Step 3.
- If `esp_wifi_remote`'s `WIFI_RMT_*` undeclared error appears (in `net.c`), run `./tools/patch-deps.sh` then rebuild.

- [x] **Step 3: Apply managed-component patches + reconcile API breaks** — NO esp_lcd/ST7703/BSP API break occurred. One unanticipated break: 5.5 bootloader grew to `0x60c0` > the `0x6000` gap; fixed via `CONFIG_PARTITION_TABLE_OFFSET=0xA000` in `sdkconfig.defaults` (table→0xA000, app→0x20000; partitions.csv uses no absolute offsets so no collision).

```bash
./tools/patch-deps.sh        # re-applies touch-skip + WIFI_RMT (no-ops if not needed on 5.5)
idf.py build
```
If a vendored file fails on a removed/renamed `esp_lcd` field (e.g. another `color_space`/`pixel_format`-class change), patch it in `managed_components/...` AND add the patch to `tools/patch-deps.sh` (so it survives re-fetch), mirroring the existing entries. Rebuild until clean.

- [x] **Step 4: Verify a clean build** — `Project build complete.` (app 0x121fe0, 43% free), no `error:`/`FAILED`.

```bash
idf.py build 2>&1 | grep -E "Project build complete|error:|FAILED"
```
Expected: `Project build complete.`

- [x] **Step 5: Flash + verify the display still renders on 5.5** — confirmed on hardware: green "Maratus / Ready" idle screen renders, identical to 5.4.4.

```bash
ls /dev/cu.usbmodem*                       # note the port
idf.py -p <PORT> flash
```
Then read the boot log passively (Appendix script) and **look at the LCD**.
Expected: serial shows `Maratus firmware boot`, `touch disabled`, `Idle screen shown`, `display bring-up mode`; **LCD shows the green "Maratus / Ready" idle screen**; exactly **1** boot banner (no reboot loop / WDT / abort).

**Success criteria:** display-only firmware builds + boots + renders the idle screen on IDF 5.5, identical to the 5.4.4 behavior.
**Rollback:** if display regresses on 5.5 and can't be fixed quickly, `git checkout main` + reflash on 5.4.4 (display-only stays shippable). Record the 5.5 display break before reverting.

- [x] **Step 6: Commit the 5.5-clean display build** — `7ddc72e` (combined with Task 4: C6 config was already committed at `767597a`, so the only new files were the partition-offset fix + `read-console.py`).

```bash
git add -A
git commit -m "build(firmware): display-only builds + renders on ESP-IDF 5.5"
```

---

### Task 4: Enable C6 SDIO transport + validate slave-select

Networking remains `#if 0`; this task only proves the **config** resolves to SDIO+C6 on 5.5.

**Files:**
- Modify: `main/idf_component.yml`
- Modify: `sdkconfig.defaults`

- [x] **Step 1: Confirm the pre-staged config is intact** — `esp_wifi_remote: "0.*"`, no explicit esp_hosted, `CONFIG_SLAVE_IDF_TARGET_ESP32C6=y` + display options all present.

`main/idf_component.yml` should already pin `espressif/esp_wifi_remote: "0.*"` and have **no** explicit `espressif/esp_hosted` (esp_wifi_remote pulls it). `sdkconfig.defaults` should already contain:
```
CONFIG_SLAVE_IDF_TARGET_ESP32C6=y
CONFIG_SPIRAM_USE_CAPS_ALLOC=y
CONFIG_BSP_LCD_DPI_BUFFER_NUMS=2
CONFIG_BSP_DISPLAY_LVGL_AVOID_TEAR=y
CONFIG_BSP_DISPLAY_LVGL_DIRECT_MODE=y
```
If `esp_wifi_remote 0.*` resolves poorly on 5.5, match the brookesia demo exactly (it used `esp_wifi_remote: "0.*"` on 5.5) — keep `0.*`.

- [x] **Step 2: Regenerate sdkconfig + build** — regenerated from defaults; `Project build complete.` (no WIFI_RMT error on 5.5).

```bash
rm -f sdkconfig dependencies.lock
idf.py set-target esp32p4
idf.py build      # run ./tools/patch-deps.sh + rebuild if WIFI_RMT error appears
```

- [x] **Step 3: VALIDATE the slave-select + transport in the generated sdkconfig** — ✅ PASS. Present: `SLAVE_IDF_TARGET_ESP32C6`, `ESP_HOSTED_CP_TARGET_ESP32C6`, `ESP_HOSTED_SDIO_HOST_INTERFACE`. Absent: SPI host iface + H2 target. SDIO pins defined (CLK18/CMD19/D0-3=14-17, slot1, 40MHz, reset GPIO54).

```bash
grep -E "CONFIG_SLAVE_IDF_TARGET_ESP32C6=y|CONFIG_ESP_HOSTED_CP_TARGET_ESP32C6=y|CONFIG_ESP_HOSTED_SDIO_HOST_INTERFACE=y" sdkconfig
grep -E "CONFIG_ESP_HOSTED_SPI_HOST_INTERFACE=y|CONFIG_ESP_HOSTED_CP_TARGET_ESP32H2=y" sdkconfig   # must be ABSENT
```
Expected: the **first** grep prints all three lines; the **second** prints nothing.
- If `SLAVE_IDF_TARGET_ESP32C6` is still missing → the slave-select Kconfig still isn't sourced on this 5.5 build. Diagnose: `find managed_components/espressif__esp_wifi_remote -name "Kconfig.slave_select.in"` and confirm an `idf_tag_v5.5*` fragment exists and is sourced. If absent, explicitly set the slave via `idf.py menuconfig` → "Wi-Fi Remote" / slave target → ESP32-C6, and capture the resulting symbol into `sdkconfig.defaults`.

**Success criteria:** generated `sdkconfig` selects `SLAVE_IDF_TARGET_ESP32C6` + `ESP_HOSTED_CP_TARGET_ESP32C6` + `ESP_HOSTED_SDIO_HOST_INTERFACE`; no SPI/H2 fallback.
**Rollback:** config-only stage; revert `sdkconfig.defaults`/`idf_component.yml` edits if it won't resolve, firmware still display-only.

- [x] **Step 4: Commit the validated SDIO config** — folded into `7ddc72e` (no separate file change: `idf_component.yml` + the C6 line in `sdkconfig.defaults` were already committed at `767597a`).

```bash
git add main/idf_component.yml sdkconfig.defaults
git commit -m "feat(firmware): select C6 SDIO transport on IDF 5.5 (slave-select validated)"
```

---

### Task 5: Re-enable networking + validate Wi-Fi association

**Files:**
- Modify: `main/app_main.c` (remove the `#if 0` networking guard)
- Modify: (via `idf.py menuconfig`) dev Wi-Fi credentials

- [x] **Step 1: Re-enable the networking block** — `#if 0` guard removed, live calls restored.

In `main/app_main.c`, remove the `#if 0` / `#endif` around the networking block (restore the live calls), and drop the "display bring-up mode" log. The block becomes:
```c
    // 3) Connect to Wi-Fi via the C6 (SDIO/esp-hosted).
    net_start();
    ESP_LOGI(TAG, "Wi-Fi connected=%d", net_is_connected());

    // 4) Continuous poll loop + device state machine.
    app_state_run();
    cloud_set_config_changed_cb(app_state_request_config);

    // 5) ESC/POS print-job listener on TCP:9100.
    escpos_server_start(render_job_handle);
    ESP_LOGI(TAG, "print server up on :9100");
```

- [x] **Step 2: Set real Wi-Fi credentials** — set directly in gitignored `sdkconfig` (menuconfig is interactive; the build picks them up). Tested on two 2.4GHz APs.

```bash
idf.py menuconfig    # Maratus firmware (dev) -> MARATUS_WIFI_SSID + MARATUS_WIFI_PASSWORD
```
(Use a 2.4GHz-capable network the C6 can join.)

- [x] **Step 3: Build + flash** — built on IDF 5.5.4, flashed via `/dev/cu.usbmodem5A671704091`.

```bash
idf.py build && ./tools/patch-deps.sh && idf.py build
ls /dev/cu.usbmodem* ; idf.py -p <PORT> flash
```

- [x] **Step 4: Verify SDIO init + association (passive serial read)** — ✅ all expected markers seen: `Identified slave [esp32c6]`, `Card init success`, `net: got IP`, `maratus: Wi-Fi connected=1`, sustained cloud polls (404 on placeholder URL = Task 6). See the stability note below — getting here required two additional fixes beyond the plan.

Read the boot log (Appendix). Expected, in order:
- `Maratus firmware boot`, `Idle screen shown` (display still up — dot grey initially).
- esp_hosted SDIO bring-up logs (NO `spi_drv.c` / `mempool create failed` assert, NO reboot loop).
- `net: connecting to SSID '<your ssid>'` then `net: got IP`.
- `maratus: Wi-Fi connected=1`.
- The idle-screen status dot turns **green** (`ui_set_online(true)` once the poll succeeds).

**Success criteria:** device brings up the C6 over SDIO without crashing and obtains an IP (`got IP`, `connected=1`); 1 boot banner, no WDT/abort. ✅ **MET** (stable, 0 reboots over 30s+ with sustained polling).
**Rollback:** if SDIO init crashes or never associates, re-wrap networking in `#if 0`, rebuild/flash → back to the working display-only build on 5.5. Capture the failing serial log first (SDIO timeout vs association failure vs auth failure) — that pinpoints pins/firmware vs credentials.

> **⚠️ Two fixes beyond the plan were required to reach a STABLE link (see commits + `firmware-m-wifi-idf55-status` memory):**
> 1. **C6 slave firmware was stale.** The board shipped the C6 with esp_hosted slave fw v0.0.6 (reports `0.0.0`) vs host 2.12.9. Updated it to 2.12.9 via host-driven **LittleFS slave-OTA over SDIO** (built `~/Projects/maratus-c6-slave`, pushed with `~/Projects/maratus-c6-ota`). Necessary, but did NOT fix stability on its own.
> 2. **SDIO mempool placement.** The real instability (`H_SDIO_DRV: Failed to send data: 258` → `Unrecoverable host sdio state` → restart loop, only under active RF) was the transport mempool living in **PSRAM** (`MEMPOOL_PREFER_SPIRAM`, added in Task 3 to dodge a boot OOM). PSRAM-DMA is unreliable for SDIO under RF; **internal DMA RAM is stable** (proven vs the brookesia demo). Fix: drop `MEMPOOL_PREFER_SPIRAM` + shrink `ESP_HOSTED_SDIO_TX/RX_Q_SIZE` to 6 so the ~26KB pool fits in internal RAM. The earlier 20MHz SDIO clock drop was a red herring (reverted to 40MHz).

- [x] **Step 5: Commit** — committed on `m-wifi-idf55`: networking re-enable + disconnect-reason logging, then the SDIO stability fix.

```bash
git add main/app_main.c
git commit -m "feat(firmware): re-enable networking — C6 SDIO Wi-Fi association on IDF 5.5"
```

---

### Task 6: Cloud connectivity validation (online + config + ingest)

**Files:**
- Modify: (via `idf.py menuconfig`) `MARATUS_API_BASE_URL`, `MARATUS_DEVICE_KEY`

- [x] **Step 1: Obtain a device key from maratus-admin** — provisioned via admin "Add device" (pairing code) + tenant "Claim printer" (raw key `dvk_…`, shown once). Prod URL `https://ditto-admin-brown.vercel.app`.

In `maratus-admin`: `npm run db:seed`, then claim a device in the admin UI (the raw 40-char key shows once) — or insert a `device` row with `device_key_hash` = SHA-256 of a chosen key. Note the org's base URL (the production Vercel URL).

- [x] **Step 2: Configure cloud endpoint + key** — set `MARATUS_API_BASE_URL` + `MARATUS_DEVICE_KEY` in gitignored `sdkconfig`, rebuilt + flashed.

```bash
idf.py menuconfig    # Maratus firmware (dev) -> MARATUS_API_BASE_URL (prod URL) + MARATUS_DEVICE_KEY (raw key)
idf.py build && idf.py -p <PORT> flash
```

- [x] **Step 3: Verify the device reaches the cloud (passive serial + admin UI)** — ✅ `cloud: GET /commands -> 200`; device shows **online** in admin (poll = heartbeat: lastSeenAt + status + fw version). Config fetch is event-driven (on `config-changed`/"Refresh config"), not every poll.

Expected (serial):
- `cloud: GET /commands -> 200, body: {"commands":[...]}`.
- `cloud: config updated (N texts)` (the `GET /api/device/config` fetch) — and the **idle screen repaints** with the org's branding.
Expected (admin UI): the device shows **online** with `firmwareVersion` from `MARATUS_FW_VERSION`.

- [x] **Step 4: Verify command + receipt round-trips** — ✅ both. `identify` → admin shows **acked**. Receipt ingest end-to-end: streamed `text-receipt.escpos` to `:9100` → `parsed 24 ops` → `rendered 576x438 -> PNG 252809 bytes` → `POST /ingest -> 201` (token+URL) → public receipt page resolves HTTP 200 with the Roastwell receipt + presigned R2 image.

- Enqueue an `identify` command in the admin → within a poll cycle the device acks it (status `acked` in admin) and the status dot blinks.
- Stream a receipt fixture to the device (`tools/escpos-harness/`): `node make-text-fixture.js && node send.js <device-ip> fixtures/text-receipt.escpos` → device renders + uploads → QR screen → scanning resolves the public receipt; the receipt appears in the admin.

> **LAN gotcha:** the ESC/POS sender must be on the **same subnet** as the device (it's a raw TCP push to `:9100`). The Mac is on `192.168.0.x`; `test_EXT` lands the device there (`192.168.0.104`), `kunteper` lands it on `10.193.170.x` (unreachable from the Mac). `/tmp/ingest_test.py` resets the board, rediscovers the IP, streams the fixture, and captures render/upload on serial in one shot.

**Success criteria:** device is **online** in the admin, fetches its config (idle screen reflects branding), acks a command, and completes a receipt ingest end-to-end over Wi-Fi → cloud. ✅ **MET** (online + identify acked + ingest 201 + public receipt 200).
**Rollback:** Wi-Fi + display work even if cloud creds are wrong (poll just 401/errors without crashing). Fix the base URL / device key and reflash; no firmware rollback needed.

- [ ] **Step 5: Document + commit the working full-stack state**

```bash
git add -A
git commit -m "feat(firmware): full cloud connectivity on IDF 5.5 (online + config + ingest over C6 Wi-Fi)"
```
Update `BUILD.md` to state IDF **5.5** as the toolchain (supersedes the 5.4.4 note) and document the Wi-Fi/cloud credential setup. Merge `m-wifi-idf55` → `main` once verified.

---

### Task 7 (follow-up, out of primary scope): re-evaluate touch on 5.5 — ✅ DONE

The GT911 touch was skipped (I2C busy-wait) in the 5.4.4 bring-up. On 5.5 with the corrected component versions, re-test: temporarily revert the touch-skip in `tools/patch-deps.sh`, rebuild, and read the log — if the GT911 I2C no longer hangs, drop the touch-skip patch and tap-to-ingest works again. If it still hangs, leave the skip and treat touch as its own milestone. **Do not block M-Wi-Fi completion on touch.**

**Result (2026-06-15):** GT911 inits cleanly on IDF 5.5 — no I2C hang (`GT911: TouchPad_ID:0x39,0x31,0x31`, `GT911 touch init OK`, only a non-fatal pull-up warning). Verified functionally on hardware: a screen tap registers, fires `run_test_ingest()` → `POST /ingest -> 201` → receipt. Touch-skip block removed from `tools/patch-deps.sh` (firmware commit, merged to `main`). **M-Wi-Fi plan fully complete.**

---

## Appendix — passive UART0 log reader (idf.py monitor traps this board in download)

`tools/read-console.py` (create once, reuse across stages):
```python
import serial, glob, time, sys
ports = sorted(glob.glob('/dev/cu.usbmodem*'))
if not ports: sys.exit("no usbmodem port")
s = serial.Serial(); s.port = ports[0]; s.baudrate = 115200; s.timeout = 0.4
s.dtr = False; s.rts = False         # hold straps for normal boot (no download mode)
s.open(); s.dtr = False; s.rts = False
secs = int(sys.argv[1]) if len(sys.argv) > 1 else 12
end = time.time() + secs
while time.time() < end:
    d = s.read(400)
    if d: sys.stdout.write(d.decode(errors='replace')); sys.stdout.flush()
s.close()
```
Run: `python tools/read-console.py 12` (reads ~12s). To capture a fresh boot, tap `RST` (not BOOT) while it reads, or power-cycle.

---

## Self-Review

**Spec coverage (the 8 requested items):**
1. IDF 5.4.4 → 5.5 migration steps → Tasks 2, 3 ✓
2. Dependency/version changes (esp_wifi_remote `0.*`, esp_hosted pulled transitively) → Task 4 Step 1 + the up-front section ✓
3. Enable C6 SDIO + validate `SLAVE_IDF_TARGET_ESP32C6` selected → Task 4 Step 3 (explicit grep gate) ✓
4. Re-verify display + LVGL on 5.5 BEFORE networking → Task 3 (networking stays `#if 0`) ✓
5. Re-enable networking + validate Wi-Fi association → Task 5 ✓
6. Cloud connectivity validation (creds, base URL, device key) → Task 6 ✓
7. Success criteria + rollback per stage → present on Tasks 1–6 ✓
8. Expected 5.4→5.5 API incompatibilities up front → dedicated section ✓

**Placeholder scan:** No `TODO`/`TBD`. The genuinely-can't-predict parts (exact 5.4→5.5 vendored API breaks) are framed as "build → observe the compile error → patch via patch-deps.sh (mirroring existing entries)" with the concrete fix pattern, not a vague placeholder — this is honest about a migration's nature. Credentials (SSID/key/URL) are user-supplied by design, with exact menuconfig paths.

**Consistency:** Symbols match the codebase — `net_start`/`net_is_connected`, `app_state_run`/`app_state_request_config`, `cloud_set_config_changed_cb`, `escpos_server_start(render_job_handle)`, `render_job_handle`, `MARATUS_WIFI_SSID/PASSWORD/API_BASE_URL/DEVICE_KEY/FW_VERSION`, `tools/patch-deps.sh`, `tools/escpos-harness/` all exist as referenced. The sdkconfig keys (`SLAVE_IDF_TARGET_ESP32C6`, `ESP_HOSTED_CP_TARGET_ESP32C6`, `ESP_HOSTED_SDIO_HOST_INTERFACE`) match the esp_hosted Kconfig observed during investigation. The `#if 0` networking block matches the current `app_main.c`.

**Risk notes:** (a) IDF 5.5 may surface a few vendored `esp_lcd` API deltas at Stage 3 (display) — re-verified before networking precisely to localize them. (b) If `SLAVE_IDF_TARGET_ESP32C6` still doesn't select on 5.5, Task 4 Step 3 has the menuconfig fallback + diagnosis. (c) C6 assumed pre-flashed with esp_hosted slave firmware (brookesia relies on it); if SDIO inits but never associates, that assumption is the suspect.
