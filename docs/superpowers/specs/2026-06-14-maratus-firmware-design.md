# Maratus Firmware Architecture — Design Spec (M2–M6)

**Date:** 2026-06-14
**Status:** Approved for planning
**Repo:** new **`maratus-firmware`** (this spec lives in `maratus-admin` as the cross-cutting record).
**Predecessor:** `docs/superpowers/specs/2026-06-14-device-architecture-design.md` (M1, the
cloud↔device contract — shipped). This spec details the firmware that targets that contract.

---

## 1. Summary

Firmware for the Waveshare **ESP32-P4-WIFI6-Touch-LCD-4B** that turns the board into a
digital-receipt printer: it receives an Epson **ESC/POS** print job over Wi-Fi (TCP:9100),
renders it to a **PNG** image, uploads the image to Maratus Cloud (the M1 `/api/ingest`
contract), and shows the customer a **QR code** linking to the digital receipt. It also
renders branded on-screen UI from the merchant's `PrinterConfig`, self-provisions via the
touchscreen, and self-updates via OTA.

**Scope:** one architecture spec covering milestones **M2–M6**. Each milestone gets its own
implementation plan later (same pattern as M1).

### Hardware (confirmed from Waveshare docs)

| Part | Detail |
|---|---|
| SoC | ESP32-P4NRW32 — dual-core RISC-V HP @360MHz + LP core @40MHz |
| Wi-Fi/BT | ESP32-C6 co-processor over **SDIO** (`esp_wifi_remote`/esp-hosted) |
| Display | 720×720 IPS, **MIPI-DSI**, capacitive touch (touch IC TBC at bring-up, likely GT911) |
| Memory | **32MB PSRAM** (in-package) + 32MB NOR flash |
| Flash/IO | Type-C USB-UART (flash) + Type-C USB-OTG 2.0 HS; SD, mics, speaker, **Ethernet**, RS485, relays, RTC header |

### Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Stack | **ESP-IDF v5.4+ (C) + LVGL v9** | Only stack with solid P4 + C6-radio support; LVGL maps to the screen UI. |
| Dev workflow | **Hardware-in-the-loop, on-device first** | Board in hand + toolchain ready; validate on real silicon from day one. Logic stays modular/fixture-testable. |
| ESC/POS dialect | **Epson TM-series baseline** | De-facto standard; widest real-world compatibility. |
| Test source | **Node TCP fixture harness** on :9100 | Deterministic, repeatable parser/renderer regression vectors; live POS captures supplement. |
| Receipt artifact format | **PNG (lossless)** | Sharp B/W receipt text; no JPEG ringing; compresses tiny; cloud defaults `mimeType=image/png`. |
| Provisioning | **Device-generated pairing code + on-screen Wi-Fi** | No baked-in secret, no open register endpoint; touchscreen-native. |
| OTA | **Minimal ESP-IDF A/B + `esp_https_ota`** | Field-fix safety valve for parser bugs. Staged rollouts deferred. |
| Connectivity | **Wi-Fi only (MVP)** | Ethernet present but deferred. |

---

## 2. The two render targets (the load-bearing distinction)

- **(A) Receipt artifact** — ESC/POS stream → grayscale framebuffer in PSRAM → **PNG** →
  uploaded. What the **customer** sees after scanning the QR. Cloud stores it opaquely.
- **(B) On-screen UI** — LVGL screens (idle/processing/qr/sent/error/paused/setup) rendered
  from the fetched `PrinterConfig`. What is physically lit on the 720×720 LCD.

The device **produces (A)** and uploads it; it **displays (B)**. Never mixed.

---

## 3. Repo layout & module architecture

ESP-IDF component-per-responsibility. Adopt Waveshare's board demo as the BSP baseline
(panel + touch init), then restructure:

```
maratus-firmware/
  components/
    net/        Wi-Fi (C6 via esp-hosted), connectivity mgmt, SNTP time sync
    escpos/     TCP:9100 listener + Epson parser → draw-ops   (modular, fixture-tested)
    render/     draw-ops → PSRAM grayscale framebuffer → PNG  (modular, fixture-tested)
    cloud/      HTTPS client: ingest, commands poll, config, ack, firmware manifest
    ui/         LVGL screen state machine, rendered from PrinterConfig
    provision/  on-screen Wi-Fi setup + pairing/claim + NVS credential store
    ota/        A/B partition self-update (esp_https_ota)
  main/         app_main: module wiring + device state machine
  tools/escpos-harness/   Node TCP sender + ESC/POS fixtures (the test rig)
  partitions.csv          factory + ota_0 + ota_1 + nvs
```

**Module contracts (each understandable/testable in isolation):**

- **`net`** — brings up Wi-Fi via the C6 radio, exposes connectivity state + events, syncs
  time (SNTP) for clock widgets and TLS validity. Depends on: esp-hosted/`esp_wifi_remote`.
- **`escpos`** — owns the `:9100` TCP listener and an Epson ESC/POS parser that emits an
  ordered list of **draw-ops** (see §4). Pure transformation `bytes → draw-ops`; no
  rendering, no I/O beyond the socket. The clean seam that makes fixtures possible.
