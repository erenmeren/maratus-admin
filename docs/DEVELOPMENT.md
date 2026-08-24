# Maratus — Development Guide

> Looking for what Maratus *is*? See the product overview in the
> [README](../README.md). This guide covers setup, architecture, and
> internals for developers.

Multi-tenant admin console for **Maratus**, a trigger-to-screen SaaS. Stores install
printer devices that replace paper documents with a QR code customers scan. Maratus
no longer ingests or hosts document content — a caller triggers a device over the
API and passes a URL to content it hosts itself; the device renders that URL as a
QR. This repo is the admin console plus the device-facing trigger/command API —
backed by a real database, auth, object storage, and subscription billing.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict), `@/*` → repo root
- **Tailwind v4** + **shadcn/ui** (style `radix-nova`) + **lucide-react**
- **recharts** charts · **next-themes** light/dark
- **Neon** (serverless Postgres) + **Drizzle ORM** over `neon-http`
- **Better Auth** (email/password + organization plugin) — `organization = tenant`
- **Cloudflare R2** (S3-compatible) for private object storage (tenant branding
  assets, firmware binaries)
- **Resend** (transactional email) · **Sentry** (optional observability)

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
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_ENVIRONMENT` | Error tracking (optional) |
| `CRON_SECRET` | Shared secret authenticating scheduled `/api/cron/*` calls |

### Seed accounts (`npm run db:seed`)

- **Platform admin:** `admin@maratus.co` / `123456`
- **Tenant owner:** `dana@roastwell.co` / `123456`
- Org "Roastwell Coffee": 3 stores, 6 claimed devices (mixed status, all
  subscribed/paid), 3 unclaimed devices (with pairing codes, ready to claim in
  the UI).

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
  and billing (subscription). Scoped to the user's active organization.
- **Super Admin** (`/admin/*`) — Maratus staff (`user.role = 'platform_admin'`) see
  across all customers: overview, customers, the global device fleet, factory
  **inventory** (manufacturing registry, `/admin/inventory`), firmware releases,
  platform health, and billing (a read-only invoice overview across all orgs;
  payments are recorded on the customer page).

Key seams:

- **`lib/data.ts`** — the single data layer. Tenant-panel functions take an
  `organizationId`; super-admin functions span all orgs. All DB→view-model
  conversions (cents→dollars, `lastSeenAt`→ISO, status derivation, activation
  time-series, billing/usage rollups) happen here.
- **`lib/session.ts`** — `getContext()`, `requireTenant()`, `requirePlatformAdmin()`.
  Route-group layouts call these to gate access. `middleware.ts` is an optimistic
  cookie check at the edge; real role checks run in the layouts.
- **`lib/db/schema.ts`** — Better Auth tables + org plugin + app tables (all FK →
  `organizationId`): `tenantSettings` (incl. `archivedAt`/`archivedNote` for the
  customer-archive lifecycle), `store`, `device` (incl. `serial`), `deviceCommand`,
  `firmwareRelease`, `apiKey`, `invoice`, `factoryDevice`
  (the manufacturing registry, keyed by eFuse-MAC serial), plus infra tables
  (`apiIdempotency`, `rateLimit`, `auditLog`, `alert`). `organization = tenant`;
  platform admin is a user role, not a membership. Money is stored in integer
  **cents**; subscriptions are the sole payment path (see Billing below).
- **Server actions** (`lib/actions/*`, route-local `actions.ts`) authorize, mutate
  via Drizzle, record an audit entry (`lib/audit.ts`, best-effort), then
  `revalidatePath`. Pure, IO-free logic is split into testable modules
  (`device-status`, `health`, `invoicing`, `subscription-gate`, `device-slots`, …)
  with colocated `*.test.ts` (vitest).

## Device → trigger → QR flow

Trigger-only model: Maratus never sees the document content — the caller hosts it and
passes a URL.

1. **Provision** — a platform admin creates a device with a one-time pairing code.
2. **Claim** — a tenant claims it into a store (`claimDevice`), which issues a
   device key (raw key shown **once**; only its SHA-256 hash is stored) and
   consumes the pairing code. A device also self-claims by polling
   `GET /api/device/claim?code=…&serial=…` on its setup screen; if its serial was
   pre-allocated in the factory registry (see below), it **auto-claims zero-touch**
   on first contact — no code entry.
3. **Trigger** — `POST /api/v1/devices/{deviceId}/trigger`, authenticated by an
   API key with the `devices:trigger` scope plus a required `Idempotency-Key`
   header. Body `{ action: "show_qr", payload: { url } }`. The route checks device
   ownership/online status and the **subscription gate**
   (`lib/subscription-gate.ts` — a paid device always passes; an unpaid device
   gets 50 lifetime trial triggers, then `403 device_not_subscribed`), and
   enqueues a `deviceCommand` row (`type: "trigger"`, `status: "pending"`).
4. **Publish, render, ack** — the trigger route publishes a `trigger` command
   on the device's MQTT `d/{deviceId}/cmd` topic (device-key auth against the
   broker, not HTTP). The device renders a QR from `payload.url`, then
   publishes `{ commandId, ok }` to `d/{deviceId}/ack`. A publish that fails
   fails closed — the command and idempotency claim unwind and the caller gets
   `503`. Nothing in the request path blocks on quota; overage past the pooled
   monthly allowance is billed after the fact (see Billing below).

Org-wide device policy (brightness / sleep / QR duration / PIN) and the
firmware manifest ride the same MQTT `cmd` topic as payload-carrying
`config-changed` / `firmware-update` commands — pushed on save and rebuilt
fresh on every publish, since they embed short-lived presigned R2 URLs. A
device asks for its config once per MQTT connection by publishing `{}` to
`d/{deviceId}/cfg/get`; it never polls on a timer. See
[`device-protocol.md`](device-protocol.md) and the machine-readable API spec
at `GET /api/v1/openapi.json`.

## Factory registry & zero-touch provisioning

For manufacturing scale, every printer is tracked in `factoryDevice`, keyed by its
immutable **eFuse-MAC serial** (12 lowercase hex — public, printed on the box;
**never** a credential). Platform admins manage it at `/admin/inventory`: import a
batch by CSV, allocate serials to a customer (+store), mark RMA, or reprint a
label QR. Lifecycle `manufactured → allocated → claimed` (+`rma`/`retired`). When
an **allocated** serial (with both org and store) first polls the claim endpoint,
it auto-claims zero-touch and mints its key in one shot — the installer only
connects Wi-Fi. A `claimed` serial never re-mints a key (hijack guard); the claim
endpoint validates the code before any DB hit and is rate-limited per-code and
per-IP. `lib/factory-registry.ts` holds the transactional registry operations;
`lib/provisioning.ts` holds the pure decision logic. Recovery from a mis-claim is
documented in [`runbooks/factory-registry-hijack-recovery.md`](runbooks/factory-registry-hijack-recovery.md).

## Customer lifecycle (offboarding & archive)

Customers are never hard-deleted — "deleting" a churned customer **archives** it
(`tenantSettings.archivedAt`), a reversible soft-delete that keeps all billing and
audit history. The admin offboard wizard (customer detail → danger zone) decides
each device's fate (return to stock → device row deleted + its registry serial
reverted to `manufactured`, re-allocatable; or leave with customer → device paused
+ serial `retired`), sweeps still-allocated serials, revokes API keys, cancels
pending invitations, and stamps `archivedAt` last (so
the flow is idempotently re-runnable). `requireTenant` gates archived orgs out of
the tenant panel; `lib/data.ts` excludes them from KPIs/lists by default; a
server-side `isOrgArchived` guard blocks admin mutations. **Restore** un-archives
(it does not undo device dispositions or key revocations). See
`lib/actions/offboarding.ts`.

## Billing (subscription)

Subscriptions are the **only** payment path: **$15/device/month, billed annually**
($180/year up front) by **bank transfer** — there is no payment gateway. Billing
periods are anniversary-based, anchored by `tenantSettings.subscriptionStartedAt`.
Included quota derives from **slots, not live devices**:
`tenantSettings.paidDeviceSlots` is what the org paid for, written only when an
invoice is marked paid — an RMA'd or removed device frees its slot
(`lib/device-slots.ts`) without shrinking the entitlement until renewal, and a
replacement device claims into the vacancy for free. Each paid slot includes
**1,000 triggers/month**, pooled at the org; usage past the pool is post-paid
overage at **$0.02/trigger** and never blocks a request. An unpaid device gets 50
lifetime trial triggers. The daily `GET /api/cron/billing` sweep
(`lib/billing-cron.ts`) issues subscription and overage invoices with net-14
terms; a platform admin records payment (`markInvoicePaid` in `lib/invoices.ts`,
from the customer page), and *that* is what activates a subscription.

## Testing

```bash
npm test
```

Pure domain logic is unit-tested with vitest (`lib/**/*.test.ts`, 540 tests) —
device status derivation, health alerts, invoicing/billing and device-slot
logic, API-key scopes, OpenAPI/serialization, audit labels, rate limiting,
trigger actions, provisioning + factory-registry decision logic, offboarding
helpers, printer layout/geometry, timezones, and member-role rules.
