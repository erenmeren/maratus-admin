@AGENTS.md

# Ditto Admin

Multi-tenant admin console for **Ditto**, a trigger-to-screen SaaS. In-store
devices show a QR code on demand; customers scan it to open whatever content
the caller chose to show (trigger-only model — Ditto hosts nothing).

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript (strict), `@/*` → repo root
- **Tailwind v4** + **shadcn/ui** (style `radix-nova` — see Gotchas) + lucide-react
- **recharts** charts · **next-themes** light/dark
- **Neon** (serverless Postgres) + **Drizzle ORM** over `neon-http`
- **Better Auth** (email/password + organization plugin) — `organization = tenant`
- **Cloudflare R2** (S3-compatible) for private object storage (tenant branding
  assets, firmware binaries)

## Commands

```bash
npm run dev          # next dev (http://localhost:3000)
npm run build        # next build
npm run db:generate  # drizzle-kit generate (SQL from lib/db/schema.ts)
npm run db:migrate   # apply migrations to Neon
npm run db:push      # push schema without a migration file
npm run db:studio    # Drizzle Studio
npm run db:seed      # seed sample data (idempotent)
npm run auth:generate # regenerate Better Auth tables → lib/db/auth-schema.generated.ts (parity check)
```

## Environment (`.env.local`, validated by `lib/env.ts`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `BETTER_AUTH_SECRET` | Better Auth signing secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | App base URL |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Cloudflare R2 |

`.env.example` is the committed template. CLI scripts (seed, drizzle.config) load
env via `lib/db/load-env.ts` — **import it FIRST**, before any module that reads
env at load time (ESM imports are hoisted, so an inline `dotenv` call runs too late).

## Data model (`lib/db/schema.ts`)

Better Auth core: `user` (+`role`), `session` (+`activeOrganizationId`), `account`,
`verification`. Org plugin: `organization`, `member`, `invitation`.
App tables (all FK → `organizationId`): `tenantSettings` (PK=orgId), `store`,
`device`, `deviceCommand`, `apiKey`, `invoice`, `firmwareRelease`,
`factoryDevice`, `auditLog`, `alert`. Relations in `lib/db/relations.ts`.
`creditBalance`, `creditLedger`, and `deviceUsageMonth` are still defined in
the schema but dead code — nothing in the app reads or writes them anymore
(see Billing below). They stay until the operator runs the deferred
destructive migration described in
`docs/runbooks/subscription-billing-cutover.md`; don't build new code against
them.

