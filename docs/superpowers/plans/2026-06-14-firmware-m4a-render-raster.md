# Firmware M4a — Rendering Pipeline + Raster Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the device into a real network printer for **raster** receipts: a POS opens a TCP connection to port 9100, streams an Epson ESC/POS job containing a `GS v 0` raster bit-image, and the device parses it → composes a grayscale framebuffer → encodes a PNG → uploads it to `/api/ingest` → shows the receipt QR.

**Architecture:** Two new components. `render` owns the draw-op intermediate representation, the grayscale framebuffer, and a dependency-free PNG encoder. `escpos` owns the TCP:9100 listener and an Epson parser that emits draw-ops (raster/feed/align/cut) — no rendering. A thin job glue in `main` connects them: bytes → parse → render → PNG → `cloud_post_receipt()` (reused from M3) → `ui_show_qr()`. This is the first slice of M4; QR/barcode rasterization (M4b) and bitmap-font text (M4c) follow.

**Tech Stack:** ESP-IDF v5.4+, BSD sockets (`lwip`), PSRAM (`heap_caps_malloc`), a self-contained PNG encoder (PNG color type 0 grayscale, **stored/uncompressed deflate blocks** — no zlib dependency), Node (test harness). Reuses M3's `cloud_post_receipt`, `ui_show_qr`, `ui_show(UI_SCREEN_PROCESSING)`.

**Testing model:** Hardware-in-the-loop. Each task verifies by build → flash → drive the device with the **Node fixture harness** (Task 6) over the LAN and observe screen / serial / phone scan / admin. The PNG encoder (Task 1) and parser (Task 3) are pure and could be host-compiled, but on-device validation is the source of truth.

**Scope (M4a only):** `ESC @` (reset), `ESC a` (align), `GS v 0` (raster bit-image, mode 0), `LF`/`ESC J`/`ESC d` (feeds), `GS V` (cut/end-of-job). Text glyphs, QR, and barcodes in the artifact are **out of scope** (M4b/M4c). The parser handles unknown commands best-effort (logs + skips the command byte); robust full-dialect skipping is M4c. Fixtures for M4a are raster receipts.

**Roll width:** fixed **576px** (80mm) for M4a; per-device width config lands with M4c.

---

### Task 1: Dependency-free grayscale PNG encoder

**Files:**
- Create: `components/render/CMakeLists.txt`
- Create: `components/render/include/png_encode.h`
- Create: `components/render/png_encode.c`

- [ ] **Step 1: Component registration**

`components/render/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "png_encode.c"
                       INCLUDE_DIRS "include")
```

- [ ] **Step 2: Interface**

`components/render/include/png_encode.h`:
```c
#pragma once
#include <stddef.h>
#include <stdint.h>

// Encode an 8-bit grayscale image (row-major, `w*h` bytes, 0=black..255=white)
// into a PNG (color type 0). Allocates the output (PSRAM-preferred); caller frees
// with free(). Returns true on success and sets *out / *out_len.
bool png_encode_gray8(const uint8_t *gray, int w, int h, uint8_t **out, size_t *out_len);
```

- [ ] **Step 3: Implementation (stored-deflate, self-contained)**

