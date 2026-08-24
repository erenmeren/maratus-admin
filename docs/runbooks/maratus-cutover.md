# Maratus Cutover Runbook (rename: Ditto → Maratus)

Code rename plan: docs/superpowers/plans/2026-08-24-maratus-rename.md
Decision record: docs/naming-candidates.md (top block)

**Actual topology (as cut over, 2026-08-24 — differs from the original plan):**
- `maratus.co` (apex + www) = marketing landing on **GitHub Pages** (Cloudflare DNS,
  A → 185.199.108-111.153). NOT the app.
- **`api.maratus.co` = the admin app** (CNAME → cname.vercel-dns.com, attached to
  Vercel project `ditto-admin`). `BETTER_AUTH_URL=https://api.maratus.co`.
- `maratus.dev` = future developer docs — parked.
- DNS lives at **Cloudflare** (gordon/lucy.ns.cloudflare.com), not Vercel DNS.

## Order of operations

1. ✅ **Deploy the rename commits** — DONE 2026-08-24 (merge 81e097d deployed;
   api.maratus.co serves "Maratus — Admin Console"; old *.vercel.app URLs still live).
2. ✅ **DNS + Vercel domain** — DONE (operator): api.maratus.co attached + Valid;
   apex deliberately on GitHub Pages.
3. ✅ **Auth origin** — DONE 2026-08-24: Vercel Production env
   `BETTER_AUTH_URL=https://api.maratus.co` (was previously UNSET → invite links
   had defaulted to localhost), redeployed. `*.vercel.app` stays trusted.
4. ✅ **Local env** — `.env.local` keeps `BETTER_AUTH_URL="http://localhost:3000"`
   (correct for dev; the original step assumed it held a prod URL — it doesn't).
5. ✅ **Resend — DONE 2026-08-24, e-mail blocker CLOSED:**
   - `maratus.co` registered in Resend (id c2d58ff7-18ea-4e3b-b884-95c262947665,
     region us-east-1); `RESEND_API_KEY` was already in Vercel Production.
   - DKIM TXT (`resend._domainkey`), SPF MX + TXT (`send`) created in Cloudflare
     via API (DNS-only); domain **verified** ~3.5 min later (all 3 records).
   - Vercel Production env `EMAIL_FROM=Maratus <noreply@maratus.co>` set,
     redeployed (READY). Customer-facing mail (invoices, offline alerts,
     invites) is now able to flow from noreply@maratus.co.
6. ⏳ **Verify**: ✅ login page + Better Auth endpoint 200 on https://api.maratus.co;
   ✅ old bootstrap URL still serving (ditto-admin-brown.vercel.app 200, claim route
   alive). REMAINING: one end-to-end trigger against a test device; send one real
   invite/e-mail and confirm it arrives from noreply@maratus.co with Maratus
   branding.

## Do NOT do

- Do NOT rename the Vercel project or delete/detach the old *.vercel.app domains:
  the device fleet's firmware has the old base URL baked in for the two HTTPS
  bootstrap routes (GET /api/device/claim, GET /api/device/identity). The old URL
  must keep serving until the firmware fleet is migrated and converged.
- Do NOT rename the R2 bucket (`ditto-receipts`) — R2 has no rename; nothing
  user-visible leaks it.
- Do NOT run db:seed against prod.

## Optional / follow-ups

- Prod platform-admin login is still the old seed e-mail (admin@ditto.app).
  Either keep it, or update the user row's e-mail to admin@maratus.co manually
  (Drizzle Studio) — the login page demo hint now shows admin@maratus.co.
- GitHub/local repo directory renames (ditto-admin → maratus-admin,
  ditto-firmware → maratus-firmware): defer; breaks local paths, Vercel link
  and memory-dir naming. Do both in one sitting later if desired.
- Turkish manual PDFs: regenerate via make-pdf next time manuals ship.
- maratus.dev: park or redirect to maratus.co until a docs site exists.

## Firmware follow-up (separate plan, ditto-firmware repo)

User-visible "Ditto" strings live in firmware too ("Contacting Ditto..." boot
stage, Kconfig menu names) and the prod build's base URL points at the old
domain. Plan separately: restring UI copy → point DITTO_API_BASE_URL at
https://api.maratus.co → ship as an OTA release → only after the fleet converges
may the old URL ever be retired (in practice: never retire it; it costs nothing).
