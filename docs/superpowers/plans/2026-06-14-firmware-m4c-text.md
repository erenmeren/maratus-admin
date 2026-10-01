# Firmware M4c — Text Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render plain-text ESC/POS receipts — printable characters, line breaks, alignment, bold, and size multipliers — into the receipt artifact, so a POS that prints a normal text receipt (not a raster bitmap) produces a correct digital receipt.

**Architecture:** Text is variable-height and wraps, so the `render` framebuffer changes from "pre-compute height" to a **growable canvas** (grow rows on demand). A bundled monospace bitmap font (Nayuki-style `font8x8`, vendored) is blitted glyph-by-glyph with x/y scale + bold. The `escpos` parser accumulates printable runs into `OP_TEXT` ops, maps `LF` to a line break, tracks style from `ESC E` / `ESC !` / `GS !`, and gains a small command-length table so unknown commands don't desync a text stream. Roll width becomes per-device config. Raster (M4a) + QR (M4b) paths are preserved through the canvas refactor and re-verified.

**Tech Stack:** ESP-IDF, vendored `font8x8`, the M4a/M4b `render`/`escpos` components, `appcfg` (roll width). No cloud/UI changes.

**Scope (M4c):** printable ASCII 0x20–0x7E; `LF` line break; `ESC a` alignment (left/center/right — trivial for monospace); `ESC E` bold (double-strike); `ESC !` / `GS !` size multipliers (1–4×, clamped); `ESC @` reset; a length-skip table for common unrendered commands. **Out of scope:** 1D barcodes (`GS k`) + their HRI — deferred to **M4d** (they build on this font). Non-ASCII codepages, proportional fonts.

**Design choices:** monospace `font8x8` rendered at default scale 2 (16px cells → 36 cols at 576px; receipts use ~32). Line height = `8*sy + 4` dots. Bold = re-blit offset +1px. These are deliberate first-cut values; a denser Font-A-like glyph set is a future refinement.

---

### Task 1: Per-device roll width config

**Files:**
- Modify: `main/Kconfig.projbuild`
- Modify: `components/appcfg/include/appcfg.h`
- Modify: `components/appcfg/appcfg.c`

- [ ] **Step 1: Kconfig entry**

Append inside the menu in `main/Kconfig.projbuild` (before `endmenu`):
```
    config MARATUS_ROLL_WIDTH
        int "Receipt roll width in dots"
        default 576
        help
            Printable width of the paper roll in dots (576 = 80mm, 384 = 58mm).
```

- [ ] **Step 2: appcfg getter**

Add to `components/appcfg/include/appcfg.h`:
```c
int appcfg_roll_width(void);          // dots (e.g. 576 = 80mm, 384 = 58mm)
```
Add to `components/appcfg/appcfg.c`:
```c
int appcfg_roll_width(void) { return CONFIG_MARATUS_ROLL_WIDTH; }
```

- [ ] **Step 3: Build**

```bash
cd /Users/eren/Projects/maratus-firmware
idf.py build
```
Expected: clean build (getter unused until Task 3 wires it).

- [ ] **Step 4: Commit**

```bash
git add main/Kconfig.projbuild components/appcfg
git commit -m "feat(firmware): per-device roll width config"
```

---

### Task 2: Vendor the `font8x8` bitmap font

**Files:**
- Create: `components/font8x8/include/font8x8_basic.h` (from upstream)
- Create: `components/font8x8/CMakeLists.txt`
- Create: `components/font8x8/README.md`

- [ ] **Step 1: Fetch the public-domain font**

```bash
cd /Users/eren/Projects/maratus-firmware
mkdir -p components/font8x8/include
curl -fsSL https://raw.githubusercontent.com/dhepper/font8x8/master/font8x8_basic.h \
  -o components/font8x8/include/font8x8_basic.h
```
Confirm: `grep -c "font8x8_basic" components/font8x8/include/font8x8_basic.h` ≥ 1 and the file defines `char font8x8_basic[128][8]` (each glyph = 8 row-bytes, **bit 0 = leftmost** column).

- [ ] **Step 2: Header-only component registration**