`components/render/png_encode.c`:
```c
#include "png_encode.h"
#include <string.h>
#include <stdlib.h>
#include "esp_heap_caps.h"

static uint32_t s_crc[256];
static bool s_crc_ready;

static void crc_init(void)
{
    for (uint32_t n = 0; n < 256; n++) {
        uint32_t c = n;
        for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
        s_crc[n] = c;
    }
    s_crc_ready = true;
}

static uint32_t crc32_buf(const uint8_t *d, size_t n)
{
    if (!s_crc_ready) crc_init();
    uint32_t c = 0xffffffffu;
    for (size_t i = 0; i < n; i++) c = s_crc[(c ^ d[i]) & 0xff] ^ (c >> 8);
    return c ^ 0xffffffffu;
}

static uint32_t adler32_buf(const uint8_t *d, size_t n)
{
    uint32_t a = 1, b = 0;
    for (size_t i = 0; i < n; i++) { a = (a + d[i]) % 65521; b = (b + a) % 65521; }
    return (b << 16) | a;
}

static void put_be32(uint8_t *p, uint32_t v) { p[0]=v>>24; p[1]=v>>16; p[2]=v>>8; p[3]=v; }

// Append a PNG chunk (len, type, data, crc) at *pos; advance *pos.
static void put_chunk(uint8_t *out, size_t *pos, const char *type, const uint8_t *data, uint32_t len)
{
    put_be32(out + *pos, len); *pos += 4;
    size_t type_at = *pos;
    memcpy(out + *pos, type, 4); *pos += 4;
    if (len) { memcpy(out + *pos, data, len); *pos += len; }
    uint32_t crc = crc32_buf(out + type_at, 4 + len);
    put_be32(out + *pos, crc); *pos += 4;
}

bool png_encode_gray8(const uint8_t *gray, int w, int h, uint8_t **out, size_t *out_len)
{
    if (!gray || w <= 0 || h <= 0) return false;

    // 1) Raw image data: one filter byte (0 = none) per row, then the row pixels.
    size_t raw_len = (size_t)h * (1 + (size_t)w);
    uint8_t *raw = heap_caps_malloc(raw_len, MALLOC_CAP_SPIRAM);
    if (!raw) raw = malloc(raw_len);
    if (!raw) return false;
    for (int y = 0; y < h; y++) {
        raw[(size_t)y * (1 + w)] = 0x00;
        memcpy(raw + (size_t)y * (1 + w) + 1, gray + (size_t)y * w, w);
    }

    // 2) zlib stream using stored (uncompressed) deflate blocks.
    size_t nblocks = (raw_len + 65534) / 65535;
    if (nblocks == 0) nblocks = 1;
    size_t idat_len = 2 + raw_len + 5 * nblocks + 4; // CMF/FLG + blocks(5B hdr each) + adler
    uint8_t *idat = heap_caps_malloc(idat_len, MALLOC_CAP_SPIRAM);
    if (!idat) idat = malloc(idat_len);
    if (!idat) { free(raw); return false; }

    size_t p = 0;
    idat[p++] = 0x78; idat[p++] = 0x01; // zlib header (no compression dict)
    size_t remaining = raw_len; const uint8_t *src = raw;
    if (remaining == 0) { idat[p++] = 0x01; idat[p++]=0; idat[p++]=0; idat[p++]=0xff; idat[p++]=0xff; }
    while (remaining > 0) {
        size_t blk = remaining > 65535 ? 65535 : remaining;
        idat[p++] = (blk == remaining) ? 0x01 : 0x00;       // BFINAL on last, BTYPE=00 (stored)
        idat[p++] = blk & 0xff; idat[p++] = (blk >> 8) & 0xff;        // LEN (LE)
        idat[p++] = (~blk) & 0xff; idat[p++] = ((~blk) >> 8) & 0xff;  // NLEN
        memcpy(idat + p, src, blk); p += blk;
        src += blk; remaining -= blk;
    }
    uint32_t adler = adler32_buf(raw, raw_len);
    put_be32(idat + p, adler); p += 4; // adler32 is big-endian in zlib
    idat_len = p;

    // 3) Assemble the PNG: signature + IHDR + IDAT + IEND.
    uint8_t ihdr[13];
    put_be32(ihdr, (uint32_t)w); put_be32(ihdr + 4, (uint32_t)h);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 0;  // color type 0 = grayscale
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression, filter, interlace

    size_t total = 8 + (12 + 13) + (12 + idat_len) + (12 + 0);
    uint8_t *png = heap_caps_malloc(total, MALLOC_CAP_SPIRAM);
    if (!png) png = malloc(total);
    if (!png) { free(raw); free(idat); return false; }

    static const uint8_t sig[8] = {0x89,'P','N','G','\r','\n',0x1a,'\n'};
    size_t pos = 0;
    memcpy(png + pos, sig, 8); pos += 8;
    put_chunk(png, &pos, "IHDR", ihdr, 13);
    put_chunk(png, &pos, "IDAT", idat, (uint32_t)idat_len);
    put_chunk(png, &pos, "IEND", NULL, 0);

    free(raw); free(idat);
    *out = png; *out_len = pos;
    return true;
}
```

