# Maratus Cutover Runbook (rename: Ditto → Maratus)

Code rename plan: docs/superpowers/plans/2026-08-24-maratus-rename.md
Decision record: docs/naming-candidates.md (top block)
Domains owned: maratus.co (primary), maratus.dev (future developer docs — park for now)

## Order of operations

1. **Deploy the rename commits** (Tasks 1–6) to Vercel prod — safe before DNS;
   everything keeps working on the existing *.vercel.app URL.
2. **DNS + Vercel domain**
   - Vercel dashboard → project `ditto-admin` (internal name stays!) → Domains →
     add `maratus.co` and `www.maratus.co` (www → apex redirect).
   - At the registrar, point maratus.co per Vercel's instructions
     (A 76.76.21.21 or the CNAME it shows). Wait for the domain to show Valid.
3. **Auth origin**: Vercel env (Production) `BETTER_AUTH_URL=https://maratus.co`,
   then redeploy. `lib/auth.ts` trustedOrigins picks it up via env; `*.vercel.app`
   stays trusted — do NOT remove it.
4. **Local env**: update `.env.local` `BETTER_AUTH_URL` the same way
   (⚠️ .env.local points at PROD — touch only this var).
5. **Resend (closes the standing e-mail blocker)**
   - Resend dashboard → Domains → add `maratus.co`; create the DKIM/SPF DNS
     records at the registrar; wait for Verified.
   - Vercel env: `EMAIL_FROM=Maratus <noreply@maratus.co>`; redeploy.
   - /admin integration status should now show e-mail domain verified;
     customer-facing mail (invoices, offline alerts, invites) starts flowing.
6. **Verify**: log in at https://maratus.co; run one end-to-end trigger against a
   test device; check invite e-mail renders "Maratus" and arrives from
   noreply@maratus.co.

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
https://maratus.co → ship as an OTA release → only after the fleet converges
may the old URL ever be retired (in practice: never retire it; it costs nothing).
