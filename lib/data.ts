// Data layer — real Drizzle queries over Neon.
//
// Same function names + return types as the original mock layer, so screens are
// unchanged (they only gained `await`). Tenant-panel functions take an
// `organizationId` (the active tenant); super-admin functions span all orgs.
//
// DB conventions → view-model conversions happen here:
//   • money is stored in cents → exposed as dollars (perPrintPrice, amount)
//   • tenant_settings.status (active|paused) → TenantStatus (active|suspended)
//   • device.lastSeenAt (Date|null) → Device.lastSeen (ISO string)
//   • receiptsToday / receiptsThisMonth are derived from the receipt table

import { and, count, desc, eq, gte, isNotNull, lt, lte, max, ne } from "drizzle-orm";
import { db } from "./db";
import {
  auditLog as auditLogTable,
  device as deviceTable,
  deviceCommand,
  invitation as invitationTable,
  invoice as invoiceTable,
  member as memberTable,
  organization as orgTable,
  receipt as receiptTable,
  store as storeTable,
  tenantSettings as settingsTable,
  user as userTable,
} from "./db/schema";
import { computeEcoSavings } from "./eco";
import { computeAlerts, STALE_MINUTES, STUCK_PENDING_MINUTES, INACTIVE_DAYS, type HealthAlert } from "./health";
import { type ReceiptFilters, PAGE_SIZE } from "./receipts-search";
import { presignedGetUrl } from "./storage";
import type {
  Device,
  DeviceRow,
  Invoice,
  Store,
  StoreSummary,
  Tenant,
  TenantStatus,
  TenantSummary,
  TimePoint,
} from "./types";

// ============================================================================
// Internal: load an org's raw rows once, then build view-models from the bundle
// ============================================================================

type ReceiptLite = {
  deviceId: string;
  storeId: string | null;
  createdAt: Date;
};

interface OrgBundle {
  org: typeof orgTable.$inferSelect;
  settings: typeof settingsTable.$inferSelect | undefined;
  stores: (typeof storeTable.$inferSelect)[];
  devices: (typeof deviceTable.$inferSelect)[];
  receipts: ReceiptLite[];
  contact: { name: string; email: string; phone: string };
}

async function loadOrg(organizationId: string): Promise<OrgBundle | null> {
  const [org] = await db
    .select()
    .from(orgTable)
    .where(eq(orgTable.id, organizationId))
    .limit(1);
  if (!org) return null;

  const [settings, stores, devices, receipts, ownerRows] = await Promise.all([
    db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.organizationId, organizationId))
      .limit(1)
      .then((r) => r[0]),
    db.select().from(storeTable).where(eq(storeTable.organizationId, organizationId)),
    db.select().from(deviceTable).where(eq(deviceTable.organizationId, organizationId)),
    db
      .select({
        deviceId: receiptTable.deviceId,
        storeId: receiptTable.storeId,
        createdAt: receiptTable.createdAt,
      })
      .from(receiptTable)
      .where(eq(receiptTable.organizationId, organizationId)),
    db
      .select({ name: userTable.name, email: userTable.email, role: memberTable.role })
      .from(memberTable)
      .innerJoin(userTable, eq(memberTable.userId, userTable.id))
      .where(eq(memberTable.organizationId, organizationId)),
  ]);

  const owner =
    ownerRows.find((m) => m.role === "owner") ?? ownerRows[0] ?? null;

  return {
    org,
    settings,
    stores,
    devices,
    receipts,
    contact: {
      name: owner?.name ?? org.name,
      email: owner?.email ?? "",
      phone: "",
    },
  };
}

async function loadAllOrgs(): Promise<OrgBundle[]> {
  const orgs = await db.select({ id: orgTable.id }).from(orgTable);
  const bundles = await Promise.all(orgs.map((o) => loadOrg(o.id)));
  return bundles.filter((b): b is OrgBundle => b !== null);
}

// ---- time helpers -----------------------------------------------------------

function startOfToday(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}
function startOfMonth(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1).getTime();
}