- [ ] **Step 4: Build to confirm it compiles**

```bash
cd /Users/eren/Projects/maratus-firmware
idf.py build
```
Expected: clean build. (Full validation happens in Task 5 when a real framebuffer is encoded + uploaded + scanned.)

- [ ] **Step 5: Commit**

```bash
git add components/render
git commit -m "feat(firmware): dependency-free grayscale PNG encoder"
```

---

### Task 2: Draw-op IR + grayscale framebuffer renderer

**Files:**
- Create: `components/render/include/draw_ops.h`
- Create: `components/render/include/render.h`
- Create: `components/render/render.c`
- Modify: `components/render/CMakeLists.txt`

- [ ] **Step 1: Draw-op types (shared by escpos + render)**

`components/render/include/draw_ops.h`:
```c
#pragma once
#include <stdint.h>

#define RENDER_ROLL_WIDTH 576   // 80mm @ 203dpi printable dots (M4a fixed)

typedef enum { ALIGN_LEFT, ALIGN_CENTER, ALIGN_RIGHT } align_t;

typedef enum {
    OP_RASTER,   // a 1bpp bit-image (GS v 0)
    OP_FEED,     // vertical whitespace, in dots
    OP_ALIGN,    // set alignment for subsequent rasters
} op_kind_t;

typedef struct {
    op_kind_t kind;
    union {
        struct {
            const uint8_t *bits; // packed 1bpp, MSB-first; 1 = black
            int width_bytes;     // bytes per row
            int width_px;        // width_bytes * 8
            int height;          // dot rows
        } raster;
        struct { int dots; } feed;
        struct { align_t align; } align;
    };
} draw_op_t;
```

- [ ] **Step 2: Render interface**

`components/render/include/render.h`:
```c
#pragma once
#include <stddef.h>
#include <stdint.h>
#include "draw_ops.h"

// Render a list of draw-ops to a PNG. Composes a grayscale framebuffer of width
// RENDER_ROLL_WIDTH (height derived from the ops), then PNG-encodes it.
// Allocates *png_out (caller frees). Returns true + sets dims on success.
bool render_ops_to_png(const draw_op_t *ops, int n_ops,
                       uint8_t **png_out, size_t *png_len,
                       int *out_w, int *out_h);
```

- [ ] **Step 3: Renderer implementation**

`components/render/render.c`:
```c
#include "render.h"
#include "png_encode.h"
#include <string.h>
#include <stdlib.h>
#include "esp_log.h"
#include "esp_heap_caps.h"

static const char *TAG = "render";

#define MAX_HEIGHT 20000   // bound memory; over-long jobs truncate

static int ops_height(const draw_op_t *ops, int n)
{
    int h = 0;
    for (int i = 0; i < n; i++) {
        if (ops[i].kind == OP_RASTER) h += ops[i].raster.height;
        else if (ops[i].kind == OP_FEED) h += ops[i].feed.dots;
    }
    if (h < 1) h = 1;
    if (h > MAX_HEIGHT) h = MAX_HEIGHT;
    return h;
}

static int x_offset(align_t a, int w)
{
    if (w >= RENDER_ROLL_WIDTH) return 0;
    if (a == ALIGN_CENTER) return (RENDER_ROLL_WIDTH - w) / 2;
    if (a == ALIGN_RIGHT)  return RENDER_ROLL_WIDTH - w;
    return 0;
}

bool render_ops_to_png(const draw_op_t *ops, int n_ops,
                       uint8_t **png_out, size_t *png_len, int *out_w, int *out_h)
{
    const int W = RENDER_ROLL_WIDTH;
    int H = ops_height(ops, n_ops);

    size_t fb_len = (size_t)W * H;
    uint8_t *fb = heap_caps_malloc(fb_len, MALLOC_CAP_SPIRAM);
    if (!fb) fb = malloc(fb_len);
    if (!fb) { ESP_LOGE(TAG, "fb alloc failed (%dx%d)", W, H); return false; }
    memset(fb, 0xFF, fb_len); // white

    int cur_y = 0;
    align_t align = ALIGN_LEFT;
    for (int i = 0; i < n_ops; i++) {
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
                    int bit = row[x >> 3] & (0x80 >> (x & 7));
                    if (bit) fb[(size_t)(cur_y + y) * W + px] = 0x00; // black
                }
            }
            cur_y += op->raster.height;
        }
        if (cur_y >= H) break;
    }

    bool ok = png_encode_gray8(fb, W, H, png_out, png_len);
    free(fb);
    if (ok) { if (out_w) *out_w = W; if (out_h) *out_h = H; }
    return ok;
}
```

