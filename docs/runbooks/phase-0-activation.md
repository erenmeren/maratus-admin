# Phase 0 Activation Runbook

The Phase 0 features (Sentry error tracking, email verification) and the Stripe
billing loop are all **built and merged but inert** until their env vars are set.
This runbook is the click-by-click checklist to turn each one on. Nothing here
needs code changes — it's all accounts + config.

**Where env vars go:**
- **Local dev** → `.env.local` (copy missing keys from `.env.example`).
- **Production** → Vercel project `maratus-admin`. Either the dashboard
  (Settings → Environment Variables) or the CLI:
  `vercel env add <NAME> production` (paste the value when prompted).
  After changing production env vars, **redeploy** for them to take effect.

After editing `.env.local`, restart `npm run dev`. After editing Vercel env,
trigger a new deploy (see §3).

---

## 1. Sentry (error tracking) — no domain needed

1. Create a free account at https://sentry.io (no credit card).
2. **Create a project** → platform **Next.js**. Sentry shows you a **DSN**
   (looks like `https://<hash>@o<org>.ingest.sentry.io/<project>`).
3. Set these env vars (same DSN value for both):
   - `SENTRY_DSN` = the DSN (server/edge error capture)
   - `NEXT_PUBLIC_SENTRY_DSN` = the DSN (browser error capture)
   - `SENTRY_ENVIRONMENT` = `production` (or `development` locally)
   - Local: add to `.env.local`. Prod: add all three to Vercel.
4. **Verify:** with the DSN set, trigger an error and confirm it appears in
   Sentry's Issues. Easiest: temporarily throw in a server action, or hit an
   ingest path that fails. Captured events are auto-scrubbed — the device bearer
   key and `/r/<token>` receipt URLs are redacted (see `lib/observability.ts`
   `scrubSentryEvent`). Remove any test throw afterward.

> The SDK is a complete no-op when the DSN is unset, so leaving it blank is safe.
> Source-map upload (readable stack traces) and performance tracing are
> deferred — this ships errors-only.

---

## 2. Resend (email verification) — works without a domain (test mode)

Email verification (`requireEmailVerification`) only becomes real once email can
be delivered. Until then, company signup auto-verifies (so dev/seed never breaks).

> **CURRENT STATUS (re-verified 2026-07-01).** Resend is already ON in prod:
> `RESEND_API_KEY` is set on Vercel (a valid sending-scoped `re_…` key) and
> `EMAIL_FROM` is the onboarding default — so we are in **test mode (§2a)**, not
> production. Live-confirmed: send to `erenaltan@gmail.com` = 200; send to any
> other recipient = **403** ("You can only send testing emails to your own email
> address… verify a domain"). Consequence: **all Phase 3C customer-facing email**
> (document-me-this-document, magic-link recovery) and any tenant email to a
> non-`erenaltan@gmail.com` address will **not deliver** — `sendEmail` catches the
> 403, logs + reports to Sentry, and returns `false`, so nothing breaks; the mail
> just doesn't go out. **The only step left to reach real customers is §2b
> (verify a domain + set `EMAIL_FROM`).** No code changes needed.

### 2a. Test mode (no domain) — prove it works now
1. Create a free account at https://resend.com (no credit card).
2. **API Keys** → create a key (`re_...`).
3. Set env:
   - `RESEND_API_KEY` = the key
   - `EMAIL_FROM` = leave as the default `Maratus <onboarding@resend.dev>`
     (Resend's shared test sender — no domain required).
4. **Important limitation:** the test sender only delivers to **your own Resend
   account email**. So sign up with that exact email to receive the verification
   link. Other recipients silently won't get mail until §2b.
5. **Verify the flow:** sign up a new company at `/signup` with your Resend
   account email → you should be routed to the `/verify-email` "check your email"
   screen → the link arrives → clicking it signs you in and lands you at `/tenant`.

### 2b. Production (your own domain) — when you have one
1. Buy a domain; in Resend → **Domains** → add it and complete DNS verification
   (SPF/DKIM records at your DNS provider).
2. Set `EMAIL_FROM` = `Maratus <noreply@yourdomain.com>` (must match the verified
   domain) in Vercel, and redeploy.
3. Now verification + invite emails deliver to any recipient.

> `lib/email.ts` no-ops (logs to console) whenever `RESEND_API_KEY` is unset.
> The invite-signup path always auto-verifies (the invite email proves inbox
> ownership), so only the self-serve company signup gates on this key.

---

## 3. Vercel git auto-deploy (reconnect)

Auto-deploy on push to `main` was previously disconnected, so pushes don't ship
on their own.

1. Vercel dashboard → project **maratus-admin** → **Settings → Git**.
2. Confirm the connected repo is `erenmeren/maratus-admin` and the **Production
   Branch** is `main`. If the repo shows disconnected, **Connect Git Repository**.
3. Ensure "Automatically deploy" for the production branch is enabled.
4. **Verify:** push a trivial commit to `main` and confirm a new Production
   deployment starts in the Deployments tab.

> Until reconnected, deploy manually with `vercel --prod` from the repo root.
> (Past gotcha: the CLI has defaulted to Production even with `--target preview`;
> double-check the target in the deploy output.)

---

## 4. Stripe webhook (verify real delivery) — deferred but documented

Billing is proven in test mode except real Stripe→endpoint webhook delivery.
`STRIPE_WEBHOOK_SECRET` currently looks like a placeholder.

### Local (Stripe CLI)
1. `stripe login`
2. `stripe listen --forward-to localhost:3000/api/stripe/webhook`
3. Copy the `whsec_...` it prints into `.env.local` as `STRIPE_WEBHOOK_SECRET`,
   restart `npm run dev`.
4. Trigger events (`stripe trigger invoice.paid`, etc.) and confirm the webhook
   handler mirrors invoice/subscription state into the DB.

### Production (dashboard endpoint)
1. Stripe dashboard → **Developers → Webhooks → Add endpoint**:
   `https://<your-prod-url>/api/stripe/webhook`.
2. Subscribe to the events the handler cares about (invoice + subscription
   lifecycle; see `app/api/stripe/webhook/route.ts`).
3. Copy the endpoint's **Signing secret** (`whsec_...`) into Vercel as
   `STRIPE_WEBHOOK_SECRET`, redeploy.
4. **Verify:** "Send test event" from the dashboard → confirm a 2xx and the DB
   mirror update.

---

## Quick status checklist

- [ ] Sentry: `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_ENVIRONMENT` set; test error visible
- [ ] Resend: `RESEND_API_KEY` set; `/signup` → `/verify-email` → link → `/tenant` works
- [ ] (later) `EMAIL_FROM` switched to a verified domain
- [ ] Vercel: auto-deploy on `main` reconnected; test push deploys
- [ ] (deferred) Stripe `STRIPE_WEBHOOK_SECRET` real; test event mirrors to DB