/** receipts-per-device for today and this month. */
function deviceCounts(receipts: ReceiptLite[]) {
  const today = startOfToday();
  const month = startOfMonth();
  const todayBy = new Map<string, number>();
  const monthBy = new Map<string, number>();
  for (const r of receipts) {
    const t = r.createdAt.getTime();
    if (t >= month) monthBy.set(r.deviceId, (monthBy.get(r.deviceId) ?? 0) + 1);
    if (t >= today) todayBy.set(r.deviceId, (todayBy.get(r.deviceId) ?? 0) + 1);
  }
  return { todayBy, monthBy };
}

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

function mapTenantStatus(s: string | undefined): TenantStatus {
  // tenant_settings.status is active|paused; the view model adds trial/suspended.
  return s === "paused" ? "suspended" : "active";
}

// ---- bundle → view models ---------------------------------------------------

function buildTenant(b: OrgBundle): Tenant {
  const { todayBy, monthBy } = deviceCounts(b.receipts);
  const price = dollars(b.settings?.perPrintPriceCents ?? 4);

  const stores: Store[] = b.stores.map((s) => ({
    id: s.id,
    tenantId: b.org.id,
    name: s.name,
    address: s.address,
    devices: b.devices
      .filter((d) => d.storeId === s.id)
      .map((d) => mapDevice(d, b.org.id, todayBy, monthBy)),
  }));

  return {
    id: b.org.id,
    name: b.org.name,
    perPrintPrice: price,
    contact: b.contact,
    status: mapTenantStatus(b.settings?.status),
    brandColor: b.settings?.brandColor ?? "#10A765",
    logoText: b.org.name,
    staffPin: b.settings?.staffPin ?? "",
    stores,
  };
}

function mapDevice(
  d: typeof deviceTable.$inferSelect,
  organizationId: string,
  todayBy: Map<string, number>,
  monthBy: Map<string, number>,
): Device {
  return {
    id: d.id,
    storeId: d.storeId ?? "",
    tenantId: organizationId,
    name: d.name,
    status: d.status,
    ipAddress: d.ipAddress ?? "—",
    connectionType: d.connectionType,
    firmwareVersion: d.firmwareVersion,
    lastSeen: (d.lastSeenAt ?? d.createdAt).toISOString(),
    receiptsToday: todayBy.get(d.id) ?? 0,
    receiptsThisMonth: monthBy.get(d.id) ?? 0,
  };
}

function rollUpStoreStatus(devices: Device[]): StoreSummary["status"] {
  if (devices.some((d) => d.status === "online")) return "online";
  if (devices.some((d) => d.status === "paused")) return "paused";
  return "offline";
}

function summarize(b: OrgBundle): TenantSummary {
  const tenant = buildTenant(b);
  const allDevices = tenant.stores.flatMap((s) => s.devices);
  const receiptsThisMonth = allDevices.reduce(
    (a, d) => a + d.receiptsThisMonth,
    0,
  );
  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    storeCount: tenant.stores.length,
    deviceCount: allDevices.length,
    receiptsThisMonth,
    revenueThisMonth:
      Math.round(receiptsThisMonth * tenant.perPrintPrice * 100) / 100,
    perPrintPrice: tenant.perPrintPrice,
  };
}

// ---- time series from real receipts ----------------------------------------

function dailySeries(b: OrgBundle, price: number): TimePoint[] {
  const out: TimePoint[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const next = new Date(day.getTime() + 86_400_000).getTime();
    const start = day.getTime();
    const receipts = b.receipts.filter((r) => {
      const t = r.createdAt.getTime();
      return t >= start && t < next;
    }).length;
    out.push({
      label: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      receipts,
      revenue: Math.round(receipts * price * 100) / 100,
    });
  }
  return out;
}

function monthlySeries(b: OrgBundle, price: number): TimePoint[] {
  const out: TimePoint[] = [];
  const now = new Date();
  for (let i = 8; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime();
    const start = m.getTime();
    const receipts = b.receipts.filter((r) => {
      const t = r.createdAt.getTime();
      return t >= start && t < next;
    }).length;
    out.push({
      label: m.toLocaleDateString("en-US", { month: "short" }),
      receipts,
      revenue: Math.round(receipts * price * 100) / 100,
    });
  }
  return out;
}