- **`render`** — consumes draw-ops → composes a grayscale framebuffer in PSRAM at the
  configured roll width → encodes **PNG**. Pure transformation `draw-ops → PNG bytes`.
- **`cloud`** — the only module that talks HTTPS; wraps the M1 contract + OTA manifest.
  Holds the device key (from NVS). Returns typed results to the state machine.
- **`ui`** — renders the seven LVGL screens from a cached `PrinterConfig`; exposes
  `show(screen, ctx)` (e.g. `show(QR, {url})`). No business logic.
- **`provision`** — on-screen Wi-Fi setup, pairing-code generation/display, claim polling,
  NVS persistence of Wi-Fi creds + device key + cached config/ETag.
- **`ota`** — checks the firmware manifest, downloads + verifies (sha256) + swaps partitions
  + reboots, with ESP-IDF rollback on boot failure.

---

## 4. ESC/POS parser + renderer (M4 — the core, highest risk)

- **Dialect:** Epson TM-series subset. Command coverage (initial):
  - `ESC @` init/reset; `ESC !`, `GS !` font/size; `ESC E` bold; `ESC -` underline;
    `ESC a` justification; `ESC d` / `ESC J` / line spacing; codepage selects.
  - `GS v 0` raster bit-image (the common path modern POS use for logos/whole receipts).
  - `GS k` barcodes; `GS ( k` QR codes.
  - `GS V` cut (treated as receipt boundary / end-of-job).
  - **Unknown/unsupported commands:** consumed per length rules and skipped (logged),
    never crash the parser. Robustness over completeness.
  - **Priority within M4:** harden **`GS v 0` raster bit-image** and **QR (`GS ( k`)**
    first — they are the most common paths in real POS receipts and the most likely to
    expose renderer edge cases (raster alignment/scaling, QR module rendering). Build the
    fixture suite around these two before the text-styling polish.
- **Intermediate representation — draw-ops:** parser emits ops like
  `{drawText, font, style, align}`, `{drawRaster, w, h, bits}`, `{drawBarcode/QR, data}`,
  `{feed, dots}`, `{cut}`. The renderer consumes ops; both sides are fixture-testable
  independently. This seam is the single most important design choice in the firmware.
- **Roll width:** default **576px (80mm)**, configurable per device (alt **384px/58mm**).
  POS sends content sized to the configured width.
- **Height:** receipt height grows with content; render into a dynamically grown PSRAM
  buffer. Cap a max height (e.g. ~20000px) to bound memory; over-long jobs truncate +
  flag in metadata.
- **Fonts:** bundle a monospace bitmap font matching typical receipt metrics; map ESC/POS
  size multipliers to scaled glyph rendering.
- **End-of-job detection:** a job ends on `GS V` cut, or an idle gap on the socket after
  data (configurable timeout). The completed framebuffer is then PNG-encoded + uploaded.

---

## 5. Cloud client — consumes the M1 contract verbatim

- **Ingest:** `POST /api/ingest` — multipart `file` = PNG, plus `metadata`
  `{renderWidth, renderHeight, contentHash, firmwareVersion, renderMs}`. Response
  `{token, url}` drives the QR screen. `Authorization: Bearer <deviceKey>`.
- **Commands/heartbeat:** `GET /api/device/commands` poll loop (sends `x-device-version`),
  handles `reboot` / `refresh` / `identify` / `config-changed`; `POST /api/device/commands/ack`.
- **Config:** `GET /api/device/config` with stored **ETag** via `If-None-Match` → `304`
  fast path; on `200`, cache the `PrinterConfig` + ETag in NVS and re-render the UI.
- **Cadence:** poll ~10–15s when idle; exponential backoff on errors/offline. Ingest is
  event-driven (on job completion), not polled.

---

## 6. Device state machine (`main/`)

```
boot
 └─ key in NVS?
      no → setup ──(provisioned + claimed, §7)──> idle
      yes → idle
idle ──(ESC/POS bytes on :9100)──> processing ──render──> uploading
uploading ──ok({token,url})──> qr ──(scan/downloaded or timeout)──> sent ──> idle
uploading ──fail──> error ──(retry w/ backoff, then)──> idle
any ──(config-changed cmd / ETag miss)──> [re-pull config in background, no UI interrupt]
any ──(device.status == paused, from /commands or /config)──> paused (side state)
```

UI screen per state maps 1:1 to `PRINTER_SCREENS`. `processing`/`uploading` share the
`processing` screen; `qr` shows `lv_qrcode` of the returned URL.

---

## 7. Provisioning + device-key acquisition (M6)

**Device-generated pairing-code model — no provisioning secret, no register endpoint.**

1. **First boot (no key in NVS) → `setup` screen.** On-screen Wi-Fi: device scans SSIDs →
   merchant taps their network + types the password on an on-screen keyboard → Wi-Fi creds
   persisted to NVS.
2. **Pairing code.** Device generates a high-entropy pairing code (stored in NVS) and
   displays it on screen. The code is an unguessable capability (treated like a receipt
   token).
