# Maratus Device Architecture — Design Spec

**Date:** 2026-06-14
**Status:** Approved for planning
**Scope of this spec:** Milestone **M1 (cloud↔device contract)** in full detail, plus a
firmware **architecture outline**. Firmware milestones M2–M6 get their own spec once the
contract lands.

---

## 1. Summary

Maratus's hardware is a Waveshare **ESP32-P4-WIFI6-Touch-LCD-4B** (720×720 1:1 4" touch LCD;
ESP32-P4 RISC-V compute + an ESP32-C6 co-processor for the Wi-Fi 6 radio). The device
replaces a paper receipt printer: it accepts a print job, renders it, uploads the rendered
image to Maratus Cloud, and shows the customer a QR code that links to the digital receipt.

This spec defines the **end-to-end architecture** for getting the primary product working
and specifies the **cloud-side contract (M1)** that the firmware will build against.

### Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Transport | **HTTP polling** (no MQTT for MVP) | Current `/api/device/commands` poll + heartbeat is right for hundreds–low-thousands of devices and fits Vercel serverless. MQTT/push is a later swap if a latency-sensitive partner demands it. |
| Primary ingestion | **Local ESC/POS over Wi-Fi (TCP:9100)** | The device is a virtual network printer the POS prints to directly. |
| Rendering location | **On-device** — ESC/POS → framebuffer → JPEG/PNG → upload | Goal is to capture the receipt's *visual appearance*, vendor-dialect-agnostic. Cloud never parses ESC/POS. |
| Cloud responsibility | Store image, manage transaction + QR | Cloud treats the receipt image as opaque bytes. |
| Firmware stack | **ESP-IDF (C) + LVGL** | Only stack with solid ESP32-P4 + C6-radio (esp-hosted) support; Waveshare ships an ESP-IDF BSP + LVGL. |
| Transaction model | **One model, two sources** (`device`, `cloud`) | Both ingestion paths converge on the existing `receipt` row. |
| Repos | Cloud in `maratus-admin`; firmware in new **`maratus-firmware`** | Separate lifecycles; this spec is the cross-cutting contract and lives in `maratus-admin`. |
| Cloud-ingested path | **Deferred** (stub only) | Secondary integration for future POS partners; simple polling later, no push now. |

---

## 2. The core distinction: two render targets

Everything depends on not conflating these:

- **(A) Receipt artifact** — the ESC/POS stream rendered to a tall bitmap, encoded to
  JPEG/PNG, and uploaded. This is what the **customer** sees after scanning the QR. The
  cloud only stores it.
- **(B) On-screen UI** — what is physically lit on the 720×720 LCD at the counter (idle /
  processing / QR / sent screens), driven by **LVGL** from the `PrinterConfig` layout the
  merchant designs in the admin console.

The device **produces (A)** and uploads it; it **displays (B)**. They never mix.

---

## 3. End-to-end data flow (primary path)

```
POS  --ESC/POS over TCP:9100 (Wi-Fi)-->  Device
Device: parse ESC/POS -> render to framebuffer -> encode JPEG (HW codec)
Device --POST /api/ingest (image + minimal metadata, Bearer device key)--> Cloud
Cloud: store image in R2, create transaction row (source=device), mint token + /r/{token} URL
Cloud --> { token, url }
Device: switch LCD to "qr" screen, render QR of url   (customer scans)
Customer --> /r/{token} --> presigned R2 image          (existing flow, unchanged)
```

**Downstream control (unchanged model):** device polls `GET /api/device/commands` as a
heartbeat; acks via `POST /api/device/commands/ack`.

---

## 4. Milestone M1 — Cloud↔device contract (this spec, full detail)

All M1 work lands in `maratus-admin`. M1 is fully testable with `curl` and the existing test
suite — **no hardware required.**

### 4.1 Unify the transaction model

The existing `receipt` row **is** the transaction. Both sources converge here — no new
table.

Schema changes (`lib/db/schema.ts`, migration via `npm run db:generate` + `db:migrate`):

- `receipt.deviceId` → make **nullable** (cloud-ingested receipts have no device).
- Add `receipt.source` → enum `["device", "cloud"]`, **not null**, default `"device"`.
- Add `receipt.metadata` → `jsonb`, nullable. Holds **technical** render metadata only:
  `{ renderWidth, renderHeight, contentHash, firmwareVersion, renderMs }`. **No parsed
  receipt semantics** (no totals, no line items) — consistent with "capture appearance,
  not data."

Indexes/relations: keep existing `receipt.organizationId` index; `deviceId` relation stays
but becomes optional.

### 4.2 Extend `POST /api/ingest`

- Continue to accept the rendered image (multipart `file` or JSON `{image}`), exactly as
  today.
- **Accept and persist optional metadata** (multipart fields or JSON keys) into
  `receipt.metadata`. Unknown/oversized metadata is ignored or clamped — never trusted for
  business logic.
- Set `source = "device"` for this endpoint.
- Cloud still treats the image as opaque bytes. **No ESC/POS parsing, ever.**
- All existing behavior preserved: device-key auth, paused/suspended checks, rate limit,
  R2 upload, token minting, usage metering, `lastSeenAt`/`status` bump, webhook delivery.