function sumSeries(all: TimePoint[][]): TimePoint[] {
  if (all.length === 0) return [];
  return all[0].map((_, i) => ({
    label: all[0][i].label,
    receipts: all.reduce((a, s) => a + s[i].receipts, 0),
    revenue: Math.round(all.reduce((a, s) => a + s[i].revenue, 0) * 100) / 100,
  }));
}

// ============================================================================
// Tenant lookups
// ============================================================================

export async function getTenants(): Promise<Tenant[]> {
  const bundles = await loadAllOrgs();
  return bundles.map(buildTenant);
}

export async function getTenant(organizationId: string): Promise<Tenant> {
  const b = await loadOrg(organizationId);
  if (!b) throw new Error(`Organization not found: ${organizationId}`);
  return buildTenant(b);
}

// ============================================================================
// Tenant panel
// ============================================================================

export interface TenantDashboard {
  tenant: Tenant;
  receiptsToday: number;
  receiptsThisMonth: number;
  activeDevices: number;
  totalDevices: number;
  eco: ReturnType<typeof computeEcoSavings>;
  ecoYtdReceipts: number;
  ecoYtd: ReturnType<typeof computeEcoSavings>;
  daily: TimePoint[];
}

export async function getTenantDashboard(
  organizationId: string,
): Promise<TenantDashboard> {
  const b = await loadOrg(organizationId);
  if (!b) throw new Error(`Organization not found: ${organizationId}`);
  const tenant = buildTenant(b);
  const devices = tenant.stores.flatMap((s) => s.devices);
  const receiptsToday = devices.reduce((a, d) => a + d.receiptsToday, 0);
  const receiptsThisMonth = devices.reduce((a, d) => a + d.receiptsThisMonth, 0);
  const activeDevices = devices.filter((d) => d.status === "online").length;
  const ecoYtdReceipts = Math.round(receiptsThisMonth * 7.4);

  return {
    tenant,
    receiptsToday,
    receiptsThisMonth,
    activeDevices,
    totalDevices: devices.length,
    eco: computeEcoSavings(receiptsThisMonth),
    ecoYtdReceipts,
    ecoYtd: computeEcoSavings(ecoYtdReceipts),
    daily: dailySeries(b, tenant.perPrintPrice),
  };
}

export async function getTenantStores(
  organizationId: string,
): Promise<StoreSummary[]> {
  const tenant = await getTenant(organizationId);
  return tenant.stores.map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address,
    deviceCount: s.devices.length,
    onlineCount: s.devices.filter((d) => d.status === "online").length,
    receiptsThisMonth: s.devices.reduce((a, d) => a + d.receiptsThisMonth, 0),
    status: rollUpStoreStatus(s.devices),
  }));
}

export async function getStore(
  storeId: string,
): Promise<{ store: Store; tenant: Tenant } | null> {
  const [row] = await db
    .select({ organizationId: storeTable.organizationId })
    .from(storeTable)
    .where(eq(storeTable.id, storeId))
    .limit(1);
  if (!row) return null;
  const tenant = await getTenant(row.organizationId);
  const store = tenant.stores.find((s) => s.id === storeId);
  return store ? { store, tenant } : null;
}

export async function getDevice(
  deviceId: string,
): Promise<{ device: Device; store: Store; tenant: Tenant } | null> {
  const [row] = await db
    .select({ organizationId: deviceTable.organizationId, storeId: deviceTable.storeId })
    .from(deviceTable)
    .where(eq(deviceTable.id, deviceId))
    .limit(1);
  if (!row) return null;
  const tenant = await getTenant(row.organizationId);
  for (const store of tenant.stores) {
    const device = store.devices.find((d) => d.id === deviceId);
    if (device) return { device, store, tenant };
  }
  return null;
}