3. **Admin claims.** Merchant enters the displayed code in the Maratus dashboard and picks a
   store. The cloud **creates-or-binds** a device record keyed by that code, binds it to the
   store, and mints the device key. *(This adjusts M1's `claimDevice`, which today expects a
   pre-existing row — it becomes create-or-bind by the device-supplied code.)*
4. **Device retrieves its key.** Device polls **`GET /api/device/claim?code=<code>`**
   (unauthenticated; the code is the capability) → `{status:"pending"}` until claimed, then
   returns `{deviceKey}` **exactly once**. Device persists the key to NVS → transitions to
   `idle`/`active`. Subsequent polls with that code never return the key again.

**Security:** the claim endpoint is unauthenticated but gated by the high-entropy code; the
key is returned once and only after an authenticated admin claim; rate-limited; pending
lookups expire. The code only appears on the device's physical screen, so possession implies
physical proximity — acceptable for MVP scale.

---

## 8. OTA (M6)

- ESP-IDF **A/B partitions** (`ota_0` / `ota_1`) + `esp_https_ota`.
- Device periodically calls **`GET /api/device/firmware`** (device-key auth) → returns
  `{ version, url, sha256 }` for the device's channel. If newer than the running version,
  download → verify sha256 → write inactive partition → set boot → reboot.
- **Rollback:** ESP-IDF app-rollback marks the new image valid only after a successful boot
  + cloud check-in; otherwise reverts to the prior partition.
- **Deferred:** staged/cohort rollouts, auto-rollback policies, delta updates. Firmware
  binaries hosted in R2.

---

## 9. Test harness & testing strategy

- **`tools/escpos-harness/`** — a **Node** TCP client that streams fixture byte-streams
  (captured real jobs + synthetic Epson jobs) to the device's `:9100`. Fixtures are the
  deterministic regression suite for parser + renderer. Node matches the team stack
  (`maratus-admin` is TS) and can reuse encoding helpers.
- **On-device validation per milestone** is the source of truth (hardware-in-the-loop). The
  `escpos`/`render`/state-machine seams are kept pure so behavior is reviewable in isolation
  and reproducible from fixtures.
- **Live captures** from a real POS supplement the fixture set when available.

---

## 10. Milestones (each: concrete deliverable + on-device demo)

- **M2 — Skeleton.** Boots; C6 Wi-Fi up; static LVGL idle screen; `GET /api/device/commands`
  poll loop → device shows **online** in admin; `identify`/`reboot` commands work. Uses a
  manually-seeded dev device + key flashed to NVS. *Proves the cloud seam on real hardware.*
- **M3 — Ingest loop.** Bundled test PNG → `POST /api/ingest` → `qr` screen renders the
  returned URL → phone scan resolves the public receipt. *Full receipt lifecycle minus
  ESC/POS.*
- **M4 — ESC/POS.** `:9100` listener + Epson parser + renderer + PNG, driven by the Node
  fixture harness; real receipts render and upload. *The core product.*
- **M5 — Config-driven UI.** All seven screens rendered from the fetched `PrinterConfig`;
  `config-changed` command + ETag re-pull; an admin branding change reflects on the device.
- **M6 — Provisioning + OTA.** On-screen Wi-Fi + device-generated pairing code + claim-poll
  key retrieval; A/B OTA self-update. *Production onboarding.* Includes the cloud additions
  in §11.

---

## 11. Cloud-side additions required (land in `maratus-admin`, folded into the M6 plan)

1. **`GET /api/device/claim?code=<code>`** — unauthenticated, code-gated; returns
   `{status:"pending"}` or `{deviceKey}` exactly once after claim. Rate-limited; pending
   lookups expire.
2. **`claimDevice` create-or-bind adjustment** — accept a device-supplied pairing code,
   create the device row if absent, bind to store, mint the key (currently expects a
   pre-seeded row).
3. **`GET /api/device/firmware`** — device-key auth; OTA manifest `{version, url, sha256}`
   per channel + firmware-binary hosting in R2.

*(M2–M5 do not need these — dev uses a manually-seeded device + NVS-flashed key.)*

---

## 12. Explicitly deferred

MQTT / real-time push · cloud-ingested device notification · USB-device printer mode ·
**Ethernet** connectivity (Wi-Fi only) · offline receipt buffering / store-and-forward ·
multi-dialect ESC/POS (Star/StarPRNT etc.) · staged OTA rollouts & delta updates · unused
peripherals (RS485, relays, audio, SD card, RTC).

---

## 13. Open questions (resolve at bring-up; non-blocking for planning)

- Exact MIPI-DSI panel driver + touch controller IC — confirm from the Waveshare BSP/demo.
- PNG encoder choice (lodepng vs miniz/zlib deflate) — decide at M3 render bring-up; pick by
  footprint + speed on a near-bilevel image.
- Final Epson command-subset coverage — refined against real POS captures during M4.
- Exact pairing-code format/entropy + claim-poll cadence/expiry — finalized in the M6 plan
  alongside the cloud endpoint.