- [ ] **Step 4: Update render CMake (add render.c)**

`components/render/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "png_encode.c" "render.c"
                       INCLUDE_DIRS "include")
```

- [ ] **Step 5: Build**

```bash
idf.py build
```
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add components/render
git commit -m "feat(firmware): draw-op IR + grayscale framebuffer renderer"
```

---

### Task 3: Epson ESC/POS parser (raster subset) → draw-ops

**Files:**
- Create: `components/escpos/CMakeLists.txt`
- Create: `components/escpos/include/escpos_parser.h`
- Create: `components/escpos/escpos_parser.c`

- [ ] **Step 1: Component registration**

`components/escpos/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "escpos_parser.c"
                       INCLUDE_DIRS "include"
                       REQUIRES render)
```

- [ ] **Step 2: Parser interface**

`components/escpos/include/escpos_parser.h`:
```c
#pragma once
#include <stddef.h>
#include <stdint.h>
#include "draw_ops.h"

// Parse an Epson ESC/POS byte stream into draw-ops (M4a subset: ESC @, ESC a,
// GS v 0 raster, LF/ESC J/ESC d feeds, GS V cut). Raster ops point INTO `data`
// (which must outlive use of the ops). Writes up to `max_ops` into `ops`.
// Returns the number of ops produced.
int escpos_parse(const uint8_t *data, size_t len, draw_op_t *ops, int max_ops);
```

- [ ] **Step 3: Parser implementation**

`components/escpos/escpos_parser.c`:
```c
#include "escpos_parser.h"
#include "esp_log.h"

static const char *TAG = "escpos";

#define LINE_FEED_DOTS 30   // default whitespace for LF / one "line"

