// Drizzle schema for Ditto.
//
// Two layers live here:
//   1. Better Auth tables (user, session, account, verification + organization
//      plugin: organization, member, invitation). These match what Better Auth
//      expects. Regenerate/verify with `npx @better-auth/cli generate`.
//   2. App tables (tenantSettings, store, device, ...) that reference
//      organizationId — the Better Auth organization IS the tenant.
//
// Multi-tenancy: every app row carries organizationId. Platform (super-admin)
// access is NOT an org membership — it's user.role = 'platform_admin'.

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================================================
// Better Auth — core
// ============================================================================

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  // Platform-level role. Ditto staff = 'platform_admin'; everyone else 'user'.
  // Tenant roles live on the `member` table (owner/admin/member), not here.
  role: text("role").default("user").notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Set by the organization plugin: the user's currently-active org.
    activeOrganizationId: text("active_organization_id"),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ============================================================================
// Better Auth — organization plugin (organization = tenant)
// ============================================================================

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull(),
  metadata: text("metadata"),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [
    index("member_organization_id_idx").on(t.organizationId),
    index("member_user_id_idx").on(t.userId),
    // A user belongs to an org at most once — lets accept flows use
    // onConflictDoNothing instead of inserting duplicate memberships.
    uniqueIndex("member_org_user_idx").on(t.organizationId, t.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    // Better Auth's org plugin writes this on createInvitation — it MUST exist in
    // this Drizzle table or the adapter throws "field createdAt does not exist".
    createdAt: timestamp("created_at").defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("invitation_organization_id_idx").on(t.organizationId)],
);

// ============================================================================
// App tables (organizationId = tenant)
// ============================================================================

