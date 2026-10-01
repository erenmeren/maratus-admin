# Firmware M4b — QR Rasterization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Epson `GS ( k` **QR-code** commands into the receipt artifact — a POS that emits a QR (e.g. a "view your e-receipt" link or loyalty code) gets a crisp QR drawn into the uploaded PNG, in addition to the M4a raster path.

**Architecture:** Adds an `OP_QR` draw-op carrying the QR payload + module size + error-correction level. The `escpos` parser learns the `GS ( k` QR family (set-model / set-size / set-ecc / store-data / print). The `render` component vendors **Nayuki's `qrcodegen`** (MIT, single-file C) to turn the payload into a module matrix and blits it (scaled + aligned, with quiet zone) into the grayscale framebuffer. Everything else (framebuffer, PNG, upload, QR-on-screen) is unchanged from M4a.

**Tech Stack:** ESP-IDF, `qrcodegen` (vendored), the M4a `render`/`escpos` components. No new cloud or UI work.

**Scope (M4b only):** the ESC/POS QR-code function set under `GS ( k cn=49`: `fn=65` model (parsed, ignored — we always pick the version), `fn=67` module size, `fn=69` error correction, `fn=80` store data, `fn=81` print. **Out of scope:** 1D barcodes (`GS k`) and PDF417 — barcodes move to **M4c** (their HRI text needs M4c's bitmap font). Roll width stays 576px.

**Re-scope note:** the original M4 decomposition listed M4b as "QR + barcode." Barcodes are deferred to M4c (HRI text dependency). M4b is QR-only.

---

### Task 1: Vendor the `qrcodegen` library

**Files:**
- Create: `components/qrcodegen/qrcodegen.c` (from upstream)
- Create: `components/qrcodegen/include/qrcodegen.h` (from upstream)
- Create: `components/qrcodegen/CMakeLists.txt`
- Create: `components/qrcodegen/LICENSE` (upstream MIT text)

- [ ] **Step 1: Fetch the upstream C source**

Download the two C files from Nayuki's QR-Code-generator (MIT), C port:
- `https://raw.githubusercontent.com/nayuki/QR-Code-generator/master/c/qrcodegen.c` → `components/qrcodegen/qrcodegen.c`
- `https://raw.githubusercontent.com/nayuki/QR-Code-generator/master/c/qrcodegen.h` → `components/qrcodegen/include/qrcodegen.h`

```bash
cd /Users/eren/Projects/maratus-firmware
mkdir -p components/qrcodegen/include
curl -fsSL https://raw.githubusercontent.com/nayuki/QR-Code-generator/master/c/qrcodegen.c -o components/qrcodegen/qrcodegen.c
curl -fsSL https://raw.githubusercontent.com/nayuki/QR-Code-generator/master/c/qrcodegen.h -o components/qrcodegen/include/qrcodegen.h
curl -fsSL https://raw.githubusercontent.com/nayuki/QR-Code-generator/master/LICENSE     -o components/qrcodegen/LICENSE
```
Confirm: `head -3 components/qrcodegen/qrcodegen.h` shows the QR Code generator header comment. (The public API used here: `qrcodegen_encodeText`, `qrcodegen_getSize`, `qrcodegen_getModule`, `qrcodegen_BUFFER_LEN_FOR_VERSION`, enum `qrcodegen_Ecc_*`, `qrcodegen_Mask_AUTO`.)

- [ ] **Step 2: Component registration**

`components/qrcodegen/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "qrcodegen.c"
                       INCLUDE_DIRS "include")
```

- [ ] **Step 3: Build to confirm it compiles on the target**

```bash
idf.py build
```
Expected: clean build (qrcodegen is portable C99; no platform deps).

- [ ] **Step 4: Commit**

```bash
git add components/qrcodegen
git commit -m "chore(firmware): vendor Nayuki qrcodegen (MIT)"
```

---

### Task 2: `OP_QR` draw-op + QR rendering

**Files:**
- Modify: `components/render/include/draw_ops.h`
- Modify: `components/render/render.c`
- Modify: `components/render/CMakeLists.txt`

- [ ] **Step 1: Add the QR draw-op**

In `components/render/include/draw_ops.h`, add `OP_QR` to the enum and a `qr` union member:
```c
typedef enum {
    OP_RASTER,   // a 1bpp bit-image (GS v 0)
    OP_FEED,     // vertical whitespace, in dots
    OP_ALIGN,    // set alignment for subsequent rasters
    OP_QR,       // a QR code (GS ( k)
} op_kind_t;
```
Add inside the union (after the `align` member):
```c
        struct {
            const char *data;  // payload bytes (point INTO the job buffer)
            int len;           // payload length
            int module_px;     // dots per QR module (1..16)
            uint8_t ecc;       // 0=L, 1=M, 2=Q, 3=H
        } qr;
```

- [ ] **Step 2: Pre-encode QRs so height + blit share the matrix**

In `components/render/render.c`, add includes + a QR helper, and a side-table that encodes each `OP_QR` once. Add near the top:
```c
#include "qrcodegen.h"

#define QR_QUIET 4   // quiet-zone modules each side (QR spec minimum)

typedef struct {
    uint8_t qr[qrcodegen_BUFFER_LEN_FOR_VERSION(qrcodegen_VERSION_MAX)];
    int side;        // modules per side (0 = encode failed)
    int module_px;
} qr_enc_t;

static enum qrcodegen_Ecc ecc_of(uint8_t e)
{
    switch (e) {
        case 1: return qrcodegen_Ecc_MEDIUM;
        case 2: return qrcodegen_Ecc_QUARTILE;
        case 3: return qrcodegen_Ecc_HIGH;
        default: return qrcodegen_Ecc_LOW;
    }
}

// Encode one OP_QR into *enc. Returns true on success.
static bool qr_encode(const draw_op_t *op, qr_enc_t *enc)
{
    char text[512];
    int n = op->qr.len; if (n > (int)sizeof(text) - 1) n = sizeof(text) - 1;
    memcpy(text, op->qr.data, n); text[n] = '\0';

    static uint8_t tmp[qrcodegen_BUFFER_LEN_FOR_VERSION(qrcodegen_VERSION_MAX)];
    bool ok = qrcodegen_encodeText(text, tmp, enc->qr, ecc_of(op->qr.ecc),
                                   qrcodegen_VERSION_MIN, qrcodegen_VERSION_MAX,
                                   qrcodegen_Mask_AUTO, true);
    enc->side = ok ? qrcodegen_getSize(enc->qr) : 0;
    enc->module_px = op->qr.module_px < 1 ? 4 : (op->qr.module_px > 16 ? 16 : op->qr.module_px);
    return ok;
}

static int qr_px(const qr_enc_t *e) { return (e->side + 2 * QR_QUIET) * e->module_px; }
```

- [ ] **Step 3: Thread the QR side-table through `render_ops_to_png`**

Replace the body of `render_ops_to_png` so it pre-encodes QRs, includes them in the height, and blits them. Full replacement of the function:
```c
bool render_ops_to_png(const draw_op_t *ops, int n_ops,
                       uint8_t **png_out, size_t *png_len, int *out_w, int *out_h)
{
    const int W = RENDER_ROLL_WIDTH;

    // Pre-encode every QR op once (indexed by op position; NULL entry = not a QR).
    qr_enc_t **qrs = calloc(n_ops, sizeof(qr_enc_t *));
    if (!qrs) return false;
    for (int i = 0; i < n_ops; i++) {
        if (ops[i].kind != OP_QR) continue;
        qr_enc_t *e = malloc(sizeof(qr_enc_t));
        if (e && qr_encode(&ops[i], e)) qrs[i] = e;
        else { free(e); ESP_LOGW(TAG, "QR encode failed"); }
    }

    // Height: rasters + feeds + QR boxes.
    int H = 0;
    for (int i = 0; i < n_ops; i++) {
        if (ops[i].kind == OP_RASTER) H += ops[i].raster.height;
        else if (ops[i].kind == OP_FEED) H += ops[i].feed.dots;
        else if (ops[i].kind == OP_QR && qrs[i]) H += qr_px(qrs[i]);
    }
    if (H < 1) H = 1;
    if (H > MAX_HEIGHT) H = MAX_HEIGHT;

    size_t fb_len = (size_t)W * H;
    uint8_t *fb = heap_caps_malloc(fb_len, MALLOC_CAP_SPIRAM);
    if (!fb) fb = malloc(fb_len);
    if (!fb) {
        ESP_LOGE(TAG, "fb alloc failed (%dx%d)", W, H);
        for (int i = 0; i < n_ops; i++) free(qrs[i]);
        free(qrs);
        return false;
    }
    memset(fb, 0xFF, fb_len);

    int cur_y = 0;
    align_t align = ALIGN_LEFT;
    for (int i = 0; i < n_ops && cur_y < H; i++) {
        const draw_op_t *op = &ops[i];
        if (op->kind == OP_ALIGN) {
            align = op->align.align;
        } else if (op->kind == OP_FEED) {
            cur_y += op->feed.dots;
        } else if (op->kind == OP_RASTER) {
            int xo = x_offset(align, op->raster.width_px);
            for (int y = 0; y < op->raster.height && (cur_y + y) < H; y++) {
                const uint8_t *row = op->raster.bits + (size_t)y * op->raster.width_bytes;
                for (int x = 0; x < op->raster.width_px; x++) {
                    int px = xo + x;
                    if (px < 0 || px >= W) continue;
                    if (row[x >> 3] & (0x80 >> (x & 7))) fb[(size_t)(cur_y + y) * W + px] = 0x00;
                }
            }
            cur_y += op->raster.height;
        } else if (op->kind == OP_QR && qrs[i]) {
            qr_enc_t *e = qrs[i];
            int box = qr_px(e);
            int xo = x_offset(align, box);
            for (int my = 0; my < e->side; my++) {
                for (int mx = 0; mx < e->side; mx++) {
                    if (!qrcodegen_getModule(e->qr, mx, my)) continue;
                    int bx = xo + (QR_QUIET + mx) * e->module_px;
                    int by = cur_y + (QR_QUIET + my) * e->module_px;
                    for (int dy = 0; dy < e->module_px; dy++) {
                        int yy = by + dy; if (yy < 0 || yy >= H) continue;
                        for (int dx = 0; dx < e->module_px; dx++) {
                            int xx = bx + dx; if (xx < 0 || xx >= W) continue;
                            fb[(size_t)yy * W + xx] = 0x00;
                        }
                    }
                }
            }
            cur_y += box;
        }
    }

    bool ok = png_encode_gray8(fb, W, H, png_out, png_len);
    free(fb);
    for (int i = 0; i < n_ops; i++) free(qrs[i]);
    free(qrs);
    if (ok) { if (out_w) *out_w = W; if (out_h) *out_h = H; }
    return ok;
}
```
Add `#include <stdlib.h>` if not present (it is, from M4a). Remove the now-unused `ops_height` helper (its logic moved inline) to avoid a dead-code warning.

- [ ] **Step 4: Add qrcodegen to render's REQUIRES**

`components/render/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "png_encode.c" "render.c"
                       INCLUDE_DIRS "include"
                       REQUIRES qrcodegen)
```

- [ ] **Step 5: Build**

```bash
idf.py build
```
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add components/render
git commit -m "feat(firmware): render QR draw-ops via qrcodegen"
```

---

### Task 3: Parse the `GS ( k` QR command family

**Files:**
- Modify: `components/escpos/escpos_parser.c`

- [ ] **Step 1: Track QR state + handle `GS ( k`**

In `components/escpos/escpos_parser.c`, add QR state above the `while` loop in `escpos_parse` (after `size_t i = 0;`):
```c
    // QR accumulation state (GS ( k cn=49).
    const uint8_t *qr_data = NULL; int qr_len = 0;
    int qr_module = 4;     // default module size (dots)
    uint8_t qr_ecc = 0;    // default ECC = L
```

In the `else if (b == 0x1D)` (GS) branch, add a `GS ( k` case **before** the existing `GS v 0` check (i.e., as the first sub-case after reading `c = data[i + 1]`):
```c
            if (c == 0x28 && i + 2 < len && data[i + 2] == 0x6B) { // GS ( k
                if (i + 4 >= len) break;
                int L = data[i + 3] + (data[i + 4] << 8); // bytes following pH (cn fn params)
                if (i + 5 + (size_t)L > len) { ESP_LOGW(TAG, "GS ( k truncated"); break; }
                uint8_t cn = data[i + 5];
                uint8_t fn = (L >= 2) ? data[i + 6] : 0;
                if (cn == 49) { // QR code
                    if (fn == 67 && L >= 3) {            // set module size: n
                        qr_module = data[i + 7];
                    } else if (fn == 69 && L >= 3) {     // set ECC: 48=L,49=M,50=Q,51=H
                        uint8_t n = data[i + 7];
                        qr_ecc = (n >= 48 && n <= 51) ? (uint8_t)(n - 48) : 0;
                    } else if (fn == 80 && L >= 3) {     // store data: m d1..dk
                        qr_data = &data[i + 8];          // skip cn fn m
                        qr_len  = L - 3;
                    } else if (fn == 81) {               // print
                        if (qr_data && qr_len > 0) {
                            EMIT(((draw_op_t){ .kind = OP_QR, .qr = {
                                .data = (const char *)qr_data, .len = qr_len,
                                .module_px = qr_module, .ecc = qr_ecc } }));
                        }
                    }
                    // fn==65 (model) and others: accepted, no action.
                } else {
                    ESP_LOGW(TAG, "GS ( k cn=%u ignored", cn);
                }
                i += 5 + (size_t)L;
            } else if (c == 0x76 && i + 2 < len && data[i + 2] == 0x30) { // GS v 0  raster
```
(That is: change the existing `if (c == 0x76 ...)` to `} else if (c == 0x76 ...)` so it chains after the new `GS ( k` block. The rest of the GS branch — `GS V` cut and the `skip GS` else — stay as-is.)

- [ ] **Step 2: Build**

```bash
idf.py build
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add components/escpos
git commit -m "feat(firmware): parse GS ( k QR command family"
```

---

### Task 4: QR fixture + end-to-end verification

**Files:**
- Create: `tools/escpos-harness/make-qr-fixture.js`

- [ ] **Step 1: QR fixture generator**

`tools/escpos-harness/make-qr-fixture.js` — emits a `GS ( k` QR sequence (size, ECC, store, print) wrapping a URL, framed by a small raster header so the receipt has both paths:
```js
import { writeFileSync, mkdirSync } from "node:fs";

const url = process.argv[2] || "https://maratus.app/r/qr-fixture-demo";
const bytes = Buffer.from(url, "latin1");

// GS ( k helpers (cn = 49 for QR).
const gsk = (fn, params) => {
  const payload = Buffer.concat([Buffer.from([49, fn]), Buffer.from(params)]);
  const pL = payload.length & 0xff, pH = (payload.length >> 8) & 0xff;
  return Buffer.concat([Buffer.from([0x1d, 0x28, 0x6b, pL, pH]), payload]);
};

const setSize = gsk(67, [6]);                 // module size = 6 dots
const setEcc  = gsk(69, [49]);                // ECC = M
// store data: fn=80, m=48, then the data
const storeLen = bytes.length + 3;            // cn fn m
const store = Buffer.concat([
  Buffer.from([0x1d, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 49, 80, 48]),
  bytes,
]);
const print = gsk(81, [48]);                  // print

const job = Buffer.concat([
  Buffer.from([0x1b, 0x40]),                  // ESC @
  Buffer.from([0x1b, 0x61, 0x01]),            // center
  setSize, setEcc, store, print,
  Buffer.from([0x1b, 0x4a, 0x30]),            // feed
  Buffer.from([0x1d, 0x56, 0x00]),            // cut
]);

mkdirSync(new URL("./fixtures", import.meta.url), { recursive: true });
writeFileSync(new URL("./fixtures/qr-basic.escpos", import.meta.url), job);
console.log(`wrote fixtures/qr-basic.escpos (${job.length} bytes) encoding: ${url}`);
```

- [ ] **Step 2: Generate + send**

```bash
cd /Users/eren/Projects/maratus-firmware/tools/escpos-harness
node make-qr-fixture.js
node send.js <device-ip> fixtures/qr-basic.escpos
```

- [ ] **Step 3: Verify end-to-end (after flashing the M4b firmware)**

```bash
cd /Users/eren/Projects/maratus-firmware && idf.py build && idf.py -p <PORT> flash monitor
```
Expected:
- Device serial: `job received: N bytes`, `parsed 1 ops` (the QR), `rendered 576xH -> PNG …`, `receipt ready: https://…/r/…`.
- Screen: `Processing…` → QR screen (the on-screen QR of the *receipt URL*).
- **Scan the on-screen QR** → the public receipt loads, and the receipt image itself **contains the QR** encoding `https://maratus.app/r/qr-fixture-demo` (centered, 6px modules).
- **Scan the QR inside the receipt image** → it resolves to that fixture URL (proves the rasterized QR is valid).
- Admin lists the receipt.

- [ ] **Step 4: Commit**

```bash
git add tools/escpos-harness/make-qr-fixture.js
git commit -m "feat(firmware): QR ESC/POS fixture generator"
```

---

## Self-Review

**Spec coverage (M4 QR slice):**
- `GS ( k` QR family parsed (size/ecc/store/print) → Task 3 ✓
- QR payload → module matrix → blitted into the artifact (scaled, aligned, quiet zone) → Task 2 ✓
- Vendored QR encoder → Task 1 ✓
- Fixture + on-device verification → Task 4 ✓
- Reuses M4a framebuffer/PNG/upload + M3 QR-on-screen, unchanged ✓
- **Deferred:** 1D barcodes (`GS k`) + PDF417 → M4c (HRI text needs the bitmap font).

**Placeholder scan:** No `TODO`/`TBD` in shipped code. Task 1 vendors a named MIT library by exact upstream URL (an artifact, not a placeholder) and pins the API surface used. All integration code (encode, height, blit, parse, fixture) is complete.

**Type/interface consistency:** `OP_QR` + the `qr` union member (Task 2 `draw_ops.h`) are emitted by the parser (Task 3) and consumed by `render_ops_to_png` (Task 2). `ecc` encoding (0=L..3=H) is produced consistently by the parser (`n-48`) and mapped by `ecc_of` in render. `module_px` clamp (1..16) matches the parser default (4) and the fixture's `setSize 6`. The `GS ( k` length field `L = pL + pH*256` counts the bytes after `pH` (cn, fn, params) and `i += 5 + L` consumes the whole command — consistent with the fixture's framing (`storeLen = data + 3` for cn/fn/m). qrcodegen API names/signatures match upstream (`qrcodegen_encodeText`, `qrcodegen_getSize`, `qrcodegen_getModule`, `qrcodegen_BUFFER_LEN_FOR_VERSION`, `qrcodegen_VERSION_MIN/MAX`, `qrcodegen_Mask_AUTO`, `qrcodegen_Ecc_*`).

**Risk note (not a placeholder):** the QR data payload is bounded to 512 bytes in `qr_encode` (receipt QRs are URLs/short codes — well under this). Larger payloads truncate; flagged should a use case need more. The pre-encode side-table allocates one `qr_enc_t` (~3.9 KB) per QR op transiently — negligible for the 0–2 QRs a receipt carries.