int escpos_parse(const uint8_t *data, size_t len, draw_op_t *ops, int max_ops)
{
    int n = 0;
    size_t i = 0;

    #define EMIT(op) do { if (n < max_ops) ops[n++] = (op); } while (0)

    while (i < len && n < max_ops) {
        uint8_t b = data[i];

        if (b == 0x0A) { // LF
            EMIT(((draw_op_t){ .kind = OP_FEED, .feed = { LINE_FEED_DOTS } }));
            i++;
        } else if (b == 0x1B) { // ESC ...
            if (i + 1 >= len) break;
            uint8_t c = data[i + 1];
            if (c == 0x40) { // ESC @ reset
                EMIT(((draw_op_t){ .kind = OP_ALIGN, .align = { ALIGN_LEFT } }));
                i += 2;
            } else if (c == 0x61) { // ESC a n  align
                if (i + 2 >= len) break;
                uint8_t nn = data[i + 2];
                align_t a = (nn == 1 || nn == 49) ? ALIGN_CENTER
                          : (nn == 2 || nn == 50) ? ALIGN_RIGHT : ALIGN_LEFT;
                EMIT(((draw_op_t){ .kind = OP_ALIGN, .align = { a } }));
                i += 3;
            } else if (c == 0x4A) { // ESC J n  feed n dots
                if (i + 2 >= len) break;
                EMIT(((draw_op_t){ .kind = OP_FEED, .feed = { data[i + 2] } }));
                i += 3;
            } else if (c == 0x64) { // ESC d n  feed n lines
                if (i + 2 >= len) break;
                EMIT(((draw_op_t){ .kind = OP_FEED, .feed = { data[i + 2] * LINE_FEED_DOTS } }));
                i += 3;
            } else {
                ESP_LOGW(TAG, "skip ESC 0x%02x", c);
                i += 2; // best-effort (M4c hardens unknown-command skipping)
            }
        } else if (b == 0x1D) { // GS ...
            if (i + 1 >= len) break;
            uint8_t c = data[i + 1];
            if (c == 0x76 && i + 2 < len && data[i + 2] == 0x30) { // GS v 0  raster
                if (i + 7 >= len) break;
                // GS v 0 m xL xH yL yH d1..dk
                int width_bytes = data[i + 4] + (data[i + 5] << 8);
                int height      = data[i + 6] + (data[i + 7] << 8);
                size_t payload  = (size_t)width_bytes * height;
                size_t start    = i + 8;
                if (start + payload > len) { ESP_LOGW(TAG, "raster truncated"); break; }
                EMIT(((draw_op_t){ .kind = OP_RASTER, .raster = {
                    .bits = &data[start], .width_bytes = width_bytes,
                    .width_px = width_bytes * 8, .height = height } }));
                i = start + payload;
            } else if (c == 0x56) { // GS V  cut -> end of job
                ESP_LOGI(TAG, "cut (end of job)");
                break;
            } else {
                ESP_LOGW(TAG, "skip GS 0x%02x", c);
                i += 2;
            }
        } else {
            // Printable/text bytes are ignored in M4a (text is M4c). Skip.
            i++;
        }
    }
    #undef EMIT
    ESP_LOGI(TAG, "parsed %d ops from %u bytes", n, (unsigned)len);
    return n;
}
```

- [ ] **Step 4: Build**

```bash
idf.py build
```
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add components/escpos
git commit -m "feat(firmware): ESC/POS parser (raster subset) -> draw-ops"
```

---

### Task 4: TCP:9100 listener (accumulate a print job)

**Files:**
- Create: `components/escpos/include/escpos_server.h`
- Create: `components/escpos/escpos_server.c`
- Modify: `components/escpos/CMakeLists.txt`

- [ ] **Step 1: Server interface**

`components/escpos/include/escpos_server.h`:
```c
#pragma once
#include <stddef.h>
#include <stdint.h>

// Called once per completed print job with the full received byte buffer.
// The buffer is valid only for the duration of the callback.
typedef void (*escpos_job_cb)(const uint8_t *data, size_t len);

// Start the TCP:9100 listener task. Each accepted connection's bytes are
// accumulated until the peer closes or an idle gap elapses, then `cb` is invoked.
void escpos_server_start(escpos_job_cb cb);
```

- [ ] **Step 2: Server implementation**

