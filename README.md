# Ditto — Admin Console

Multi-tenant admin console for **Ditto**, a digital-receipt SaaS. Stores install
kiosk devices that replace paper receipts with a QR code customers scan to
download a digital receipt. This repo is the admin console plus the device-facing
ingest/command API — backed by a real database, auth, object storage, and billing.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict), `@/*` → repo root
- **Tailwind v4** + **shadcn/ui** (style `radix-nova`) + **lucide-react**
- **recharts** charts · **next-themes** light/dark
- **Neon** (serverless Postgres) + **Drizzle ORM** over `neon-http`
- **Better Auth** (email/password + organization plugin) — `organization = tenant`
- **Cloudflare R2** (S3-compatible) for private receipt + logo storage
- **Stripe** (metered billing) · **Resend** (transactional email)

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
| `BETTER_AUTH_URL` | App base URL; also the prefix of public receipt links |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Cloudflare R2 |
| `RESEND_API_KEY` | Transactional email (optional — absent → emails are logged, not sent) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` | Stripe billing (optional — absent → billing features are inert) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe.js publishable key |

### Seed accounts (`npm run db:seed`)

- **Platform admin:** `admin@ditto.app` / `password123`
- **Tenant owner:** `dana@roastwell.co` / `password123`
- Org "Roastwell Coffee": 3 stores, 6 devices (mixed status), ~30 receipts, 2 invoices, 3 unclaimed devices.

## Commands

```bash
npm run dev          # next dev
npm run build        # next build (webpack)
npm test             # vitest run
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
  branding, members, receipts, reports, and billing. Scoped to the user's active
  organization.
- **Super Admin** (`/admin/*`) — Ditto staff (`user.role = 'platform_admin'`) see
  across all customers: overview, customers, the global device fleet, platform
  health, receipts, and billing/revenue.

Key seams:

- **`lib/data.ts`** — the single data layer. Tenant-panel functions take an
  `organizationId`; super-admin functions span all orgs. All DB→view-model
  conversions (cents→dollars, `lastSeenAt`→ISO, status derivation, receipt
  counts/series) happen here.
- **`lib/session.ts`** — `getContext()`, `requireTenant()`, `requirePlatformAdmin()`.
  Route-group layouts call these to gate access. `middleware.ts` is an optimistic
  cookie check at the edge; real role checks run in the layouts.
- **`lib/db/schema.ts`** — Better Auth tables + org plugin + app tables (all FK →
  `organizationId`). `organization = tenant`; platform admin is a user role, not a
  membership. Money is stored in integer **cents**.
- **Server actions** (`lib/actions/*`, route-local `actions.ts`) authorize, mutate
  via Drizzle, record an audit entry (`lib/audit.ts`, best-effort), then
  `revalidatePath`. Pure, IO-free logic is split into testable modules
  (`device-status`, `health`, `billing-status`, `receipts-search`, …) with
  colocated `*.test.ts` (vitest).

## Device → ingest → receipt flow

1. **Provision** — a platform admin creates a device with a one-time pairing code.
2. **Claim** — a tenant claims it into a store (`claimDevice`), which issues a
   device key (raw key shown **once**; only its SHA-256 hash is stored).
3. **Ingest** — `POST /api/ingest`, authenticated by `Authorization: Bearer
   <deviceKey>` (not a user session). Stores the rendered image in R2, inserts a
   `receipt` row with a 40-char capability token, reports metered usage to Stripe,
   and returns `{ token, url }` for the kiosk to render as a QR.
4. **Public receipt** — `/r/[token]` (no auth, the **token is the capability**).
   Renders the image via a fresh 5-minute presigned R2 URL; first view flips the
   receipt `ready → downloaded`.

Devices also poll `GET /api/device/commands` for remote commands (reboot / refresh
/ identify) and acknowledge via `/api/device/commands/ack`. See
[`docs/device-protocol.md`](docs/device-protocol.md).

## Testing

```bash
npm test
```

Pure domain logic is unit-tested with vitest (`lib/**/*.test.ts`) — status
derivation, health alerts, Stripe status mapping, receipt-filter parsing, rate
limiting, ingest validation, and member-role rules.