export async function tenantDaily(organizationId: string): Promise<TimePoint[]> {
  const b = await loadOrg(organizationId);
  if (!b) return [];
  return dailySeries(b, dollars(b.settings?.perPrintPriceCents ?? 4));
}

export async function tenantMonthly(organizationId: string): Promise<TimePoint[]> {
  const b = await loadOrg(organizationId);
  if (!b) return [];
  return monthlySeries(b, dollars(b.settings?.perPrintPriceCents ?? 4));
}

// ============================================================================
// Super-admin panel
// ============================================================================

export async function getTenantSummaries(): Promise<TenantSummary[]> {
  const bundles = await loadAllOrgs();
  return bundles.map(summarize);
}

export async function getAllDevices(): Promise<DeviceRow[]> {
  const bundles = await loadAllOrgs();
  const rows: DeviceRow[] = [];
  for (const b of bundles) {
    const tenant = buildTenant(b);
    for (const store of tenant.stores) {
      for (const device of store.devices) {
        rows.push({ ...device, tenantName: tenant.name, storeName: store.name });
      }
    }
  }
  return rows;
}

export interface AdminOverview {
  mrr: number;
  receiptsThisMonth: number;
  activeDevices: number;
  totalDevices: number;
  totalCustomers: number;
  totalStores: number;
  monthly: TimePoint[];
  daily: TimePoint[];
  topCustomers: TenantSummary[];
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const bundles = await loadAllOrgs();
  const summaries = bundles.map(summarize);
  const monthly = sumSeries(
    bundles.map((b) => monthlySeries(b, dollars(b.settings?.perPrintPriceCents ?? 4))),
  );
  const daily = sumSeries(
    bundles.map((b) => dailySeries(b, dollars(b.settings?.perPrintPriceCents ?? 4))),
  );

  let activeDevices = 0;
  let totalDevices = 0;
  for (const b of bundles) {
    for (const d of b.devices) {
      totalDevices++;
      if (d.status === "online") activeDevices++;
    }
  }

  return {
    mrr: Math.round(summaries.reduce((a, s) => a + s.revenueThisMonth, 0) * 100) / 100,
    receiptsThisMonth: summaries.reduce((a, s) => a + s.receiptsThisMonth, 0),
    activeDevices,
    totalDevices,
    totalCustomers: summaries.length,
    totalStores: summaries.reduce((a, s) => a + s.storeCount, 0),
    monthly,
    daily,
    topCustomers: [...summaries]
      .sort((a, b) => b.revenueThisMonth - a.revenueThisMonth)
      .slice(0, 5),
  };
}

// ---- Customer detail --------------------------------------------------------

export interface CustomerDetail {
  tenant: Tenant;
  summary: TenantSummary;
  devices: DeviceRow[];
  monthly: TimePoint[];
  invoices: Invoice[];
  eco: ReturnType<typeof computeEcoSavings>;
}

export async function getCustomerDetail(
  organizationId: string,
): Promise<CustomerDetail | null> {
  const b = await loadOrg(organizationId);
  if (!b) return null;
  const tenant = buildTenant(b);
  const summary = summarize(b);
  const devices: DeviceRow[] = tenant.stores.flatMap((store) =>
    store.devices.map((d) => ({
      ...d,
      tenantName: tenant.name,
      storeName: store.name,
    })),
  );
  return {
    tenant,
    summary,
    devices,
    monthly: monthlySeries(b, tenant.perPrintPrice),
    invoices: await getInvoices(organizationId),
    eco: computeEcoSavings(summary.receiptsThisMonth),
  };
}

// ============================================================================
// Billing
// ============================================================================

function mapInvoice(row: typeof invoiceTable.$inferSelect): Invoice {
  const now = Date.now();
  const status: Invoice["status"] =
    row.status === "paid"
      ? "paid"
      : row.status === "sent" && row.periodEnd.getTime() < now
        ? "overdue"
        : "due";
  return {
    id: row.id,
    tenantId: row.organizationId,
    period: row.periodStart.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    }),
    receipts: row.receiptCount,
    amount: dollars(row.amountDueCents),
    status,
    lifecycle: row.status,
    issuedOn: row.createdAt.toISOString(),
  };
}