`components/font8x8/CMakeLists.txt`:
```cmake
idf_component_register(INCLUDE_DIRS "include")
```

`components/font8x8/README.md`:
```md
# font8x8 (vendored)

8x8 monospace bitmap font (basic Latin, ASCII 0–127) by Daniel Hepper — **public domain**.
Source: https://github.com/dhepper/font8x8 (`font8x8_basic.h`).

`char font8x8_basic[128][8]` — each glyph is 8 row-bytes; bit 0 (LSB) is the leftmost
column. Used by `components/render` for ESC/POS text (M4c).
```

- [ ] **Step 3: Build**

```bash
idf.py build
```
Expected: clean build (header compiles; unused until Task 4).

- [ ] **Step 4: Commit**

```bash
git add components/font8x8
git commit -m "chore(firmware): vendor font8x8 (public domain)"
```

---

### Task 3: Refactor `render` to a growable canvas (raster/QR/feed/align preserved)

**Files:**
- Modify: `components/render/include/render.h`
- Modify: `components/render/render.c`
- Modify: `main/app_main.c` (set roll width at boot)

- [ ] **Step 1: Add the roll-width setter to the interface**

In `components/render/include/render.h`, add above `render_ops_to_png`:
```c
// Set the framebuffer/roll width in dots (default RENDER_ROLL_WIDTH). Call once at boot.
void render_set_roll_width(int dots);
```

- [ ] **Step 2: Rewrite `render.c` with a growable canvas**

Replace the entire body of `components/render/render.c` with (this keeps QR via qrcodegen and raster/feed/align; text is added in Task 4):
```c
#include "render.h"
#include "png_encode.h"
#include <string.h>
#include <stdlib.h>
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "qrcodegen.h"

static const char *TAG = "render";

#define MAX_HEIGHT 20000
#define QR_QUIET   4

static int s_roll_width = RENDER_ROLL_WIDTH;
void render_set_roll_width(int dots) { if (dots >= 128 && dots <= 2048) s_roll_width = dots; }

// ---- growable grayscale canvas (white background) ----
typedef struct { uint8_t *px; int W; int cur_y; int cap; bool oom; } canvas_t;

static bool canvas_ensure(canvas_t *c, int rows_needed)
{
    int want = c->cur_y + rows_needed;
    if (want <= c->cap) return true;
    if (want > MAX_HEIGHT) want = MAX_HEIGHT;
    int ncap = c->cap ? c->cap : 256;
    while (ncap < want) ncap *= 2;
    if (ncap > MAX_HEIGHT) ncap = MAX_HEIGHT;
    uint8_t *np = heap_caps_malloc((size_t)c->W * ncap, MALLOC_CAP_SPIRAM);
    if (!np) np = malloc((size_t)c->W * ncap);
    if (!np) { c->oom = true; return false; }
    memset(np, 0xFF, (size_t)c->W * ncap);
    if (c->px) { memcpy(np, c->px, (size_t)c->W * c->cur_y); free(c->px); }
    c->px = np; c->cap = ncap;
    return true;
}

static void canvas_set(canvas_t *c, int x, int y, uint8_t v)
{
    if (x < 0 || x >= c->W || y < 0 || y >= c->cap) return;
    c->px[(size_t)y * c->W + x] = v;
}

static int x_offset(align_t a, int w, int W)
{
    if (w >= W) return 0;
    if (a == ALIGN_CENTER) return (W - w) / 2;
    if (a == ALIGN_RIGHT)  return W - w;
    return 0;
}

// ---- QR ----
typedef struct {
    uint8_t qr[qrcodegen_BUFFER_LEN_FOR_VERSION(qrcodegen_VERSION_MAX)];
    int side; int module_px;
} qr_enc_t;

static enum qrcodegen_Ecc ecc_of(uint8_t e)
{
    switch (e) { case 1: return qrcodegen_Ecc_MEDIUM; case 2: return qrcodegen_Ecc_QUARTILE;
                 case 3: return qrcodegen_Ecc_HIGH; default: return qrcodegen_Ecc_LOW; }
}

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

bool render_ops_to_png(const draw_op_t *ops, int n_ops,
                       uint8_t **png_out, size_t *png_len, int *out_w, int *out_h)
{
    canvas_t c = { .W = s_roll_width };
    align_t align = ALIGN_LEFT;

    for (int i = 0; i < n_ops && !c.oom; i++) {
        const draw_op_t *op = &ops[i];
        if (op->kind == OP_ALIGN) {
            align = op->align.align;
        } else if (op->kind == OP_FEED) {
            if (canvas_ensure(&c, op->feed.dots)) c.cur_y += op->feed.dots;
        } else if (op->kind == OP_RASTER) {
            int h = op->raster.height;
            if (!canvas_ensure(&c, h)) break;
            int xo = x_offset(align, op->raster.width_px, c.W);
            for (int y = 0; y < h; y++) {
                const uint8_t *row = op->raster.bits + (size_t)y * op->raster.width_bytes;
                for (int x = 0; x < op->raster.width_px; x++)
                    if (row[x >> 3] & (0x80 >> (x & 7))) canvas_set(&c, xo + x, c.cur_y + y, 0x00);
            }
            c.cur_y += h;
        } else if (op->kind == OP_QR) {
            qr_enc_t *e = malloc(sizeof(qr_enc_t));
            if (!e || !qr_encode(op, e)) { free(e); ESP_LOGW(TAG, "QR encode failed"); continue; }
            int box = (e->side + 2 * QR_QUIET) * e->module_px;
            if (!canvas_ensure(&c, box)) { free(e); break; }
            int xo = x_offset(align, box, c.W);
            for (int my = 0; my < e->side; my++)
                for (int mx = 0; mx < e->side; mx++)
                    if (qrcodegen_getModule(e->qr, mx, my))
                        for (int dy = 0; dy < e->module_px; dy++)
                            for (int dx = 0; dx < e->module_px; dx++)
                                canvas_set(&c, xo + (QR_QUIET + mx) * e->module_px + dx,
                                               c.cur_y + (QR_QUIET + my) * e->module_px + dy, 0x00);
            c.cur_y += box;
            free(e);
        }
    }

    if (c.oom || !c.px) { free(c.px); ESP_LOGE(TAG, "canvas alloc failed"); return false; }
    int H = c.cur_y > 0 ? c.cur_y : 1;
    if (H > c.cap) H = c.cap;

    bool ok = png_encode_gray8(c.px, c.W, H, png_out, png_len);
    free(c.px);
    if (ok) { if (out_w) *out_w = c.W; if (out_h) *out_h = H; }
    return ok;
}
```