/** Per-tenant configuration. 1:1 with organization. */
export const tenantSettings = pgTable("tenant_settings", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  brandColor: text("brand_color").default("#10A765").notNull(),
  // Optional printer theme tokens (null → derived from brandColor). The printer
  // preview lets a tenant tune background / foreground / muted separately.
  brandBg: text("brand_bg"),
  brandFg: text("brand_fg"),
  brandMuted: text("brand_muted"),
  // Modular printer idle-screen layout (element positions/sizes/visibility +
  // clock timezone). Shape is lib/printer-layout.ts PrinterLayout; null → default.
  // NOTE: physical column kept as "kiosk_layout" — the device was renamed
  // kiosk→printer in code/UI, but the DB column is left as-is to avoid a
  // data migration on a column that holds live tenant config. Do not "fix".
  printerLayout: jsonb("kiosk_layout"),
  // v3 per-screen config (PrinterConfig). Supersedes printerLayout; printerLayout is
  // retained for one release for rollback safety. null → normalizePrinterConfig
  // migrates from printerLayout on read (Task 10). Physical column kept as
  // "kiosk_screens" (see note above).
  printerScreens: jsonb("kiosk_screens"),
  logoUrl: text("logo_url"),
  staffPin: text("staff_pin"),
  // --- Org-wide device policy settings (Device Settings page) -------------
  // QR visible duration. Source of truth for what was PrinterConfig.qrTimeoutSeconds;
  // overlaid back onto config.qrTimeoutSeconds at delivery (device contract unchanged).
  qrVisibleSeconds: integer("qr_visible_seconds").default(60).notNull(),
  // LCD backlight 10..100 (clamped so the screen can never go fully dark).
  screenBrightness: integer("screen_brightness").default(100).notNull(),
  // Screen sleep (display off, CPU keeps polling). false = stay awake.
  screenSleepEnabled: boolean("screen_sleep_enabled").default(false).notNull(),
  // Inactivity timeout before screen sleep, seconds (30..3600). Ignored when sleep off.
  screenSleepTimeoutSeconds: integer("screen_sleep_timeout_seconds").default(300).notNull(),
  // On-device Settings PIN: sha256(salt + pin). Device validates locally. null = ungated.
  deviceSettingsPasswordHash: text("device_settings_password_hash"),
  deviceSettingsPasswordSalt: text("device_settings_password_salt"),
  stripeCustomerId: text("stripe_customer_id"),
  status: text("status", { enum: ["active", "paused"] })
    .default("active")
    .notNull(),
  // Customer-offboarding lifecycle: non-null once archived (soft delete).
  // Independent of `status` (operational pause) above.
  archivedAt: timestamp("archived_at"),
  archivedNote: text("archived_note"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const store = pgTable(
  "store",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    timezone: text("timezone").notNull().default("UTC"), // IANA name; see lib/timezones.ts
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("store_organization_id_idx").on(t.organizationId)],
);

export const device = pgTable(
  "device",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Nullable until the device is claimed and bound to a store.
    storeId: text("store_id").references(() => store.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    status: text("status", { enum: ["online", "offline", "paused"] })
      .default("offline")
      .notNull(),
    ipAddress: text("ip_address"),
    connectionType: text("connection_type", { enum: ["ethernet", "wifi"] })
      .default("wifi")
      .notNull(),
    firmwareVersion: text("firmware_version").default("2.4.1").notNull(),
    lastSeenAt: timestamp("last_seen_at"),
    // One-time human-friendly code used to claim an unprovisioned device.
    pairingCode: text("pairing_code").unique(),
    // SHA-256 hash of the device's bearer key (raw key shown once at claim).
    deviceKeyHash: text("device_key_hash"),
    // Raw device key held ONLY between claim and the device's first claim-poll fetch;
    // nulled on delivery (we otherwise store only deviceKeyHash). M6a provisioning.
    pendingDeviceKey: text("pending_device_key"),
    claimedAt: timestamp("claimed_at"),
    // Normalized eFuse-MAC serial (12 lowercase hex chars), stamped at claim.
    // NOT a credential — matching/inventory only.
    serial: text("serial"),
    // A second physical device tried to claim this serial (unique-index hit);
    // this row's serial stayed null and the admin UI shows a warning.
    serialConflict: boolean("serial_conflict").default(false).notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("device_organization_id_idx").on(t.organizationId),
    index("device_store_id_idx").on(t.storeId),
    uniqueIndex("device_pairing_code_idx").on(t.pairingCode),
    index("device_key_hash_idx").on(t.deviceKeyHash),
    uniqueIndex("device_serial_idx").on(t.serial),
  ],
);

export type DeviceRowT = typeof device.$inferSelect;

// Factory inventory: every manufactured unit, keyed by its eFuse-MAC serial.
// Lifecycle: manufactured → allocated → claimed (one-way); rma/retired from any
// state. `allocated` with BOTH org and store arms one-shot auto-claim.
export const factoryDevice = pgTable(
  "factory_device",
  {
    serial: text("serial").primaryKey(), // normalized: 12 lowercase hex chars
    batchCode: text("batch_code"),
    hardwareRevision: text("hardware_revision"),
    status: text("status", {
      enum: ["manufactured", "allocated", "claimed", "rma", "retired"],
    })
      .default("manufactured")
      .notNull(),
    allocatedOrganizationId: text("allocated_organization_id").references(
      () => organization.id,
      { onDelete: "set null" },
    ),
    allocatedStoreId: text("allocated_store_id").references(() => store.id, {
      onDelete: "set null",
    }),
    // Live device row linked at claim.
    deviceId: text("device_id").references(() => device.id, { onDelete: "set null" }),
    // Row auto-created at claim time (serial was never imported).
    unregistered: boolean("unregistered").default(false).notNull(),
    manufacturedAt: timestamp("manufactured_at"),
    importedAt: timestamp("imported_at")
      .$defaultFn(() => new Date())
      .notNull(),
    allocatedAt: timestamp("allocated_at"),
    claimedAt: timestamp("claimed_at"),
    notes: text("notes"),
  },
  (t) => [
    index("factory_device_status_idx").on(t.status),
    index("factory_device_allocated_org_idx").on(t.allocatedOrganizationId),
    index("factory_device_device_id_idx").on(t.deviceId),
  ],
);

export type FactoryDeviceRowT = typeof factoryDevice.$inferSelect;

export const deviceCommand = pgTable(
  "device_command",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").notNull().references(() => device.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["reboot", "refresh", "identify", "config-changed", "firmware-update", "trigger"] }).notNull(),
    status: text("status", { enum: ["pending", "delivered", "acked", "failed", "expired"] }).default("pending").notNull(),
    result: text("result"),
    action: text("action"),
    payload: jsonb("payload"),
    expiresAt: timestamp("expires_at"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
    deliveredAt: timestamp("delivered_at"),
    ackedAt: timestamp("acked_at"),
  },
  (t) => [index("device_command_device_status_idx").on(t.deviceId, t.status)],
);

// Published firmware builds for OTA. "Latest" = newest createdAt. M6b.
export const firmwareRelease = pgTable("firmware_release", {
  id: text("id").primaryKey(),
  version: text("version").notNull().unique(),
  r2Key: text("r2_key").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const apiKey = pgTable(
  "api_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    prefix: text("prefix").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
    revokedAt: timestamp("revoked_at"),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    uniqueIndex("api_key_hash_idx").on(t.keyHash),
    index("api_key_organization_id_idx").on(t.organizationId),
  ],
);

export const creditBalance = pgTable("credit_balance", {
  organizationId: text("organization_id").primaryKey().references(() => organization.id, { onDelete: "cascade" }),
  available: integer("available").notNull().default(0),
  held: integer("held").notNull().default(0),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
});

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    deviceId: text("device_id").references(() => device.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["grant", "purchase", "hold", "settle", "release"] }).notNull(),
    credits: integer("credits").notNull(),
    action: text("action"),
    commandId: text("command_id"),
    idempotencyKey: text("idempotency_key"),
    balanceAfterAvailable: integer("balance_after_available"),
    note: text("note"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
  },
  (t) => [
    index("credit_ledger_org_created_idx").on(t.organizationId, t.createdAt),
    index("credit_ledger_device_created_idx").on(t.deviceId, t.createdAt),
    index("credit_ledger_command_idx").on(t.commandId),
    uniqueIndex("credit_ledger_kind_idem_idx").on(t.kind, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  ],
);

export const apiIdempotency = pgTable(
  "api_idempotency",
  {
    key: text("key").notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    commandId: text("command_id"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.organizationId] })],
);