export async function getInvoices(organizationId?: string): Promise<Invoice[]> {
  const rows = organizationId
    ? await db
        .select()
        .from(invoiceTable)
        .where(eq(invoiceTable.organizationId, organizationId))
    : await db.select().from(invoiceTable);
  return rows
    .map(mapInvoice)
    .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
}

export interface BillingOverview {
  totalEarnings: number;
  outstanding: number;
  invoices: Invoice[];
  byTenant: (TenantSummary & { amountOwed: number })[];
  monthly: TimePoint[];
}

export async function getBillingOverview(): Promise<BillingOverview> {
  const bundles = await loadAllOrgs();
  const summaries = bundles.map(summarize);
  const allInvoices = await getInvoices();

  const totalEarnings =
    Math.round(
      allInvoices.filter((i) => i.status === "paid").reduce((a, i) => a + i.amount, 0) *
        100,
    ) / 100;
  const outstanding =
    Math.round(
      allInvoices.filter((i) => i.status !== "paid").reduce((a, i) => a + i.amount, 0) *
        100,
    ) / 100;

  const byTenant = summaries.map((s) => {
    const owed = allInvoices
      .filter((i) => i.tenantId === s.id && i.status !== "paid")
      .reduce((a, i) => a + i.amount, 0);
    return { ...s, amountOwed: Math.round(owed * 100) / 100 };
  });

  return {
    totalEarnings,
    outstanding,
    invoices: allInvoices,
    byTenant,
    monthly: sumSeries(
      bundles.map((b) => monthlySeries(b, dollars(b.settings?.perPrintPriceCents ?? 4))),
    ),
  };
}

/** Map an organizationId → display name. */
export async function tenantNameOf(organizationId: string): Promise<string> {
  const [row] = await db
    .select({ name: orgTable.name })
    .from(orgTable)
    .where(eq(orgTable.id, organizationId))
    .limit(1);
  return row?.name ?? organizationId;
}

// ============================================================================
// Branding (tenant_settings)
// ============================================================================

export interface TenantBranding {
  brandColor: string;
  staffPin: string;
  /** Presigned, ready-to-render image URL (null if no logo uploaded). */
  logoUrl: string | null;
  /** Whether a logo object exists in storage (drives the "remove" affordance). */
  hasLogo: boolean;
}

export async function getTenantBranding(
  organizationId: string,
): Promise<TenantBranding> {
  const [s] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.organizationId, organizationId))
    .limit(1);

  let logoUrl: string | null = null;
  if (s?.logoUrl) {
    // tenant_settings.logoUrl stores the R2 object key; presign for display.
    logoUrl = await presignedGetUrl(s.logoUrl);
  }

  return {
    brandColor: s?.brandColor ?? "#10A765",
    staffPin: s?.staffPin ?? "",
    logoUrl,
    hasLogo: !!s?.logoUrl,
  };
}

// Device provisioning helpers live in lib/receipts.ts (claimDevice,
// getUnclaimedDevices) — re-exported here so callers have one data entrypoint.
export { claimDevice, getUnclaimedDevices } from "./receipts";

// ============================================================================
// Tenant billing view-model (subscription status, saved card, invoices).
// ============================================================================

export async function getTenantBilling(organizationId: string) {
  const [settings] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.organizationId, organizationId))
    .limit(1);

  const invoices = await db
    .select()
    .from(invoiceTable)
    .where(eq(invoiceTable.organizationId, organizationId))
    .orderBy(desc(invoiceTable.periodStart));

  return {
    subscriptionStatus: settings?.subscriptionStatus ?? null,
    hasSubscription: Boolean(settings?.stripeSubscriptionId),
    card:
      settings?.cardBrand && settings?.cardLast4
        ? { brand: settings.cardBrand, last4: settings.cardLast4 }
        : null,
    invoices: invoices.map((i) => ({
      id: i.id,
      periodStart: i.periodStart.toISOString(),
      periodEnd: i.periodEnd.toISOString(),
      receiptCount: i.receiptCount,
      amount: i.amountDueCents / 100,
      status: i.status,
      hostedInvoiceUrl: i.hostedInvoiceUrl ?? null,
    })),
  };
}