### 4.3 New endpoint: `GET /api/device/config`

Fills the current gap — there is no way for a device to fetch its display layout today.

- **Auth:** device bearer key (reuse `authenticateDevice`).
- **Returns:** the device's resolved `PrinterConfig` (the merchant's `tenantSettings`
  layout, normalized via the existing `normalizePrinterConfig`), plus a **version/ETag**.
- **Caching:** respond to `If-None-Match` with `304 Not Modified` when unchanged. The
  device caches the config in NVS and only re-pulls on ETag miss or when nudged.
- **Heartbeat side effect:** like `/commands`, bump `lastSeenAt`.

### 4.4 New command type: `config-changed`

- Extend `deviceCommand.type` enum: `["reboot", "refresh", "identify", "config-changed"]`.
- When a merchant saves branding/layout in the admin console, enqueue a `config-changed`
  command for that org's devices so they re-pull `/api/device/config` promptly instead of
  waiting for a cache miss.

### 4.5 Cloud-ingested path — stub only

- `/api/v1/receipts` already exists. Ensure it writes a `receipt` with `source = "cloud"`
  and `deviceId = null`.
- **No device-notification / push work in M1** (deferred). This just keeps the unified
  model honest.

### 4.6 M1 acceptance criteria

- Migration applies cleanly; `db:seed` still works; existing tests green.
- `/api/ingest` persists metadata and stamps `source="device"`; legacy callers (no
  metadata) still succeed unchanged.
- `/api/device/config` returns a valid normalized `PrinterConfig` for a claimed device and
  honors `If-None-Match` (`304`).
- `config-changed` can be enqueued and is delivered/acked through the existing
  `/commands` + `/ack` flow.
- `/api/v1/receipts` writes `source="cloud"` rows with null `deviceId`.

---

## 5. Firmware architecture outline (M2–M6, own spec later)

New repo **`maratus-firmware`**, ESP-IDF + LVGL. Modules, each independently testable:

- **`net/`** — Wi-Fi via the C6 radio (esp-hosted), connectivity management, SNTP time sync.
- **`escpos/`** — TCP:9100 listener + ESC/POS parser → internal drawing commands. *The
  hardest part; isolate behind a clean interface and drive from recorded test vectors.*
- **`render/`** — drawing commands → framebuffer in PSRAM → hardware JPEG encode (produces
  target **A**, the receipt artifact). Receipt width is the POS roll width (e.g. 384/576
  px); height grows with content.
- **`cloud/`** — HTTPS client: `POST /api/ingest`, `GET /api/device/commands` poll loop,
  `GET /api/device/config`, `POST .../ack`. Bearer key from NVS.
- **`ui/`** — LVGL screen state machine mapped 1:1 to `PRINTER_SCREENS`
  (`idle/processing/qr/sent/error/paused/setup`), rendered from the fetched `PrinterConfig`
  (target **B**).
- **`provision/`** — SoftAP or BLE captive portal → Wi-Fi creds + pairing-code claim →
  store device key in NVS.
- **`ota/`** — firmware update channel. **Stubbed for MVP**, but reserve the hook: on-device
  rendering means field fixes (ESC/POS dialect bugs) require OTA.

### Device state machine

```
setup --(claimed)--> idle --(ESC/POS job)--> processing --(render)--> upload
upload --(ok)--> qr --(timeout/next job)--> sent --> idle
upload --(fail)--> error --> idle
(device.status == paused) --> paused   [side state, entered from any]
```

### Firmware milestones (sequenced after M1; detailed in a follow-up spec)

- **M2 — Skeleton:** boots, Wi-Fi up, static LVGL idle screen, polls `/commands`; device
  shows "online" in admin. *Proves the cloud seam on real hardware.*
- **M3 — Ingest loop:** hard-coded test bitmap → JPEG → `/ingest` → QR screen renders
  returned URL → scan works. *Full receipt lifecycle minus ESC/POS.*
- **M4 — ESC/POS:** TCP:9100 listener + parser + renderer; driven by a real POS / test
  vectors. *The core product.*
- **M5 — Config-driven UI:** LCD screens rendered from fetched `PrinterConfig`; admin
  branding changes reflect on device.
- **M6 — Provisioning + OTA hooks:** production onboarding flow.

---

## 6. Explicitly deferred

Written down so they are never silently assumed as in-scope:

- MQTT / real-time push transport
- Cloud-ingested device notification (the "push QR to device now" flow)
- USB-device printer mode (Wi-Fi only for MVP)
- Offline receipt buffering / store-and-forward
- Multi-POS-dialect ESC/POS hardening (start with one or two common dialects)
- OTA rollout/fleet tooling (hook reserved, tooling deferred)

---

## 7. Open questions for the firmware spec (not blocking M1)

- Which ESC/POS dialect(s) to target first (Epson TM vs Star) and where to source test
  vectors.
- Roll width assumption(s): 58 mm (384 px) vs 80 mm (576 px) — configurable per device?
- Provisioning transport: SoftAP captive portal vs BLE.
- JPEG vs PNG for the artifact (HW JPEG encoder favors JPEG; PNG is lossless for crisp
  text — decide on quality/size trade-off).