`components/escpos/escpos_server.c`:
```c
#include "escpos_server.h"
#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
#include "esp_log.h"
#include "esp_heap_caps.h"

static const char *TAG = "escpos-srv";

#define PRINT_PORT      9100
#define JOB_MAX_BYTES   (2 * 1024 * 1024)  // cap a single job at 2 MB
#define IDLE_MS         1500               // gap that marks end-of-job
#define CHUNK           2048

static escpos_job_cb s_cb;

static void handle_conn(int sock)
{
    size_t cap = 64 * 1024, len = 0;
    uint8_t *buf = heap_caps_malloc(cap, MALLOC_CAP_SPIRAM);
    if (!buf) buf = malloc(cap);
    if (!buf) { ESP_LOGE(TAG, "job buf alloc failed"); return; }

    struct timeval tv = { .tv_sec = IDLE_MS / 1000, .tv_usec = (IDLE_MS % 1000) * 1000 };
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    for (;;) {
        if (len + CHUNK > cap) {
            size_t ncap = cap * 2;
            if (ncap > JOB_MAX_BYTES) ncap = JOB_MAX_BYTES;
            if (len + CHUNK > ncap) { ESP_LOGW(TAG, "job too large, truncating"); break; }
            uint8_t *nb = heap_caps_malloc(ncap, MALLOC_CAP_SPIRAM);
            if (!nb) nb = malloc(ncap);
            if (!nb) { ESP_LOGE(TAG, "job grow failed"); break; }
            memcpy(nb, buf, len); free(buf); buf = nb; cap = ncap;
        }
        int r = recv(sock, buf + len, CHUNK, 0);
        if (r > 0) { len += r; }
        else if (r == 0) { break; }                 // peer closed
        else { break; }                             // timeout (idle) or error -> end of job
    }

    ESP_LOGI(TAG, "job received: %u bytes", (unsigned)len);
    if (len > 0 && s_cb) s_cb(buf, len);
    free(buf);
}

static void server_task(void *arg)
{
    int listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    int yes = 1; setsockopt(listen_sock, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
    struct sockaddr_in addr = { .sin_family = AF_INET, .sin_addr.s_addr = htonl(INADDR_ANY),
                                .sin_port = htons(PRINT_PORT) };
    if (bind(listen_sock, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        ESP_LOGE(TAG, "bind :%d failed", PRINT_PORT); vTaskDelete(NULL); return;
    }
    listen(listen_sock, 1);
    ESP_LOGI(TAG, "listening on :%d", PRINT_PORT);

    for (;;) {
        struct sockaddr_in peer; socklen_t plen = sizeof(peer);
        int sock = accept(listen_sock, (struct sockaddr *)&peer, &plen);
        if (sock < 0) { vTaskDelay(pdMS_TO_TICKS(100)); continue; }
        ESP_LOGI(TAG, "connection accepted");
        handle_conn(sock);
        close(sock);
    }
}

void escpos_server_start(escpos_job_cb cb)
{
    s_cb = cb;
    xTaskCreate(server_task, "escpos_srv", 8192, NULL, 5, NULL);
}
```

- [ ] **Step 3: Update escpos CMake (add server + lwip)**

`components/escpos/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "escpos_parser.c" "escpos_server.c"
                       INCLUDE_DIRS "include"
                       REQUIRES render lwip)
```

- [ ] **Step 4: Build**

```bash
idf.py build
```
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add components/escpos
git commit -m "feat(firmware): TCP:9100 print-job listener"
```

---

### Task 5: Wire the receipt job pipeline

**Files:**
- Create: `main/render_job.h`
- Create: `main/render_job.c`
- Modify: `main/app_main.c`
- Modify: `main/CMakeLists.txt`

- [ ] **Step 1: Job pipeline (parse → render → upload → QR)**

`main/render_job.h`:
```c
#pragma once
#include <stddef.h>
#include <stdint.h>

// escpos_job_cb-compatible: parse the job, render to PNG, upload, show the QR.
void render_job_handle(const uint8_t *data, size_t len);
```

`main/render_job.c`:
```c
#include "render_job.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include <stdlib.h>
#include "escpos_parser.h"
#include "render.h"
#include "cloud.h"
#include "ui.h"

static const char *TAG = "job";

#define MAX_OPS 512

void render_job_handle(const uint8_t *data, size_t len)
{
    ui_show(UI_SCREEN_PROCESSING);

    static draw_op_t ops[MAX_OPS];
    int n = escpos_parse(data, len, ops, MAX_OPS);
    if (n <= 0) { ESP_LOGW(TAG, "no drawable ops; ignoring job"); ui_show(UI_SCREEN_IDLE); return; }

    uint8_t *png = NULL; size_t png_len = 0; int w = 0, h = 0;
    if (!render_ops_to_png(ops, n, &png, &png_len, &w, &h)) {
        ESP_LOGE(TAG, "render failed"); ui_show(UI_SCREEN_IDLE); return;
    }
    ESP_LOGI(TAG, "rendered %dx%d -> PNG %u bytes", w, h, (unsigned)png_len);

    static char url[256];
    int status = cloud_post_receipt(png, png_len, url, sizeof(url));
    free(png);

    if (status == 201 && url[0]) {
        ESP_LOGI(TAG, "receipt ready: %s", url);
        ui_show_qr(url);
    } else {
        ESP_LOGW(TAG, "upload failed (status=%d)", status);
        ui_show(UI_SCREEN_IDLE);
    }
}
```

- [ ] **Step 2: Start the listener at boot**

In `main/app_main.c`, add includes:
```c
#include "escpos_server.h"
#include "render_job.h"
```
After `app_state_run();`, start the print server:
```c
    escpos_server_start(render_job_handle);
    ESP_LOGI(TAG, "print server up on :9100");