export async function getOrgAuditLog(organizationId: string, limit = 100) {
  const rows = await db
    .select()
    .from(auditLogTable)
    .where(eq(auditLogTable.organizationId, organizationId))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actor: r.actorLabel ?? r.actorType,
    target: r.targetType && r.targetId ? `${r.targetType}:${r.targetId}` : null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    at: r.createdAt.toISOString(),
  }));
}

export async function getOrgMembers(organizationId: string) {
  const rows = await db
    .select({
      id: memberTable.id,
      userId: memberTable.userId,
      role: memberTable.role,
      name: userTable.name,
      email: userTable.email,
      joinedAt: memberTable.createdAt,
    })
    .from(memberTable)
    .innerJoin(userTable, eq(memberTable.userId, userTable.id))
    .where(eq(memberTable.organizationId, organizationId));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    role: r.role,
    name: r.name,
    email: r.email,
    joinedAt: r.joinedAt.toISOString(),
  }));
}

export async function getOrgInvitations(organizationId: string) {
  const rows = await db
    .select()
    .from(invitationTable)
    .where(and(eq(invitationTable.organizationId, organizationId), eq(invitationTable.status, "pending")));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role ?? "member",
    expiresAt: r.expiresAt.toISOString(),
  }));
}

export interface ReceiptListRow {
  id: string;
  token: string;
  status: "pending" | "ready" | "downloaded";
  storeName: string | null;
  deviceName: string | null;
  createdAt: string;
  byteSize: number;
}

/** Build the WHERE conditions shared by the list + count queries. */
function receiptConditions(f: ReceiptFilters) {
  const c = [];
  if (f.organizationId) c.push(eq(receiptTable.organizationId, f.organizationId));
  if (f.storeId) c.push(eq(receiptTable.storeId, f.storeId));
  if (f.deviceId) c.push(eq(receiptTable.deviceId, f.deviceId));
  if (f.status) c.push(eq(receiptTable.status, f.status));
  if (f.from) c.push(gte(receiptTable.createdAt, f.from));
  if (f.to) c.push(lte(receiptTable.createdAt, f.to));
  if (f.token) c.push(eq(receiptTable.token, f.token));
  return c;
}

/** Filterable, paginated receipt search (tenant: pass organizationId; admin: omit). */
export async function searchReceipts(
  f: ReceiptFilters,
): Promise<{ rows: ReceiptListRow[]; total: number }> {
  const conds = receiptConditions(f);
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: receiptTable.id,
      token: receiptTable.token,
      status: receiptTable.status,
      storeName: storeTable.name,
      deviceName: deviceTable.name,
      createdAt: receiptTable.createdAt,
      byteSize: receiptTable.byteSize,
    })
    .from(receiptTable)
    .leftJoin(storeTable, eq(receiptTable.storeId, storeTable.id))
    .leftJoin(deviceTable, eq(receiptTable.deviceId, deviceTable.id))
    .where(where)
    .orderBy(desc(receiptTable.createdAt))
    .limit(PAGE_SIZE)
    .offset((f.page - 1) * PAGE_SIZE);

  const [{ total }] = await db
    .select({ total: count() })
    .from(receiptTable)
    .where(where);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      token: r.token,
      status: r.status,
      storeName: r.storeName,
      deviceName: r.deviceName,
      createdAt: r.createdAt.toISOString(),
      byteSize: r.byteSize,
    })),
    total: Number(total),
  };
}