- [ ] **Step 3: Set the roll width at boot**

In `main/app_main.c`, add `#include "render.h"` (if not present) and after `bsp_display_start();` (before any job can arrive), add:
```c
    render_set_roll_width(appcfg_roll_width());
```
Add `#include "appcfg.h"` to `app_main.c` if not already included. (`main` already REQUIRES `render` and `appcfg`.)

- [ ] **Step 4: Build + flash + re-verify raster + QR still work**

```bash
idf.py build && idf.py -p <PORT> flash monitor
# re-run the M4a + M4b fixtures:
cd tools/escpos-harness
node send.js <device-ip> fixtures/raster-basic.escpos     # box-and-bars renders
node send.js <device-ip> fixtures/qr-basic.escpos          # QR renders
```
Expected: both still produce correct receipts (the canvas refactor preserves behavior). Serial shows `rendered 576xH`.

- [ ] **Step 5: Commit**

```bash
git add components/render main/app_main.c
git commit -m "refactor(firmware): growable render canvas + per-device width"
```

---

### Task 4: Glyph blit + text line layout

**Files:**
- Modify: `components/render/include/draw_ops.h`
- Modify: `components/render/render.c`
- Modify: `components/render/CMakeLists.txt`

- [ ] **Step 1: Add text draw-ops**

In `components/render/include/draw_ops.h`, extend the enum:
```c
typedef enum {
    OP_RASTER,
    OP_FEED,
    OP_ALIGN,
    OP_QR,
    OP_TEXT,        // a styled run of printable characters
    OP_LINE_BREAK,  // end the current text line (LF)
} op_kind_t;
```
Add to the union:
```c
        struct {
            const char *text;  // points INTO the job buffer
            int len;
            uint8_t sx, sy;    // size multipliers (1..4)
            uint8_t bold;
        } text;
```