```

- [ ] **Step 3: Update main CMake REQUIRES**

`main/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "app_main.c" "app_state.c" "render_job.c"
                       INCLUDE_DIRS "."
                       REQUIRES ui net cloud assets escpos render)
```

- [ ] **Step 4: Build + flash**

```bash
idf.py build && idf.py -p <PORT> flash monitor
```
Expected (serial): after Wi-Fi, `escpos-srv: listening on :9100` and `print server up on :9100`. Note the device's IP from the `net: got IP` line (or `idf.py monitor` boot log).

- [ ] **Step 5: Commit**

```bash
git add main/render_job.h main/render_job.c main/app_main.c main/CMakeLists.txt
git commit -m "feat(firmware): receipt job pipeline (TCP -> parse -> render -> upload -> QR)"
```

---

### Task 6: Node fixture harness + end-to-end verification

**Files:**
- Create: `tools/escpos-harness/package.json`
- Create: `tools/escpos-harness/make-fixture.js`
- Create: `tools/escpos-harness/send.js`
- Create: `tools/escpos-harness/README.md`

- [ ] **Step 1: Harness package + fixture generator**

`tools/escpos-harness/package.json`:
```json
{
  "name": "maratus-escpos-harness",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "maratus-send": "send.js" }
}
```

`tools/escpos-harness/make-fixture.js` — builds a deterministic `GS v 0` raster receipt (a box + horizontal bars; no fonts needed) and writes it as raw ESC/POS bytes:
```js
import { writeFileSync } from "node:fs";

const WIDTH_PX = 576;                 // must match RENDER_ROLL_WIDTH
const WIDTH_BYTES = WIDTH_PX / 8;     // 72
const HEIGHT = 240;

// 1bpp bitmap, MSB-first, 1 = black.
const rows = Buffer.alloc(WIDTH_BYTES * HEIGHT, 0x00);
const setPx = (x, y) => { rows[y * WIDTH_BYTES + (x >> 3)] |= 0x80 >> (x & 7); };
for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH_PX; x++) {
  const border = x < 3 || x >= WIDTH_PX - 3 || y < 3 || y >= HEIGHT - 3;
  const bar = (y >= 40 && y < 60) || (y >= 100 && y < 108) || (y >= 160 && y < 168);
  if (border || bar) setPx(x, y);
}

const esc = Buffer.from([0x1b, 0x40]);                 // ESC @ reset
const center = Buffer.from([0x1b, 0x61, 0x01]);        // ESC a 1 (center)
const header = Buffer.from([
  0x1d, 0x76, 0x30, 0x00,                              // GS v 0 m=0
  WIDTH_BYTES & 0xff, (WIDTH_BYTES >> 8) & 0xff,        // xL xH
  HEIGHT & 0xff, (HEIGHT >> 8) & 0xff,                  // yL yH
]);
const feed = Buffer.from([0x1b, 0x4a, 0x30]);          // ESC J 48 dots
const cut = Buffer.from([0x1d, 0x56, 0x00]);           // GS V 0

const job = Buffer.concat([esc, center, header, rows, feed, cut]);
writeFileSync(new URL("./fixtures/raster-basic.escpos", import.meta.url), job);
console.log(`wrote fixtures/raster-basic.escpos (${job.length} bytes)`);
```

`tools/escpos-harness/send.js` — streams a fixture to the device's port 9100:
```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";

const [, , host, file = new URL("./fixtures/raster-basic.escpos", import.meta.url).pathname] = process.argv;
if (!host) { console.error("usage: node send.js <device-ip> [fixture.escpos]"); process.exit(1); }

