# Firmware M4d — Code128 Barcode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Epson `GS k` **Code128** barcodes into the receipt artifact — a POS that prints an order/loyalty barcode produces a scannable Code128 in the uploaded PNG, with optional human-readable (HRI) digits below.

**Architecture:** A new `barcode` component implements a Code128-B encoder (canonical symbol table → module bit run, mod-103 checksum). A new `OP_BARCODE` draw-op carries the data + bar height + module width + HRI position. The `render` component blits the bar run (scaled, quiet-zoned, aligned) and, if requested, the HRI string below using the existing `font8x8` glyph blit. The parser learns `GS k` (Code128) and captures `GS h` (height) / `GS w` (module width) / `GS H` (HRI position), which it previously skipped. Completes the M4 ESC/POS feature set (raster + QR + text + barcode).

**Tech Stack:** ESP-IDF, the M4a–M4c `render`/`escpos` components, `font8x8` (HRI text). Code128 encoder is self-contained C.

**Scope (M4d):** Code128 subset **B** (ASCII 32–127) via `GS k 73 n d1..dn` (length-prefixed form); `GS h n` height; `GS w n` module width (clamped 2–6); `GS H n` HRI position (0 none / 2 below — 1 "above" and 3 "both" treated as below for M4d). **Out of scope:** EAN-13/UPC/Code39/ITF, the NUL-terminated `GS k m<=6` form (skipped safely), HRI font selection (`GS f`).

**Correctness gate:** a wrong symbol-table entry yields an unscannable barcode. The Task 4 verification **scans the rendered barcode with a phone barcode app** and confirms it decodes back to the input string — proof by scan, like the QR double-scan in M4b.

---

### Task 1: Code128-B encoder component

**Files:**
- Create: `components/barcode/include/barcode.h`
- Create: `components/barcode/code128.c`
- Create: `components/barcode/CMakeLists.txt`

- [ ] **Step 1: Encoder interface**

`components/barcode/include/barcode.h`:
```c
#pragma once
#include <stddef.h>

// Encode `data` (len bytes, treated as Code128-B / ASCII 32..127) into a run of
// modules: out[k] = 1 for a bar, 0 for a space (no quiet zone — caller adds it).
// Returns the module count, or -1 on overflow/empty. cap = capacity of `out`.
int code128b_encode(const char *data, int len, unsigned char *out, int cap);
```

- [ ] **Step 2: Encoder + canonical symbol table**

`components/barcode/code128.c`:
```c
#include "barcode.h"

// Canonical Code128 symbol widths (values 0..106). Each string lists the widths
// of alternating bar,space,bar,space,bar,space (and a trailing bar for the stop
// symbol 106). Widths sum to 11 (13 for stop). This is the standard Code128 table.
static const char *CODE128[107] = {
 "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
 "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
 "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
 "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
 "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
 "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
 "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
 "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
 "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
 "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
 "114131","311141","411131","211412","211214","211232","2331112"
};

#define START_B 104
#define STOP    106

int code128b_encode(const char *data, int len, unsigned char *out, int cap)
{
    if (len <= 0) return -1;

    // Symbol values: Start-B, data values, checksum, Stop.
    int vals[300];
    int nv = 0;
    vals[nv++] = START_B;
    long sum = START_B;
    for (int k = 0; k < len && nv < 297; k++) {
        unsigned char ch = (unsigned char)data[k];
        if (ch < 32 || ch > 127) ch = 32;
        int v = ch - 32;            // Code128-B value
        vals[nv++] = v;
        sum += (long)v * (k + 1);   // weight = position (1-based)
    }
    vals[nv++] = (int)(sum % 103);  // checksum
    vals[nv++] = STOP;

    // Expand symbols to module bits.
    int m = 0;
    for (int s = 0; s < nv; s++) {
        const char *pat = CODE128[vals[s]];
        int bar = 1; // each symbol starts with a bar
        for (const char *p = pat; *p; p++) {
            int w = *p - '0';
            for (int j = 0; j < w; j++) { if (m >= cap) return -1; out[m++] = bar ? 1 : 0; }
            bar = !bar;
        }
    }
    return m;
}
```