/** One receipt + a fresh presigned image URL. Read-only — never flips status. */
export async function getReceiptDetail(
  receiptId: string,
  opts: { organizationId?: string },
) {
  const conds = [eq(receiptTable.id, receiptId)];
  if (opts.organizationId) conds.push(eq(receiptTable.organizationId, opts.organizationId));
  const [r] = await db
    .select({
      id: receiptTable.id,
      token: receiptTable.token,
      status: receiptTable.status,
      storageKey: receiptTable.storageKey,
      byteSize: receiptTable.byteSize,
      createdAt: receiptTable.createdAt,
      downloadedAt: receiptTable.downloadedAt,
      storeName: storeTable.name,
      deviceName: deviceTable.name,
    })
    .from(receiptTable)
    .leftJoin(storeTable, eq(receiptTable.storeId, storeTable.id))
    .leftJoin(deviceTable, eq(receiptTable.deviceId, deviceTable.id))
    .where(and(...conds))
    .limit(1);
  if (!r) return null;

  let imageUrl: string | null = null;
  if (r.status !== "pending") {
    try {
      imageUrl = await presignedGetUrl(r.storageKey);
    } catch {
      imageUrl = null;
    }
  }
  return {
    id: r.id,
    token: r.token,
    status: r.status,
    storeName: r.storeName,
    deviceName: r.deviceName,
    byteSize: r.byteSize,
    createdAt: r.createdAt.toISOString(),
    downloadedAt: r.downloadedAt ? r.downloadedAt.toISOString() : null,
    imageUrl,
  };
}

/** Stores + devices for an org, for the tenant filter dropdowns. */
export async function getReceiptFilterOptions(organizationId: string) {
  const [stores, devices] = await Promise.all([
    db.select({ id: storeTable.id, name: storeTable.name }).from(storeTable).where(eq(storeTable.organizationId, organizationId)),
    db.select({ id: deviceTable.id, name: deviceTable.name }).from(deviceTable).where(eq(deviceTable.organizationId, organizationId)),
  ]);
  return { stores, devices };
}

export interface PlatformHealth {
  fleet: {
    total: number;
    online: number;
    offline: number;
    paused: number;
    staleCount: number;
    stale: { deviceId: string; name: string; tenantName: string | null; lastSeen: string }[];
  };
  ingest: {
    last1h: number;
    last24h: number;
    ready: number;
    downloaded: number;
    pending: number;
    stuckPending: number;
  };
  usage: {
    topTenants: { id: string; name: string; count: number }[];
    inactiveTenants: { id: string; name: string; lastReceiptAt: string | null }[];
  };
  alerts: HealthAlert[];
}

function zeroedHealth(): PlatformHealth {
  return {
    fleet: { total: 0, online: 0, offline: 0, paused: 0, staleCount: 0, stale: [] },
    ingest: { last1h: 0, last24h: 0, ready: 0, downloaded: 0, pending: 0, stuckPending: 0 },
    usage: { topTenants: [], inactiveTenants: [] },
    alerts: [],
  };
}