const data = readFileSync(file);
const sock = createConnection({ host, port: 9100 }, () => {
  console.log(`connected ${host}:9100, sending ${data.length} bytes`);
  sock.write(data, () => sock.end());            // end() closes -> device treats as job complete
});
sock.on("close", () => console.log("done"));
sock.on("error", (e) => { console.error("error:", e.message); process.exit(1); });
```

`tools/escpos-harness/README.md`:
```md
# Maratus ESC/POS test harness

Streams ESC/POS fixtures to the device's TCP :9100 (acts as a fake POS).

    mkdir -p fixtures
    node make-fixture.js                 # writes fixtures/raster-basic.escpos
    node send.js <device-ip>             # streams it to the printer

`<device-ip>` is the IP from the device's `net: got IP` serial log.
```

- [ ] **Step 2: Generate the fixture**

```bash
cd /Users/eren/Projects/maratus-firmware/tools/escpos-harness
mkdir -p fixtures
node make-fixture.js
```
Expected: `wrote fixtures/raster-basic.escpos (...) bytes`.

- [ ] **Step 3: End-to-end test**

With the device flashed (Task 5) and online, find its IP (serial `net: got IP`), then:
```bash
node send.js <device-ip>
```
Expected:
- Harness prints `connected … sending … bytes` then `done`.
- Device serial: `escpos-srv: connection accepted`, `job received: N bytes`, `escpos: parsed K ops…`, `render: rendered 576xH -> PNG … bytes`, `job: receipt ready: https://…/r/…`.
- Device screen: `Processing…` then the **QR screen**.
- **Scan the QR** → the public receipt shows the rendered box-and-bars raster (centered, 576px wide).
- **Admin** → the receipt appears for the device; first scan flips `ready → downloaded`.

- [ ] **Step 4: Commit**

```bash
cd /Users/eren/Projects/maratus-firmware
git add tools/escpos-harness
git commit -m "feat(firmware): Node ESC/POS fixture harness + raster fixture"
```

---

## Self-Review

**Spec coverage (M4 raster slice, spec §4 + §10):**
- TCP:9100 listener → Task 4 ✓
- Epson parser → draw-ops (ESC @, ESC a, GS v 0, feeds, cut) → Task 3 ✓
- draw-ops → grayscale framebuffer → Task 2 ✓
- PNG encode (the artifact, target A) → Task 1 ✓
- Upload + QR (reusing M3 `cloud_post_receipt` / `ui_show_qr`) → Task 5 ✓
- "Harden GS v 0 raster first" → entire M4a is the raster path ✓
- Node fixture harness in `tools/escpos-harness/` → Task 6 ✓
- **Deferred to M4b/M4c (explicit):** QR/barcode rasterization, bitmap-font text, per-device roll width, robust unknown-command skipping. Noted in the plan header.

**Placeholder scan:** No `TODO`/`TBD` in shipped code. The PNG encoder, parser, server, renderer, job glue, and harness are all complete. The only deliberate simplification (best-effort unknown-command skip) is scoped + logged, not a stub.

**Type/interface consistency:** `draw_op_t`/`op_kind_t`/`align_t`/`RENDER_ROLL_WIDTH` (Task 2 `draw_ops.h`) are produced by `escpos_parse` (Task 3) and consumed by `render_ops_to_png` (Task 2), called in Task 5. `png_encode_gray8` (Task 1) is called by `render.c` (Task 2). `escpos_job_cb` (Task 4) matches `render_job_handle`'s signature (Task 5). `cloud_post_receipt` / `ui_show_qr` / `ui_show(UI_SCREEN_PROCESSING)` match the existing M3 interfaces (verified). The fixture's `GS v 0` header byte layout (`m, xL, xH, yL, yH`) matches the parser's offsets, and `WIDTH_PX 576` matches `RENDER_ROLL_WIDTH`.

**Risk note (not a placeholder):** PNG uses uncompressed (stored) deflate, so a 576×H grayscale receipt is ~`576*H` bytes — a 2000px-tall receipt ≈ 1.15 MB, within the 5 MB ingest cap. If real receipts run taller, adding real deflate (or 1-bit packing) is a fast follow; flagged for M4 polish.