- [ ] **Step 2: Glyph blit + line engine in `render.c`**

Add `#include "font8x8_basic.h"` near the top of `render.c`. Add the glyph + line-buffer machinery above `render_ops_to_png`:
```c
#define GLYPH_W 8
#define GLYPH_H 8
#define LINE_PAD 4          // dots of leading below a text line
#define MAX_LINE_GLYPHS 256

typedef struct { uint8_t ch, sx, sy, bold; } glyph_t;
typedef struct { glyph_t g[MAX_LINE_GLYPHS]; int n; int width; } line_t;

static void blit_glyph(canvas_t *c, int x, int y, uint8_t ch, int sx, int sy, bool bold)
{
    if (ch < 0x20 || ch > 0x7e) ch = 0x20;
    const char *g = font8x8_basic[(int)ch];
    for (int row = 0; row < GLYPH_H; row++) {
        uint8_t bits = (uint8_t)g[row];
        for (int col = 0; col < GLYPH_W; col++) {
            if (!(bits & (1 << col))) continue;   // font8x8: bit0 = leftmost
            for (int dy = 0; dy < sy; dy++)
                for (int dx = 0; dx < sx; dx++) {
                    canvas_set(c, x + col * sx + dx, y + row * sy + dy, 0x00);
                    if (bold) canvas_set(c, x + col * sx + dx + 1, y + row * sy + dy, 0x00);
                }
        }
    }
}

// Flush the buffered line to the canvas at cur_y, then advance. Empty line => blank line.
static void flush_line(canvas_t *c, line_t *ln, align_t align)
{
    int line_h = GLYPH_H; // scaled below by max sy
    if (ln->n == 0) {
        line_h = GLYPH_H + LINE_PAD;
        if (canvas_ensure(c, line_h)) c->cur_y += line_h;
        return;
    }
    int max_sy = 1;
    for (int i = 0; i < ln->n; i++) if (ln->g[i].sy > max_sy) max_sy = ln->g[i].sy;
    line_h = GLYPH_H * max_sy + LINE_PAD;
    if (!canvas_ensure(c, line_h)) { ln->n = 0; ln->width = 0; return; }

    int x = x_offset(align, ln->width, c->W);
    for (int i = 0; i < ln->n; i++) {
        glyph_t *g = &ln->g[i];
        blit_glyph(c, x, c->cur_y, g->ch, g->sx, g->sy, g->bold);
        x += GLYPH_W * g->sx;
    }
    c->cur_y += line_h;
    ln->n = 0; ln->width = 0;
}

// Append one styled char to the line, soft-wrapping at the roll width.
static void line_putc(canvas_t *c, line_t *ln, align_t align, uint8_t ch, int sx, int sy, bool bold)
{
    int gw = GLYPH_W * sx;
    if (ln->n > 0 && (ln->width + gw > c->W || ln->n >= MAX_LINE_GLYPHS)) flush_line(c, ln, align);
    if (ln->n < MAX_LINE_GLYPHS) {
        ln->g[ln->n++] = (glyph_t){ ch, (uint8_t)sx, (uint8_t)sy, (uint8_t)bold };
        ln->width += gw;
    }
}
```

- [ ] **Step 3: Handle OP_TEXT / OP_LINE_BREAK in the op loop**

In `render_ops_to_png`, declare a line buffer at the top (after `align_t align = ALIGN_LEFT;`):
```c
    static line_t ln; ln.n = 0; ln.width = 0;
```
Add two cases inside the op loop (after the `OP_QR` case):
```c
        } else if (op->kind == OP_TEXT) {
            int sx = op->text.sx < 1 ? 1 : (op->text.sx > 4 ? 4 : op->text.sx);
            int sy = op->text.sy < 1 ? 1 : (op->text.sy > 4 ? 4 : op->text.sy);
            for (int k = 0; k < op->text.len; k++)
                line_putc(&c, &ln, align, (uint8_t)op->text.text[k], sx, sy, op->text.bold);
        } else if (op->kind == OP_LINE_BREAK) {
            flush_line(&c, &ln, align);
```
And before computing the final height (right after the loop, before `if (c.oom ...)`), flush any trailing line:
```c
    flush_line(&c, &ln, align);
```
Also, the existing `OP_RASTER` and `OP_QR` cases must flush a pending text line first so text doesn't overlap an image. At the very start of both the `OP_RASTER` and `OP_QR` branches, add:
```c
            flush_line(&c, &ln, align);
```

