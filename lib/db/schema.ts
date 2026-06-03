// Drizzle schema for Ditto.
//
// Two layers live here:
//   1. Better Auth tables (user, session, account, verification + organization
//      plugin: organization, member, invitation). These match what Better Auth
//      expects. Regenerate/verify with `npx @better-auth/cli generate`.
//   2. App tables (tenantSettings, store, device, receipt, invoice) that
//      reference organizationId — the Better Auth organization IS the tenant.
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
  // Price Ditto charges per digital receipt, in whole cents (avoids float drift).
  perPrintPriceCents: integer("per_print_price_cents").default(4).notNull(),
  brandColor: text("brand_color").default("#10A765").notNull(),
  logoUrl: text("logo_url"),
  staffPin: text("staff_pin"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  cardBrand: text("card_brand"),
  cardLast4: text("card_last4"),
  status: text("status", { enum: ["active", "paused"] })
    .default("active")
    .notNull(),
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
    appVersion: text("app_version"),
    // One-time human-friendly code used to claim an unprovisioned device.
    pairingCode: text("pairing_code").unique(),
    // SHA-256 hash of the device's bearer key (raw key shown once at claim).
    deviceKeyHash: text("device_key_hash"),
    claimedAt: timestamp("claimed_at"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("device_organization_id_idx").on(t.organizationId),
    index("device_store_id_idx").on(t.storeId),
    uniqueIndex("device_pairing_code_idx").on(t.pairingCode),
    index("device_key_hash_idx").on(t.deviceKeyHash),
  ],
);

export type DeviceRowT = typeof device.$inferSelect;

export const deviceCommand = pgTable(
  "device_command",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").notNull().references(() => device.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["reboot", "refresh", "identify"] }).notNull(),
    status: text("status", { enum: ["pending", "delivered", "acked", "failed"] }).default("pending").notNull(),
    result: text("result"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
    deliveredAt: timestamp("delivered_at"),
    ackedAt: timestamp("acked_at"),
  },
  (t) => [index("device_command_device_status_idx").on(t.deviceId, t.status)],
);

export const receipt = pgTable(
  "receipt",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
    storeId: text("store_id").references(() => store.id, {
      onDelete: "set null",
    }),
    // Unguessable capability token (nanoid). The token IS the access grant for
    // the public receipt page — keep it long.
    token: text("token").notNull().unique(),
    storageKey: text("storage_key").notNull(), // R2 object key
    mimeType: text("mime_type").default("image/png").notNull(),
    byteSize: integer("byte_size").default(0).notNull(),
    status: text("status", { enum: ["pending", "ready", "downloaded"] })
      .default("pending")
      .notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    downloadedAt: timestamp("downloaded_at"),
  },
  (t) => [
    uniqueIndex("receipt_token_idx").on(t.token),
    index("receipt_organization_id_idx").on(t.organizationId),
    index("receipt_device_id_idx").on(t.deviceId),
    index("receipt_store_id_idx").on(t.storeId),
    index("receipt_created_at_idx").on(t.createdAt),
  ],
);

export const invoice = pgTable(
  "invoice",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    receiptCount: integer("receipt_count").default(0).notNull(),
    // Stored in cents to avoid floating-point money drift.
    unitPriceCents: integer("unit_price_cents").default(4).notNull(),
    amountDueCents: integer("amount_due_cents").default(0).notNull(),
    status: text("status", { enum: ["draft", "sent", "paid", "overdue", "void"] })
      .default("draft")
      .notNull(),
    stripeInvoiceId: text("stripe_invoice_id"),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("invoice_organization_id_idx").on(t.organizationId),
    // One row per Stripe invoice — makes the webhook upsert idempotent under
    // Stripe's at-least-once / concurrent delivery. NULLs (legacy rows) are
    // allowed multiple times by Postgres unique semantics.
    uniqueIndex("invoice_stripe_invoice_id_idx").on(t.stripeInvoiceId),
  ],
);

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
  deviceCommand,
  receipt,
  invoice,
  auditLog,
};

// Keep `sql` import used (some toolchains tree-shake otherwise).
export const _schemaVersion = sql`1`;