// Cross-instance fixed-window rate limiter backing store. One row per limiter
// key (e.g. a device key hash or API key hash). `windowStart` is the floored
// start of the current fixed window; `count` is the number of hits seen in it.
// The increment-or-reset is done atomically in a single UPSERT — see
// lib/rate-limit.ts. Serverless instances all share this table, so the limit is
// actually enforced (an in-memory Map only throttled a single warm instance).
export const rateLimit = pgTable("rate_limit", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start").notNull(),
  count: integer("count").default(0).notNull(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorType: text("actor_type", { enum: ["user", "system", "stripe"] }).notNull(),
    actorId: text("actor_id"),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("audit_log_org_created_idx").on(t.organizationId, t.createdAt)],
);

export const alert = pgTable(
  "alert",
  {
    id: text("id").primaryKey(),
    // Stable identity from computeAlerts: "devices-stale", "documents-stuck",
    // "tenants-inactive", "tenant-inactive:<orgId>".
    key: text("key").notNull(),
    severity: text("severity", { enum: ["info", "warning"] }).notNull(),
    message: text("message").notNull(),
    status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
    firstSeenAt: timestamp("first_seen_at").$defaultFn(() => new Date()).notNull(),
    lastSeenAt: timestamp("last_seen_at").$defaultFn(() => new Date()).notNull(),
    resolvedAt: timestamp("resolved_at"),
    notifiedAt: timestamp("notified_at"),
  },
  (t) => [
    // At most one OPEN row per key; a key can re-open after resolving (new row).
    uniqueIndex("alert_open_key_idx").on(t.key).where(sql`status = 'open'`),
    index("alert_status_idx").on(t.status, t.lastSeenAt),
  ],
);

// Re-export a flat table map for the Drizzle adapter / db client.
export const schema = {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
  tenantSettings,
  store,
  device,
  factoryDevice,
  deviceCommand,
  apiKey,
  creditBalance,
  creditLedger,
  apiIdempotency,
  rateLimit,
  auditLog,
  alert,
};

// Keep `sql` import used (some toolchains tree-shake otherwise).
export const _schemaVersion = sql`1`;