- [ ] **Step 4: Add font8x8 to render REQUIRES**

`components/render/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "png_encode.c" "render.c"
                       INCLUDE_DIRS "include"
                       REQUIRES qrcodegen font8x8)
```

- [ ] **Step 5: Build**

```bash
idf.py build
```
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add components/render
git commit -m "feat(firmware): bitmap-font text layout (align/bold/size)"
```

---

### Task 5: Parser — text runs, styles, line breaks, robust skipping

**Files:**
- Modify: `components/escpos/escpos_parser.c`

- [ ] **Step 1: Track text style + emit text runs**

In `escpos_parse`, add style state next to the QR state (after `uint8_t qr_ecc = 0;`):
```c
    // Text style state.
    uint8_t t_sx = 1, t_sy = 1, t_bold = 0;
    size_t run_start = 0; int run_active = 0;
```
Add a helper macro to flush a pending printable run (place right after the `EMIT` macro):
```c
    #define FLUSH_RUN() do { \
        if (run_active && i > run_start) { \
            EMIT(((draw_op_t){ .kind = OP_TEXT, .text = { \
                .text = (const char *)&data[run_start], .len = (int)(i - run_start), \
                .sx = t_sx, .sy = t_sy, .bold = t_bold } })); \
        } \
        run_active = 0; \
    } while (0)
```

- [ ] **Step 2: Replace LF handling + the text-byte fallthrough**

Change the `LF` branch (currently emits OP_FEED) to flush the run and emit a line break:
```c
        if (b == 0x0A) { // LF -> end of text line
            FLUSH_RUN();
            EMIT(((draw_op_t){ .kind = OP_LINE_BREAK }));
            i++;
        }
```
Change the final `else` (currently "Printable/text bytes are ignored") to accumulate a run:
```c
        } else {
            if (b == 0x0D) { i++; continue; }   // ignore CR
            if (b < 0x20 && b != 0x09) { i++; continue; } // skip other control bytes (keep TAB as space-ish below)
            if (!run_active) { run_start = i; run_active = 1; }
            i++;
        }
```
(A bare printable run grows until a control/command byte; `FLUSH_RUN()` is called by those handlers — see Step 3.)

- [ ] **Step 3: Flush the run before every command + add style commands**

At the **start** of both the `else if (b == 0x1B)` (ESC) and `else if (b == 0x1D)` (GS) branches — i.e., immediately after entering each branch and before reading `c` — add:
```c
            FLUSH_RUN();