- **`organization` = tenant.** Tenant roles (owner/admin/member) live on `member`.
- **Platform/super-admin is NOT an org membership** — it's `user.role =
  'platform_admin'` (Better Auth `additionalFields`, `input:false`).
- **Money is stored in integer cents** (`perPrintPriceCents`, `unitPriceCents`,
  `amountDueCents`); the data layer converts to dollars for the UI.
- Indexes: `device.pairingCode` (unique),
  `device.deviceKeyHash`, every `organizationId`.

## Architecture

- **`lib/data.ts`** — the single data seam. Same function names/return types the
  UI always used; bodies are real Drizzle queries. Tenant-panel fns take
  `organizationId` (active tenant); super-admin fns span all orgs. DB→view-model
  conversions (cents→dollars, `lastSeenAt`→ISO `lastSeen`, status mapping,
  activation counts/series derived from acked trigger commands) all happen here.
- **`lib/session.ts`** — `getContext()`, `requireTenant()`, `requirePlatformAdmin()`.
  Route-group layouts call these to gate access and pass session/org data to `AppShell`.
- **`middleware.ts`** — optimistic cookie gate on `/admin` + `/tenant` → `/login`.
  Fine-grained role checks run in the layouts (DB available there).
- **Layout & spacing (dashboard pages).** Every `/admin` + `/tenant` page returns
  a fragment and inherits the shell's container — never re-pad a page. Chrome comes
  from three primitives: `PageHeader` (one page title; supports `backHref`/`leading`/
  `badge`/node `description`), `SectionHeader` (one section title), and `PageSection`
  (standalone non-Card section, `space-y-3`). Rhythm: page container `max-w-7xl` +
  `p-4 sm:p-6 lg:p-8` and `space-y-6` between top-level blocks are owned by
  `AppShell`; section heading→body is `space-y-3`; metric grids `gap-4`; major
  column splits `gap-6`. Type: h1 `font-display text-2xl font-bold`, h2 `text-lg
  font-medium`, description `text-sm text-muted-foreground`.
  **Full-bleed exception:** routes listed in `FULL_BLEED_ROUTES`
  (`components/app-shell.tsx`) opt out of that container — no `max-w-7xl`, no
  `space-y-6`, and only a small `px-4 pt-4` inset (bottom flush) instead of the
  standard padding — so they render nearly edge-to-edge. `/tenant/branding` is
  the only one: it is an immersive canvas editor whose dark stage carries its own
  header and save chrome, so the gutters and the 1280px cap only shrank the
  workspace. Such a page owns its own insets and skips `PageHeader`. This is
  deliberate — don't "fix" it back. Everything else keeps the rhythm above.
- **Auth route**: `app/api/auth/[...all]/route.ts` via `toNextJsHandler`.
  Client: `lib/auth-client.ts` (`authClient`, organization plugin).
- `next.config.ts` sets `serverExternalPackages: ["better-auth",
  "@better-auth/kysely-adapter"]` — without it the auth route 500s on a
  bun:sqlite dialect bundling error.

## Device trigger flow (trigger-only model)

Ditto no longer ingests or hosts documents — customers host their own content
and pass a URL. The only device-activation path is the trigger API:

1. **Provision**: a device is seeded/created with a one-time `pairingCode`.
   `claimDevice(pairingCode, storeId)` (`lib/device-claim.ts`) binds it to a store,
   issues a device key (raw key returned **once**; only its SHA-256 hash is
   stored), consumes the pairing code, sets `claimedAt`.
2. **Trigger**: an authenticated caller (API key with the `devices:trigger`
   scope, plus a required `Idempotency-Key` header) does
   `POST /api/v1/devices/{deviceId}/trigger` with body
   `{ action: "show_qr", payload: { url } }` — `url` points at content the
   caller hosts themselves. `app/api/v1/devices/[deviceId]/trigger/route.ts`
   checks device ownership/online status, then checks the subscription gate
   (`lib/subscription-gate.ts` `checkSubscriptionGate`): a paid device
   (`device.subscriptionPaidAt` set) always passes; an unpaid device gets 50
   lifetime trial triggers, then `403 device_not_subscribed`. Nothing in the
   request path blocks on quota — overage is billed after the fact (see
   Billing below). It then enqueues a `deviceCommand` row (`type: "trigger"`,
   `status: "pending"`), and publishes it to the device's MQTT `cmd` topic
   (`lib/mqtt.ts` `publishCommand`). MQTT is the only transport — there is no
   fallback — so a failed publish fails the request closed: the command is
   marked `failed`, the idempotency claim is released, and the caller gets
   `503 transport_unavailable`. A deployment with no EMQX env group at all is
   rejected earlier — before enqueueing anything — with a distinct
   `503 transport_unconfigured`, since that one cannot succeed on retry.
3. **Deliver + render + ack**: the device is subscribed to `d/{deviceId}/cmd`,
   renders a QR from `payload.url`, and publishes an ack on `d/{deviceId}/ack`.
   EMQX's Data-Integration webhook forwards it to `POST /api/mqtt/ack`, which
   records the terminal `status` (`acked`/`failed`) and `ackedAt` on the
   `deviceCommand` row — there is no credit to settle or release anymore.

**Device transport, in full.** MQTT (EMQX) carries commands, acks, heartbeat,
presence, config and the OTA manifest — see `docs/runbooks/emqx-setup.md` for
the broker setup and `lib/mqtt.ts` / `lib/mqtt-push.ts` for the publish seam.
Config and the OTA manifest ride the device's existing `cmd` topic as
payload-carrying `config-changed` / `firmware-update` commands; both are built
fresh at publish time and never persisted on the command row, because they
embed short-lived presigned R2 URLs. Config pushes are not version-gated —
every claimed device gets the full config on every push. The device asks for
its config once per MQTT connection by publishing to `d/{deviceId}/cfg/get`;
it never polls on a timer. HTTPS survives only for two device-bootstrap
routes — `GET /api/device/claim` (unauthenticated, one-time device-key
delivery) and `GET /api/device/identity` (device-key auth; the one thing a
device can't learn over MQTT before it can even connect — its own id and the
broker's coordinates) — plus R2 asset fetches and the OTA binary download. Full
design: `docs/superpowers/specs/2026-07-29-mqtt-only-device-transport-design.md`.

## Billing (subscription, `lib/invoicing.ts` / `lib/invoices.ts` / `lib/billing-cron.ts`)

Subscriptions replaced prepaid credits. Per device: **$15/month, billed
annually** ($180/year up front), paid by **bank transfer** — there is no
payment gateway integration. Billing periods are **anniversary-based**, not
calendar months: `tenantSettings.subscriptionStartedAt` anchors the org's
12-month cycle, advanced by `addMonthsAnchored` each time a renewal invoice is
paid. Each **paid** device includes **1,000 triggers/month**, pooled at the
org (not per-device); usage past the pool is **post-paid overage at
$0.02/trigger** — overage never blocks a request, it only shows up on the
next invoice. An unpaid device gets 50 lifetime trial triggers before the
trigger route starts rejecting it (see Device trigger flow above). Pin
changes (`deviceCommand.type: "pin"`) are a separate command from `trigger`
and are never charged. The daily `GET /api/cron/billing` sweep
(`runBillingCron`) issues subscription and overage invoices with **net-14**
terms. There is no automatic settlement: a platform admin records payment
(`markInvoicePaid` in `lib/invoices.ts`, via `/admin/billing`), and *that* is
what activates a subscription or activates the paid devices on it — nothing
else does.

## Gotchas

- **shadcn is style `radix-nova`** (`components.json`), on `radix-ui` + base-ui.
  Do NOT switch to the `base` color system — its "base-nova" components are
  react-aria based and lack `asChild`, which breaks the app.
- The sidebar's `SidebarMenuButton` renders a `Tooltip` when collapsed, so the
  app must be wrapped in `TooltipProvider` (done in `components/app-shell.tsx`).
- Don't pass lucide icon components (functions) across the server→client edge —
  nav is selected inside `AppShell` (client) by `workspace`.

## Seed accounts (`npm run db:seed`)

- Platform admin: **admin@ditto.app** / `123456`
- Tenant owner: **dana@roastwell.co** / `123456`
- Org "Roastwell Coffee": 3 stores, 6 claimed devices (mixed status, all
  subscribed/paid), 3 unclaimed devices (with pairing codes).
