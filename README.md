# Ditto — Admin Console

Multi-tenant admin console for **Ditto**, a digital-document SaaS. Stores install
printer devices that replace paper documents with a QR code customers scan. Ditto
no longer ingests or hosts document content — a caller triggers a device over the
API and passes a URL to content it hosts itself; the device renders that URL as a
QR. This repo is the admin console plus the device-facing trigger/command API —
backed by a real database, auth, object storage, and prepaid-credit billing.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict), `@/*` → repo root
- **Tailwind v4** + **shadcn/ui** (style `radix-nova`) + **lucide-react**
- **recharts** charts · **next-themes** light/dark
- **Neon** (serverless Postgres) + **Drizzle ORM** over `neon-http`
- **Better Auth** (email/password + organization plugin) — `organization = tenant`
- **Cloudflare R2** (S3-compatible) for private object storage (tenant branding
  assets, firmware binaries)
- **Stripe** (prepaid credit-pack top-ups) · **Resend** (transactional email) ·
  **Sentry** (optional observability)

> One emerald `--primary` token drives the app chrome. A store's own brand color
> is **data**, shown only inside the tenant Branding screen — never in the chrome.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run db:migrate           # apply Drizzle migrations to Neon
npm run db:seed              # seed sample data (idempotent)
npm run dev                  # http://localhost:3000
```

### Environment (`.env.local`, validated by `lib/env.ts`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `BETTER_AUTH_SECRET` | Better Auth signing secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | App base URL |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Cloudflare R2 object storage |
| `RESEND_API_KEY` / `EMAIL_FROM` | Transactional email (optional — absent → emails are logged, not sent) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe credit-pack checkout (optional — absent → billing is inert) |
| `STRIPE_CREDIT_PACK_PRICE_IDS` | Comma-separated Stripe price IDs offered as credit packs |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_ENVIRONMENT` | Error tracking (optional) |
| `CRON_SECRET` | Shared secret authenticating scheduled `/api/cron/*` calls |

### Seed accounts (`npm run db:seed`)

- **Platform admin:** `admin@ditto.app` / `123456`
- **Tenant owner:** `dana@roastwell.co` / `123456`
- Org "Roastwell Coffee": 3 stores, 6 claimed devices (mixed status), 3 unclaimed
  devices (with pairing codes, ready to claim in the UI), and a starter grant of
  prepaid credits.

## Commands

```bash
npm run dev          # next dev
npm run build        # next build (webpack)
npm test             # vitest run
npm run test:watch   # vitest (watch)
npm run db:generate  # drizzle-kit generate (SQL from lib/db/schema.ts)
npm run db:migrate   # apply migrations to Neon
npm run db:push      # push schema without a migration file
npm run db:studio    # Drizzle Studio
npm run db:seed      # seed sample data (idempotent)
npm run auth:generate # regenerate Better Auth tables (parity check)
```

## Architecture

Two access tiers behind one app shell:

- **Tenant workspace** (`/tenant/*`) — a store chain manages its stores, devices,
  branding, device settings, members, analytics, reports, activity (audit log),
  and billing (prepaid credits). Scoped to the user's active organization.
- **Super Admin** (`/admin/*`) — Ditto staff (`user.role = 'platform_admin'`) see
  across all customers: overview, customers, the global device fleet, firmware
  releases, platform health, and billing (credit usage across all orgs).

Key seams:

- **`lib/data.ts`** — the single data layer. Tenant-panel functions take an
  `organizationId`; super-admin functions span all orgs. All DB→view-model
  conversions (cents→dollars, `lastSeenAt`→ISO, status derivation, activation
  time-series, credit ledger/usage rollups) happen here.
- **`lib/session.ts`** — `getContext()`, `requireTenant()`, `requirePlatformAdmin()`.
  Route-group layouts call these to gate access. `middleware.ts` is an optimistic
  cookie check at the edge; real role checks run in the layouts.
- **`lib/db/schema.ts`** — Better Auth tables + org plugin + app tables (all FK →
  `organizationId`): `tenantSettings`, `store`, `device`, `deviceCommand`,
  `firmwareRelease`, `apiKey`, `creditBalance`, `creditLedger`, plus infra tables
  (`apiIdempotency`, `rateLimit`, `auditLog`, `alert`). `organization = tenant`;
  platform admin is a user role, not a membership. Money is stored in integer
  **cents**; prepaid credits are the sole payment path.
- **Server actions** (`lib/actions/*`, route-local `actions.ts`) authorize, mutate
  via Drizzle, record an audit entry (`lib/audit.ts`, best-effort), then
  `revalidatePath`. Pure, IO-free logic is split into testable modules
  (`device-status`, `health`, `credit-usage`, `credits-overview`, …) with
  colocated `*.test.ts` (vitest).

## Device → trigger → QR flow

Trigger-only model: Ditto never sees the document content — the caller hosts it and
passes a URL.

1. **Provision** — a platform admin creates a device with a one-time pairing code.
2. **Claim** — a tenant claims it into a store (`claimDevice`), which issues a
   device key (raw key shown **once**; only its SHA-256 hash is stored) and
   consumes the pairing code.
3. **Trigger** — `POST /api/v1/devices/{deviceId}/trigger`, authenticated by an
   API key with the `devices:trigger` scope plus a required `Idempotency-Key`
   header. Body `{ action: "show_qr", payload: { url } }`. The route checks device
   ownership/online status, **reserves 1 credit** (`lib/credits.ts`), and enqueues
   a `deviceCommand` row (`type: "trigger"`, `status: "pending"`).
4. **Poll + render + ack** — the device polls `GET /api/device/commands`
   (device-key auth) for pending commands, renders a QR from `payload.url`, then
   `POST /api/device/commands/ack` with `{ commandId, ok }`. A success ack settles
   the reserved credit; a failure or expiry releases it.

Devices also poll `GET /api/device/config` for org-wide device policy
(brightness / sleep / QR duration / PIN) and pull firmware from
`GET /api/device/firmware`. See [`docs/device-protocol.md`](docs/device-protocol.md)
and the machine-readable API spec at `GET /api/v1/openapi.json`.

## Billing (prepaid credits)

Credits are the **only** payment path — there is no per-print invoicing or metered
subscription. Each successful device trigger consumes one credit
(reserve → settle on ack, release on failure/expiry). New orgs receive a starter
grant on signup. Tenants top up by buying credit packs via Stripe Checkout
(`STRIPE_CREDIT_PACK_PRICE_IDS`); the `/api/stripe/webhook` route grants credits on
a completed purchase. The `creditLedger` table is the append-only source of truth;
`creditBalance` is the running total.

## Testing

```bash
npm test
```

Pure domain logic is unit-tested with vitest (`lib/**/*.test.ts`, ~32 suites) —
device status derivation, health alerts, credit usage/overview rollups, API-key
scopes, OpenAPI/serialization, audit labels, rate limiting, trigger actions,
provisioning, printer layout/geometry, timezones, and member-role rules.