```
In the ESC branch, add style cases alongside the existing `ESC @`/`ESC a`/`ESC J`/`ESC d`. Replace the `ESC @` case body and add the new ones:
```c
            if (c == 0x40) { // ESC @ reset
                t_sx = 1; t_sy = 1; t_bold = 0;
                EMIT(((draw_op_t){ .kind = OP_ALIGN, .align = { ALIGN_LEFT } }));
                i += 2;
            } else if (c == 0x45) { // ESC E n  bold
                if (i + 2 >= len) break;
                t_bold = data[i + 2] & 1;
                i += 3;
            } else if (c == 0x21) { // ESC ! n  print mode
                if (i + 2 >= len) break;
                uint8_t m = data[i + 2];
                t_bold = (m & 0x08) ? 1 : 0;
                t_sx = (m & 0x20) ? 2 : 1;
                t_sy = (m & 0x10) ? 2 : 1;
                i += 3;
            } else if (c == 0x61) { // ESC a n  align
```
(That is: keep the existing `ESC a`, `ESC J`, `ESC d` branches as the chained `else if`s after the new ones.)

In the GS branch, add the `GS !` size case as a chained `else if` (after the `GS ( k` and before/after `GS v 0` — order among distinct command bytes doesn't matter):
```c
            } else if (c == 0x21) { // GS ! n  character size
                if (i + 2 >= len) break;
                uint8_t m = data[i + 2];
                int w = ((m >> 4) & 0x07) + 1; if (w > 4) w = 4;
                int h = (m & 0x07) + 1;        if (h > 4) h = 4;
                t_sx = w; t_sy = h;
                i += 3;
            }
```

- [ ] **Step 4: Robust skip table for unrendered commands**

Replace the two unknown-command fallbacks (`ESP_LOGW(TAG, "skip ESC 0x%02x", c); i += 2;` and the GS equivalent) with a length-aware skip. Add this helper above `escpos_parse`:
```c
// Bytes to advance for known-but-unrendered ESC/GS commands (incl. the 2 prefix
// bytes), so a text stream doesn't desync. Returns 0 if unknown (caller skips 2).
static int esc_cmd_len(uint8_t c)
{
    switch (c) {
        case 0x20: case 0x21: case 0x25: case 0x32: case 0x33: // already handled or 1-param
        case 0x4D: case 0x52: case 0x54: case 0x2D: case 0x7B: return 3; // ESC SP/!/%/2.../M/R/t/-/{ (n)
        case 0x56: return 3;  // ESC V n
        default: return 0;
    }
}
static int gs_cmd_len(uint8_t c)
{
    switch (c) {
        case 0x21: case 0x42: case 0x48: case 0x66: case 0x68: case 0x77: return 3; // GS !/B/H/f/h/w (n)
        default: return 0;
    }
}
```
ESC unknown fallback:
```c
            } else {
                int adv = esc_cmd_len(c);
                ESP_LOGW(TAG, "skip ESC 0x%02x (+%d)", c, adv ? adv : 2);
                i += adv ? adv : 2;
            }
```
GS unknown fallback:
```c
            } else {
                int adv = gs_cmd_len(c);
                ESP_LOGW(TAG, "skip GS 0x%02x (+%d)", c, adv ? adv : 2);
                i += adv ? adv : 2;
            }
```
Finally, after the main `while` loop ends and before `#undef EMIT`, flush any trailing run:
```c
    FLUSH_RUN();
    #undef FLUSH_RUN
```

- [ ] **Step 5: Build**

```bash
idf.py build
```
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add components/escpos
git commit -m "feat(firmware): parse text runs, styles, line breaks + length-skip table"
```

---

### Task 6: Text fixture + end-to-end verification

**Files:**
- Create: `tools/escpos-harness/make-text-fixture.js`

- [ ] **Step 1: Text receipt fixture**

`tools/escpos-harness/make-text-fixture.js` — a realistic text receipt exercising align, size, bold, lines, plus a QR (proves text + QR compose):
```js
import { writeFileSync, mkdirSync } from "node:fs";

const b = [];
const push = (...xs) => xs.forEach((x) => b.push(typeof x === "string" ? Buffer.from(x, "latin1") : Buffer.from(x)));

push([0x1b, 0x40]);                       // ESC @ reset
push([0x1b, 0x61, 0x01]);                 // center
push([0x1d, 0x21, 0x11]);                 // GS ! double w+h
push("ROASTWELL\n");
push([0x1d, 0x21, 0x00]);                 // GS ! normal size
push([0x1b, 0x45, 0x01], "Coffee Bar\n", [0x1b, 0x45, 0x00]); // bold line
push([0x1b, 0x61, 0x00]);                 // left
push("--------------------------------\n");
push("1x Flat White            4.50\n");
push("1x Croissant             3.25\n");
push("--------------------------------\n");
push([0x1b, 0x61, 0x02]);                 // right
push([0x1b, 0x45, 0x01], "TOTAL  7.75\n", [0x1b, 0x45, 0x00]);
push([0x1b, 0x61, 0x01]);                 // center
push("\n", "Scan for your e-receipt\n");
// a QR too:
const url = Buffer.from("https://maratus.app/r/text-demo", "latin1");
const sl = url.length + 3;
push([0x1d, 0x28, 0x6b, 0x03, 0x00, 49, 67, 6]);                 // size 6
push([0x1d, 0x28, 0x6b, 0x03, 0x00, 49, 69, 49]);                // ecc M
push([0x1d, 0x28, 0x6b, sl & 0xff, (sl >> 8) & 0xff, 49, 80, 48]); url && b.push(url); // store
push([0x1d, 0x28, 0x6b, 0x03, 0x00, 49, 81, 48]);                // print
push([0x1b, 0x4a, 0x40]);                 // feed
push([0x1d, 0x56, 0x00]);                 // cut