/** Read-only operational metrics across all orgs. Degrades to zeros on error. */
export async function getPlatformHealth(): Promise<PlatformHealth> {
  const now = new Date();
  const ms = (n: number) => new Date(now.getTime() - n);
  const h1 = ms(60 * 60 * 1000);
  const h24 = ms(24 * 60 * 60 * 1000);
  const staleCut = ms(STALE_MINUTES * 60 * 1000);
  const stuckCut = ms(STUCK_PENDING_MINUTES * 60 * 1000);
  const inactiveCut = ms(INACTIVE_DAYS * 24 * 60 * 60 * 1000);

  try {
    const statusRows = await db
      .select({ status: deviceTable.status, c: count() })
      .from(deviceTable)
      .groupBy(deviceTable.status);
    const byStatus = { online: 0, offline: 0, paused: 0 } as Record<string, number>;
    let total = 0;
    for (const r of statusRows) {
      byStatus[r.status] = Number(r.c);
      total += Number(r.c);
    }

    const stalePred = and(
      isNotNull(deviceTable.lastSeenAt),
      lt(deviceTable.lastSeenAt, staleCut),
      ne(deviceTable.status, "paused"),
    );
    const staleRows = await db
      .select({
        deviceId: deviceTable.id,
        name: deviceTable.name,
        tenantName: orgTable.name,
        lastSeen: deviceTable.lastSeenAt,
      })
      .from(deviceTable)
      .leftJoin(orgTable, eq(deviceTable.organizationId, orgTable.id))
      .where(stalePred)
      .orderBy(deviceTable.lastSeenAt)
      .limit(50);
    const [{ staleCount }] = await db
      .select({ staleCount: count() })
      .from(deviceTable)
      .where(stalePred);

    const [{ last1h }] = await db.select({ last1h: count() }).from(receiptTable).where(gte(receiptTable.createdAt, h1));
    const [{ last24h }] = await db.select({ last24h: count() }).from(receiptTable).where(gte(receiptTable.createdAt, h24));
    const breakdownRows = await db
      .select({ status: receiptTable.status, c: count() })
      .from(receiptTable)
      .where(gte(receiptTable.createdAt, h24))
      .groupBy(receiptTable.status);
    const breakdown = { ready: 0, downloaded: 0, pending: 0 } as Record<string, number>;
    for (const r of breakdownRows) breakdown[r.status] = Number(r.c);
    const [{ stuckPending }] = await db
      .select({ stuckPending: count() })
      .from(receiptTable)
      .where(and(eq(receiptTable.status, "pending"), lt(receiptTable.createdAt, stuckCut)));

    const topRows = await db
      .select({ id: orgTable.id, name: orgTable.name, c: count() })
      .from(receiptTable)
      .innerJoin(orgTable, eq(receiptTable.organizationId, orgTable.id))
      .where(gte(receiptTable.createdAt, h24))
      .groupBy(orgTable.id, orgTable.name)
      .orderBy(desc(count()))
      .limit(5);
    const topTenants = topRows.map((r) => ({ id: r.id, name: r.name, count: Number(r.c) }));

    const allOrgs = await db.select({ id: orgTable.id, name: orgTable.name }).from(orgTable);
    // One row per org (max createdAt) — avoids reading the whole receipt table.
    const lastRows = await db
      .select({ org: receiptTable.organizationId, last: max(receiptTable.createdAt) })
      .from(receiptTable)
      .groupBy(receiptTable.organizationId);
    const lastByOrg = new Map<string, Date>();
    for (const r of lastRows) if (r.last) lastByOrg.set(r.org, r.last);
    const inactiveTenants = allOrgs
      .filter((o) => {
        const last = lastByOrg.get(o.id);
        return !last || last < inactiveCut;
      })
      .map((o) => ({
        id: o.id,
        name: o.name,
        lastReceiptAt: lastByOrg.get(o.id)?.toISOString() ?? null,
      }));

    const alerts = computeAlerts({
      staleCount: Number(staleCount),
      stuckPendingCount: Number(stuckPending),
      inactiveTenants: inactiveTenants.map((t) => ({ id: t.id, name: t.name })),
    });

    return {
      fleet: {
        total,
        online: byStatus.online ?? 0,
        offline: byStatus.offline ?? 0,
        paused: byStatus.paused ?? 0,
        staleCount: Number(staleCount),
        stale: staleRows.map((r) => ({
          deviceId: r.deviceId,
          name: r.name,
          tenantName: r.tenantName,
          lastSeen: r.lastSeen ? r.lastSeen.toISOString() : "",
        })),
      },
      ingest: {
        last1h: Number(last1h),
        last24h: Number(last24h),
        ready: breakdown.ready ?? 0,
        downloaded: breakdown.downloaded ?? 0,
        pending: breakdown.pending ?? 0,
        stuckPending: Number(stuckPending),
      },
      usage: { topTenants, inactiveTenants },
      alerts,
    };
  } catch (err) {
    console.error("[health] getPlatformHealth failed", err);
    return zeroedHealth();
  }
}

export async function getDeviceCommands(deviceId: string, limit = 20) {
  const rows = await db
    .select()
    .from(deviceCommand)
    .where(eq(deviceCommand.deviceId, deviceId))
    .orderBy(desc(deviceCommand.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    ackedAt: r.ackedAt ? r.ackedAt.toISOString() : null,
  }));
}
