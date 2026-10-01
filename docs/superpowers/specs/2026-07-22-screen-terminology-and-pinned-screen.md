# Screen Terminology + Editable Pinned Screen + Styled QR (cloud side)

*2026-07-22 · approved in conversation. Firmware counterpart: maratus-firmware
`docs/superpowers/specs/2026-07-22-pinned-screen-styled-qr-firmware.md`.*

## A. printer → screen wording sweep
User-visible copy only (~16 sites: page descriptions, auth/marketing, admin).
"Printer in X" → "Screen in X"; "printers" → "screens"; etc.
**Frozen identifiers (do NOT rename):** `printer-layout.ts`, `PRINTER_SCREENS`,
`printerScreens`/`printerLayout`/`kiosk_*` DB columns, `PrinterPreview` component
names, `device.*` API fields. TR manuals deferred.

## B. Starbucks stored-config text refresh (one-off script, no code)
In Starbucks org's stored `printerScreens` JSON, replace texts that EXACTLY match
the six old defaults with the new neutral ones (Preparing your document…→Getting
things ready…; Scan to get your document→Scan to continue; Your document is on its
way→You're all set; We couldn't send your document→Something went wrong; Please ask
a team member for a paper document→Please ask a team member for help; Digital
documents are paused at this register.→This screen is paused right now.). Custom
texts untouched. Update bumps ETag → device repaints.

## C. Editable "Pinned" screen
- `PRINTER_SCREENS` gains `"pinned"` (8th screen). `seededScreen("pinned")` = QR
  screen minus countdown (heading "Scan to continue" + qr object + caption).
- `normalizePrinterConfig` already seeds missing screens at read time → no
  migration, stored configs gain the screen automatically.
- Branding studio: "Pinned" tab (label "Pinned"), preview = QR + no countdown.
- Config payload delivers `screens.pinned` automatically; ETag covers it.
- Old firmware ignores the extra screen (parser is per-known-screen) — harmless.

## D. Styled QR preview parity (cloud part)
Studio preview + device-pin-control card render QRs with rounded dot modules +
rounded finder patterns (SVG from `qrcode` lib's module matrix), matching the new
firmware render. No toggle; new look is the default everywhere.

## Testing
printer-layout tests: pinned in screen list, seeded shape (no countdown),
normalize seeds pinned for legacy configs. Full gates (vitest/tsc/lint/build).

## Out of scope
Identifier renames, TR manuals, per-screen QR-style toggle.