const job = Buffer.concat(b);
mkdirSync(new URL("./fixtures", import.meta.url), { recursive: true });
writeFileSync(new URL("./fixtures/text-receipt.escpos", import.meta.url), job);
console.log(`wrote fixtures/text-receipt.escpos (${job.length} bytes)`);
```

- [ ] **Step 2: Generate + send (after flashing M4c firmware)**

```bash
cd /Users/eren/Projects/maratus-firmware && idf.py build && idf.py -p <PORT> flash monitor
# another shell:
cd tools/escpos-harness && node make-text-fixture.js && node send.js <device-ip> fixtures/text-receipt.escpos
```

- [ ] **Step 3: Verify**

Expected:
- Serial: `parsed N ops` (text runs + line breaks + a QR), `rendered <W>xH -> PNG …`, `receipt ready: …`.
- Screen: `Processing…` → QR.
- **Scan** → the public receipt shows a real text receipt: centered double-size "ROASTWELL", bold "Coffee Bar", left-aligned item lines, right-aligned bold "TOTAL 7.75", and a centered QR at the bottom. The in-receipt QR scans to `https://maratus.app/r/text-demo`.
- Admin lists the receipt.

- [ ] **Step 4: Commit**

```bash
git add tools/escpos-harness/make-text-fixture.js
git commit -m "feat(firmware): text-receipt ESC/POS fixture"
```

---

## Self-Review

**Spec coverage (M4c):**
- Bitmap-font text rendering → Tasks 2, 4 ✓
- Text commands: printable runs, `LF` line break, `ESC a` align, `ESC E` bold, `ESC !` / `GS !` size, `ESC @` reset → Tasks 4, 5 ✓
- Robust unknown-command skipping (length table) → Task 5 ✓
- Per-device roll width → Tasks 1, 3 ✓
- Growable framebuffer (enables variable text height; preserves raster/QR) → Task 3 ✓
- Raster (M4a) + QR (M4b) re-verified after refactor → Task 3 Step 4 ✓
- **Deferred to M4d:** 1D barcodes (`GS k` Code128 + HRI). Stated in header.

**Placeholder scan:** No `TODO`/`TBD` in shipped code. Task 2 vendors a named public-domain font by exact URL (artifact, not placeholder). All render/parser/fixture code is complete.

**Type/interface consistency:** `OP_TEXT`/`OP_LINE_BREAK` + the `text` union member (Task 4 `draw_ops.h`) are emitted by the parser (Task 5) and consumed by the render op loop (Task 4 Step 3). `glyph_t`/`line_t`/`blit_glyph`/`flush_line`/`line_putc` (Task 4) are used only within `render.c`. `render_set_roll_width` (Task 3) is called from `app_main` (Task 3 Step 3) with `appcfg_roll_width()` (Task 1). The size clamps (1..4) in render (Task 4) match the parser's caps (Task 5 `GS !` `w/h > 4` → 4). `canvas_t`/`canvas_ensure`/`canvas_set`/`x_offset` (Task 3) are reused by the text engine (Task 4). font8x8 bit order (bit0=leftmost) is honored in `blit_glyph` (`1 << col`).

**Risk notes (not placeholders):**
- `font8x8` at scale 2 yields ~36 cols at 576px; very long lines soft-wrap. A denser Font-A glyph set is a future refinement (noted in Design choices).
- The length-skip table covers common 1-param ESC/GS commands; an exotic variable-length command could still desync a text stream. The table is easily extended; flagged for hardening if a real POS surfaces one.
- `OP_TEXT` points into the job buffer (like raster/QR), valid for the render call — consistent with the existing M4a/M4b lifetime contract.