- [ ] **Step 3: Component registration**

`components/barcode/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "code128.c"
                       INCLUDE_DIRS "include")
```

- [ ] **Step 4: Build**

```bash
cd /Users/eren/Projects/maratus-firmware
idf.py build
```
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add components/barcode
git commit -m "feat(firmware): Code128-B encoder"
```

---

### Task 2: `OP_BARCODE` draw-op + render (bars + HRI)

**Files:**
- Modify: `components/render/include/draw_ops.h`
- Modify: `components/render/render.c`
- Modify: `components/render/CMakeLists.txt`

- [ ] **Step 1: Add the barcode draw-op**

In `components/render/include/draw_ops.h`, extend the enum:
```c
    OP_TEXT,        // a styled run of printable characters
    OP_LINE_BREAK,  // end the current text line (LF)
    OP_BARCODE,     // a Code128 barcode (GS k)
} op_kind_t;
```
Add to the union:
```c
        struct {
            const char *data; // points INTO the job buffer
            int len;
            int height;       // bar height in dots
            int module_w;     // narrowest module width in dots (2..6)
            uint8_t hri;      // 0 = none, else print human-readable text below
        } barcode;
```

- [ ] **Step 2: Render the barcode (+ HRI) in `render.c`**

Add `#include "barcode.h"` near the top of `render.c`. Add a barcode handler above `render_ops_to_png` (it reuses the existing `canvas_*`, `x_offset`, and `blit_glyph`):
```c
#define BC_QUIET 10          // quiet-zone modules each side
#define BC_MAX_MODULES 1200

static void render_barcode(canvas_t *c, align_t align, const draw_op_t *op)
{
    static unsigned char bits[BC_MAX_MODULES];
    int m = code128b_encode(op->barcode.data, op->barcode.len, bits, BC_MAX_MODULES);
    if (m <= 0) { ESP_LOGW(TAG, "barcode encode failed"); return; }

    int mw = op->barcode.module_w < 2 ? 2 : (op->barcode.module_w > 6 ? 6 : op->barcode.module_w);
    int bh = op->barcode.height < 16 ? 16 : (op->barcode.height > 400 ? 400 : op->barcode.height);
    int total_w = (m + 2 * BC_QUIET) * mw;

    int hri_h = op->barcode.hri ? (GLYPH_H + 4) : 0;
    if (!canvas_ensure(c, bh + hri_h)) return;

    int xo = x_offset(align, total_w, c->W) + BC_QUIET * mw;
    int x = xo;
    for (int k = 0; k < m; k++) {
        if (bits[k]) {
            for (int dx = 0; dx < mw; dx++)
                for (int y = 0; y < bh; y++)
                    canvas_set(c, x + dx, c->cur_y + y, 0x00);
        }
        x += mw;
    }

    // HRI digits centered under the bars (scale 1).
    if (op->barcode.hri) {
        int text_w = op->barcode.len * GLYPH_W;
        int tx = x_offset(align, text_w, c->W);
        // center the HRI under the barcode region instead of the whole roll if narrower
        if (text_w < total_w) tx = x_offset(align, total_w, c->W) + (total_w - text_w) / 2;
        for (int k = 0; k < op->barcode.len; k++)
            blit_glyph(c, tx + k * GLYPH_W, c->cur_y + bh + 2, (uint8_t)op->barcode.data[k], 1, 1, false);
    }
    c->cur_y += bh + hri_h;
}
```

- [ ] **Step 3: Handle `OP_BARCODE` in the op loop**

In `render_ops_to_png`, add a case (after the `OP_QR` branch), flushing any pending text line first:
```c
        } else if (op->kind == OP_BARCODE) {
            flush_line(&c, &ln, align);
            render_barcode(&c, align, op);
```

- [ ] **Step 4: Add barcode to render REQUIRES**

`components/render/CMakeLists.txt`:
```cmake
idf_component_register(SRCS "png_encode.c" "render.c"
                       INCLUDE_DIRS "include"
                       REQUIRES qrcodegen font8x8 barcode)
```

- [ ] **Step 5: Build**

```bash
idf.py build
```
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add components/render
git commit -m "feat(firmware): render Code128 barcodes + HRI"
```

---

### Task 3: Parse `GS k` (Code128) + `GS h`/`GS w`/`GS H`

**Files:**
- Modify: `components/escpos/escpos_parser.c`

- [ ] **Step 1: Stop skipping the barcode-config commands**

In `gs_cmd_len`, remove `GS H` (0x48), `GS h` (0x68), `GS w` (0x77) — they get handled explicitly now. Replace the function with:
```c
static int gs_cmd_len(uint8_t c)
{
    switch (c) {
        case 0x42: case 0x66: return 3; // GS B / GS f (n) — still skipped
        case 0x4C: return 4;            // GS L nL nH
        default: return 0;
    }
}
```

- [ ] **Step 2: Add barcode state**

In `escpos_parse`, next to the text-style state, add:
```c
    // Barcode config state.
    int bc_height = 80;   // GS h n (dots)
    int bc_module = 3;    // GS w n (narrow module dots)
    uint8_t bc_hri = 0;   // GS H n (0 none, else HRI below)
```

- [ ] **Step 3: Handle the GS commands**

In the GS branch, add these as chained `else if`s (after `GS ( k` / `GS !` and before/after `GS v 0` — distinct command bytes, order-independent):
```c
            } else if (c == 0x68) {      // GS h n  barcode height
                if (i + 2 >= len) break;
                bc_height = data[i + 2];
                i += 3;
            } else if (c == 0x77) {      // GS w n  module width
                if (i + 2 >= len) break;
                bc_module = data[i + 2];
                i += 3;
            } else if (c == 0x48) {      // GS H n  HRI position (0 none,1 above,2 below,3 both)
                if (i + 2 >= len) break;
                bc_hri = data[i + 2];
                i += 3;
            } else if (c == 0x6B) {      // GS k  barcode
                if (i + 2 >= len) break;
                uint8_t mtype = data[i + 2];
                if (mtype >= 65) {       // length-prefixed form: GS k m n d1..dn
                    if (i + 3 >= len) break;
                    int blen = data[i + 3];
                    if (i + 4 + (size_t)blen > len) { ESP_LOGW(TAG, "barcode truncated"); break; }
                    if (mtype == 73 && blen > 0) { // CODE128
                        EMIT(((draw_op_t){ .kind = OP_BARCODE, .barcode = {
                            .data = (const char *)&data[i + 4], .len = blen,
                            .height = bc_height, .module_w = bc_module, .hri = bc_hri } }));
                    } else {
                        ESP_LOGW(TAG, "barcode m=%u skipped", mtype);
                    }
                    i += 4 + (size_t)blen;
                } else {                 // NUL-terminated form (m<=6): skip to NUL
                    size_t j = i + 3;
                    while (j < len && data[j] != 0x00) j++;
                    ESP_LOGW(TAG, "NUL-form barcode m=%u skipped", mtype);
                    i = (j < len) ? j + 1 : len;
                }
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
git commit -m "feat(firmware): parse GS k Code128 + GS h/w/H barcode config"
```

---

### Task 4: Barcode fixture + scan verification

**Files:**
- Create: `tools/escpos-harness/make-barcode-fixture.js`

- [ ] **Step 1: Barcode fixture generator**

`tools/escpos-harness/make-barcode-fixture.js` — sets height/width/HRI then prints a Code128 of an order number, with a text caption (proves text + barcode compose):
```js
import { writeFileSync, mkdirSync } from "node:fs";

const code = process.argv[2] || "MARATUS-100423";
const data = Buffer.from(code, "latin1");

const b = [];
const push = (...xs) => xs.forEach((x) => b.push(typeof x === "string" ? Buffer.from(x, "latin1") : Buffer.from(x)));

push([0x1b, 0x40]);                 // ESC @
push([0x1b, 0x61, 0x01]);           // center
push("Order\n");
push([0x1d, 0x68, 0x50]);           // GS h 80  (height 80 dots)
push([0x1d, 0x77, 0x03]);           // GS w 3   (module width 3)
push([0x1d, 0x48, 0x02]);           // GS H 2   (HRI below)
// GS k 73 n d1..dn  (CODE128, length form)
push([0x1d, 0x6b, 0x49, data.length]); b.push(data);
push("\n", [0x1b, 0x4a, 0x40]);     // feed
push([0x1d, 0x56, 0x00]);           // cut

const job = Buffer.concat(b);
mkdirSync(new URL("./fixtures", import.meta.url), { recursive: true });
writeFileSync(new URL("./fixtures/barcode.escpos", import.meta.url), job);
console.log(`wrote fixtures/barcode.escpos (${job.length} bytes) encoding: ${code}`);
```
(`0x49` = 73 = Code128.)

- [ ] **Step 2: Generate + send (after flashing M4d firmware)**

```bash
cd /Users/eren/Projects/maratus-firmware && idf.py build && idf.py -p <PORT> flash monitor
cd tools/escpos-harness && node make-barcode-fixture.js && node send.js <device-ip> fixtures/barcode.escpos
```

- [ ] **Step 3: Verify**

Expected:
- Serial: `parsed N ops` (text "Order", a barcode op), `rendered <W>xH -> PNG …`, `receipt ready: …`.
- Screen: `Processing…` → QR (of the receipt URL).
- **Scan the screen QR** → the public receipt shows: centered "Order", a Code128 barcode, and "MARATUS-100423" in HRI digits beneath it.
- **Scan the barcode inside the receipt image** with a phone barcode app → it decodes to **`MARATUS-100423`**. This is the correctness gate: a correct symbol table + checksum produce a scannable code.
- Admin lists the receipt.

- [ ] **Step 4: Commit**

```bash
git add tools/escpos-harness/make-barcode-fixture.js
git commit -m "feat(firmware): Code128 barcode ESC/POS fixture"
```

---

## Self-Review

**Spec coverage (M4 barcode slice):**
- Code128-B encode (table + mod-103 checksum + start/stop) → Task 1 ✓
- `GS k` Code128 parsed; `GS h`/`GS w`/`GS H` captured (removed from skip table) → Task 3 ✓
- Bars rendered (scaled, quiet zone, aligned) + HRI digits below → Task 2 ✓
- Fixture + scan-decode verification → Task 4 ✓
- Reuses M4a–M4c canvas/PNG/upload + `font8x8` HRI ✓
- **Completes M4.** Out of scope (future): EAN/UPC/Code39, NUL-form `GS k`, HRI font.

**Placeholder scan:** No `TODO`/`TBD`. The Code128 table is the canonical published symbol set (labeled as such); it is real data, not a placeholder, and is validated by the Task 4 scan. All encoder/render/parser/fixture code is complete.

**Type/interface consistency:** `OP_BARCODE` + the `barcode` union member (Task 2 `draw_ops.h`) are emitted by the parser (Task 3) and consumed by `render_barcode` (Task 2). `code128b_encode(const char*, int, unsigned char*, int)` (Task 1) matches its call in `render_barcode`. `bc_height`/`bc_module`/`bc_hri` parser state maps to `.height`/`.module_w`/`.hri` and render clamps width 2–6 / height 16–400 consistently. The fixture's `GS k 73 n` framing (`0x1d 0x6b 0x49 len data`) matches the parser's length-prefixed branch (`mtype>=65` → `blen = data[i+3]`, data at `i+4`, advance `i += 4 + blen`). `GS h/w/H` removed from `gs_cmd_len` so they no longer double-skip. `blit_glyph`/`GLYPH_W`/`GLYPH_H`/`canvas_*`/`x_offset` reused from M4c (same file).

**Risk notes (not placeholders):**
- The Code128 symbol table is large; a transcription error → unscannable barcode. The Task 4 phone-scan is the explicit gate; if it fails to decode, the table (or the mod-103 checksum) is the first suspect, fixable in one file. Cross-check against any published Code128 width table.
- Only Code128-B + length-prefixed `GS k 73` are rendered; other symbologies/forms log-and-skip without desync (lengths handled).
- HRI uses the M4c `font8x8` at scale 1 — consistent with the text renderer; long codes may underrun the bar width visually but still scan.
