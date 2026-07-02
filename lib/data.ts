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
//   • documentsToday / documentsThisMonth are derived from the document table

import { and, count, desc, eq, gte, isNotNull, lt, lte, max, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { id as genId } from "@/lib/ids";
import {
  alert as alertTable,
  apiKey as apiKeyTable,
  auditLog as auditLogTable,
  creditLedger as creditLedgerTable,
  device as deviceTable,
  deviceCommand,
  invitation as invitationTable,
  invoice as invoiceTable,
  marketingContact as marketingContactTable,
  member as memberTable,
  organization as orgTable,
  document as documentTable,
  store as storeTable,
  tenantSettings as settingsTable,
  user as userTable,
} from "./db/schema";
import { effectiveDeviceStatus } from "./device-status";
import { tenantHealthLevel, type HealthLevel } from "./tenant-health";
import { computeEcoSavings } from "./eco";
import {
  bucketsToSeries,
  dayKeys,
  monthKeys,
  computeTrend,
  buildHeatmap,
  toComparisonRows,
  type BucketCount,
  type StoreAnalytics,
  type StoreComparisonRow,
} from "./analytics";
import { computeAlerts, STALE_MINUTES, STUCK_PENDING_MINUTES, INACTIVE_DAYS, type HealthAlert } from "./health";
import { type DocumentFilters, PAGE_SIZE } from "./documents-search";
import { presignedGetUrl } from "./storage";
import { resolveBrandTokens } from "./color";
import { ianaToPosix } from "./posix-tz";
import { normalizePrinterConfig, PRINTER_SCREENS, type PrinterConfig } from "./printer-layout";
import { computeConfigVersion, etagMatches } from "@/lib/device-config";
import { normalizeDeviceSettings } from "@/lib/device-settings";
import { rollupByDevice } from "@/lib/credit-usage";
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
import type { ApiDocumentRow } from "@/lib/api/serialize";

// ============================================================================
// Internal: load an org's bounded metadata + SQL-aggregated document rollups,
// then build view-models from the bundle. The unbounded per-document rows are
// NEVER pulled into app memory — only GROUP BY aggregates (per-device today/
// month counts, and per-day/per-month series buckets). A super-admin page is
// therefore O(devices + buckets) per org, not O(all documents on the platform).
// ============================================================================

interface OrgBundle {
  org: typeof orgTable.$inferSelect;
  settings: typeof settingsTable.$inferSelect | undefined;
  stores: (typeof storeTable.$inferSelect)[];
  devices: (typeof deviceTable.$inferSelect)[];
  /** documents-per-device, today / this-month (UTC), from SQL GROUP BY. */
  todayByDevice: Map<string, number>;
  monthByDevice: Map<string, number>;
  /** day-key ("YYYY-MM-DD", last 30d) / month-key ("YYYY-MM", last 9mo) counts. */
  dailyBuckets: BucketCount[];
  monthlyBuckets: BucketCount[];
  contact: { name: string; email: string; phone: string };
}

async function loadOrg(organizationId: string): Promise<OrgBundle | null> {
  const [org] = await db
    .select()
    .from(orgTable)
    .where(eq(orgTable.id, organizationId))
    .limit(1);
  if (!org) return null;

  // UTC boundaries. today/month reuse the exact startOfToday/startOfMonth
  // definitions; since30/since9mo are the lower bounds of the 30-day / 9-month
  // key windows (dayKeys/monthKeys) so the series GROUP BY scans only the window.
  const now = new Date();
  const todayStartStr = new Date(startOfToday()).toISOString();
  const monthStartStr = new Date(startOfMonth()).toISOString();
  const since30Str = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29),
  ).toISOString();
  const since9moStr = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 8, 1),
  ).toISOString();

  // created_at is `timestamp` (no tz) storing UTC wall-clock. Comparing it to an
  // ISO string cast to ::timestamp is a pure wall-clock (UTC) comparison with no
  // server-timezone coercion — byte-for-byte equivalent to the old in-memory
  // `createdAt.getTime() >= startOf*()` epoch test, and the same cast the cursor
  // pagination relies on. date_trunc likewise buckets the stored UTC wall-clock,
  // matching the JS `toISOString()`/`getUTC*` bucketing it replaces.
  const dayExpr = sql<string>`to_char(date_trunc('day', ${documentTable.createdAt}), 'YYYY-MM-DD')`;
  const monthExpr = sql<string>`to_char(date_trunc('month', ${documentTable.createdAt}), 'YYYY-MM')`;
  const orgScoped = (sinceStr: string) =>
    and(
      eq(documentTable.organizationId, organizationId),
      sql`${documentTable.createdAt} >= ${sinceStr}::timestamp`,
    );

  const [
    settings,
    stores,
    devices,
    deviceCountRows,
    dailyBuckets,
    monthlyBuckets,
    ownerRows,
  ] = await Promise.all([
    db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.organizationId, organizationId))
      .limit(1)
      .then((r) => r[0]),
    db.select().from(storeTable).where(eq(storeTable.organizationId, organizationId)),
    db.select().from(deviceTable).where(eq(deviceTable.organizationId, organizationId)),
    // Per-device today + this-month counts in one grouped pass. The query is
    // lower-bounded at month-start; today ⊆ month, so the today FILTER is a
    // strict subset and `count(*)` is exactly the month count for each device.
    db
      .select({
        deviceId: documentTable.deviceId,
        today: sql<number>`count(*) FILTER (WHERE ${documentTable.createdAt} >= ${todayStartStr}::timestamp)`.mapWith(
          Number,
        ),
        month: sql<number>`count(*)`.mapWith(Number),
      })
      .from(documentTable)
      .where(orgScoped(monthStartStr))
      .groupBy(documentTable.deviceId),
    db
      .select({ bucket: dayExpr, count: count() })
      .from(documentTable)
      .where(orgScoped(since30Str))
      .groupBy(dayExpr),
    db
      .select({ bucket: monthExpr, count: count() })
      .from(documentTable)
      .where(orgScoped(since9moStr))
      .groupBy(monthExpr),
    db
      .select({ name: userTable.name, email: userTable.email, role: memberTable.role })
      .from(memberTable)
      .innerJoin(userTable, eq(memberTable.userId, userTable.id))
      .where(eq(memberTable.organizationId, organizationId)),
  ]);

  // Mirror the old per-document loop: a device appears in monthByDevice when it
  // has ≥1 document this month, in todayByDevice when it has ≥1 today; absent
  // devices read back as 0 via `?? 0` in mapDevice. (count(*) here is ≥1.)
  const todayByDevice = new Map<string, number>();
  const monthByDevice = new Map<string, number>();
  for (const r of deviceCountRows) {
    // deviceId is nullable (cloud-ingested documents have no device); those rows
    // don't belong to any device bucket, so skip them.
    if (!r.deviceId) continue;
    monthByDevice.set(r.deviceId, r.month);
    if (r.today) todayByDevice.set(r.deviceId, r.today);
  }

  const owner =
    ownerRows.find((m) => m.role === "owner") ?? ownerRows[0] ?? null;

  return {
    org,
    settings,
    stores,
    devices,
    todayByDevice,
    monthByDevice,
    dailyBuckets,
    monthlyBuckets,
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

// Bucketing is UTC everywhere (matches the SQL date_trunc/extract used by the
// per-store analytics in getStoreAnalytics/getStoresAnalytics), so "today" and
// "this month" agree across every surface regardless of server timezone.
function startOfToday(): number {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
}
function startOfMonth(): number {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1);
}

/** First instant of the current month, UTC — for analytics "this month" windows. */
export function currentMonthStart(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
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
  const todayBy = b.todayByDevice;
  const monthBy = b.monthByDevice;
  const price = dollars(b.settings?.perPrintPriceCents ?? 4);

  const stores: Store[] = b.stores.map((s) => ({
    id: s.id,
    tenantId: b.org.id,
    name: s.name,
    address: s.address,
    timezone: s.timezone,
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
    lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
    documentsToday: todayBy.get(d.id) ?? 0,
    documentsThisMonth: monthBy.get(d.id) ?? 0,
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
  const documentsThisMonth = allDevices.reduce(
    (a, d) => a + d.documentsThisMonth,
    0,
  );
  const now = new Date();
  let onlineCount = 0;
  let offlineCount = 0;
  for (const d of allDevices) {
    const eff = effectiveDeviceStatus(d.status, d.lastSeenAt ? new Date(d.lastSeenAt) : null, now);
    if (eff === "online") onlineCount++;
    else if (eff === "offline") offlineCount++;
  }
  const health = tenantHealthLevel(
    {
      deviceCount: allDevices.length,
      onlineCount,
      offlineCount,
      subscriptionStatus: b.settings?.subscriptionStatus ?? null,
    },
    now,
  );
  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    storeCount: tenant.stores.length,
    deviceCount: allDevices.length,
    onlineCount,
    offlineCount,
    documentsThisMonth,
    revenueThisMonth:
      Math.round(documentsThisMonth * tenant.perPrintPrice * 100) / 100,
    perPrintPrice: tenant.perPrintPrice,
    health,
  };
}

// ---- time series from SQL-aggregated document buckets ------------------------
// The bundle already holds GROUP BY counts keyed "YYYY-MM-DD" / "YYYY-MM" (UTC,
// via date_trunc). bucketsToSeries joins them onto the ordered day/month keys —
// the same join the per-store analytics (getStoreAnalytics/getStoresAnalytics)
// use, so org-wide and per-store series can never drift apart. Buckets outside
// the key window are simply not joined (identical to the old all-documents path,
// which bucketed everything then dropped out-of-window keys).

function dailySeries(b: OrgBundle, price: number): TimePoint[] {
  return bucketsToSeries(b.dailyBuckets, dayKeys(new Date(), 30), price);
}

function monthlySeries(b: OrgBundle, price: number): TimePoint[] {
  return bucketsToSeries(b.monthlyBuckets, monthKeys(new Date(), 9), price);
}

function sumSeries(all: TimePoint[][]): TimePoint[] {
  if (all.length === 0) return [];
  return all[0].map((_, i) => ({
    label: all[0][i].label,
    documents: all.reduce((a, s) => a + s[i].documents, 0),
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
  documentsToday: number;
  documentsThisMonth: number;
  activeDevices: number;
  totalDevices: number;
  eco: ReturnType<typeof computeEcoSavings>;
  ecoYtdDocuments: number;
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
  const documentsToday = devices.reduce((a, d) => a + d.documentsToday, 0);
  const documentsThisMonth = devices.reduce((a, d) => a + d.documentsThisMonth, 0);
  const activeDevices = devices.filter((d) => d.status === "online").length;
  const ecoYtdDocuments = Math.round(documentsThisMonth * 7.4);

  return {
    tenant,
    documentsToday,
    documentsThisMonth,
    activeDevices,
    totalDevices: devices.length,
    eco: computeEcoSavings(documentsThisMonth),
    ecoYtdDocuments,
    ecoYtd: computeEcoSavings(ecoYtdDocuments),
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
    timezone: s.timezone,
    deviceCount: s.devices.length,
    onlineCount: s.devices.filter((d) => d.status === "online").length,
    documentsThisMonth: s.devices.reduce((a, d) => a + d.documentsThisMonth, 0),
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

/**
 * Per-store analytics: daily/monthly document series, this-vs-last-month trend,
 * revenue + eco for this month, and busiest day-of-week / peak hour. Returns the
 * store too so the page can render without a second lookup. null if not found.
 */
export async function getStoreAnalytics(
  storeId: string,
): Promise<{ store: Store; analytics: StoreAnalytics } | null> {
  const result = await getStore(storeId);
  if (!result) return null;
  const { store, tenant } = result;
  const price = tenant.perPrintPrice;
  const now = new Date();

  const since30 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
  const since9mo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 8, 1));
  const since90 = new Date(now.getTime() - 90 * 86_400_000);

  const dayExpr = sql<string>`to_char(date_trunc('day', ${documentTable.createdAt}), 'YYYY-MM-DD')`;
  const monthExpr = sql<string>`to_char(date_trunc('month', ${documentTable.createdAt}), 'YYYY-MM')`;
  // created_at is `timestamp` (no tz) storing UTC wall-clock, so re-anchor to UTC
  // before converting to the store's local zone — the double AT TIME ZONE is required.
  const localTs = sql`((${documentTable.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE ${store.timezone})`;
  const dowExpr = sql<number>`extract(dow from ${localTs})::int`;
  const hourExpr = sql<number>`extract(hour from ${localTs})::int`;
  const scoped = (since: Date) =>
    and(eq(documentTable.storeId, storeId), gte(documentTable.createdAt, since));

  const [dailyRows, monthlyRows, gridRows] = await Promise.all([
    db.select({ bucket: dayExpr, count: count() }).from(documentTable).where(scoped(since30)).groupBy(dayExpr),
    db.select({ bucket: monthExpr, count: count() }).from(documentTable).where(scoped(since9mo)).groupBy(monthExpr),
    db.select({ dow: dowExpr, hour: hourExpr, count: count() }).from(documentTable).where(scoped(since90)).groupBy(sql`1`, sql`2`),
  ]);

  const daily = bucketsToSeries(dailyRows, dayKeys(now, 30), price);
  const monthly = bucketsToSeries(monthlyRows, monthKeys(now, 9), price);
  const thisMonth = monthly[monthly.length - 1]?.documents ?? 0;
  const lastMonth = monthly[monthly.length - 2]?.documents ?? 0;

  const heatmap = buildHeatmap(gridRows);
  const analytics: StoreAnalytics = {
    daily,
    monthly,
    monthTrend: computeTrend(thisMonth, lastMonth),
    revenueThisMonth: Math.round(thisMonth * price * 100) / 100,
    eco: computeEcoSavings(thisMonth),
    peak: heatmap.peak,
    heatmap,
  };
  return { store, analytics };
}

/**
 * Cross-store comparison for the tenant Analytics page: per-store rows (documents
 * this month, trend vs last month, revenue, eco) sorted by documents, plus a
 * per-store monthly series for the comparison chart. Degrades to empty on error.
 */
export async function getStoresAnalytics(organizationId: string): Promise<{
  rows: StoreComparisonRow[];
  monthlyByStore: { storeId: string; storeName: string; monthly: TimePoint[] }[];
}> {
  try {
    const tenant = await getTenant(organizationId);
    const price = tenant.perPrintPrice;
    const stores = tenant.stores;
    if (stores.length === 0) return { rows: [], monthlyByStore: [] };

    const now = new Date();
    const since9mo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 8, 1));
    const monthExpr = sql<string>`to_char(date_trunc('month', ${documentTable.createdAt}), 'YYYY-MM')`;

    const perStoreMonth = await db
      .select({ storeId: documentTable.storeId, bucket: monthExpr, count: count() })
      .from(documentTable)
      .where(and(eq(documentTable.organizationId, organizationId), gte(documentTable.createdAt, since9mo)))
      .groupBy(documentTable.storeId, monthExpr);

    const keys = monthKeys(now, 9);
    const thisKey = keys[keys.length - 1].key;
    const lastKey = keys[keys.length - 2].key;

    const rows = toComparisonRows(
      stores.map((s) => ({
        storeId: s.id,
        storeName: s.name,
        current: perStoreMonth.find((r) => r.storeId === s.id && r.bucket === thisKey)?.count ?? 0,
        previous: perStoreMonth.find((r) => r.storeId === s.id && r.bucket === lastKey)?.count ?? 0,
        price,
      })),
    );

    const monthlyByStore = stores.map((s) => ({
      storeId: s.id,
      storeName: s.name,
      monthly: bucketsToSeries(
        perStoreMonth.filter((r) => r.storeId === s.id).map((r) => ({ bucket: r.bucket, count: r.count })),
        keys,
        price,
      ),
    }));

    return { rows, monthlyByStore };
  } catch (err) {
    console.error("[data] getStoresAnalytics failed", err);
    return { rows: [], monthlyByStore: [] };
  }
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
  const now = new Date();
  for (const b of bundles) {
    const tenant = buildTenant(b);
    for (const store of tenant.stores) {
      for (const device of store.devices) {
        rows.push({
          ...device,
          status: effectiveDeviceStatus(
            device.status,
            device.lastSeenAt ? new Date(device.lastSeenAt) : null,
            now,
          ),
          tenantName: tenant.name,
          storeName: store.name,
        });
      }
    }
  }
  return rows;
}

export interface AdminOverview {
  mrr: number;
  documentsThisMonth: number;
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
    documentsThisMonth: summaries.reduce((a, s) => a + s.documentsThisMonth, 0),
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
  health: {
    level: HealthLevel;
    online: number;
    offline: number;
    paused: number;
    stuckPendingCount: number;
    subscriptionStatus: string | null;
  };
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
  const now = new Date();

  // Apply effective status locally (mapDevice stays raw globally).
  const devices: DeviceRow[] = tenant.stores.flatMap((store) =>
    store.devices.map((d) => ({
      ...d,
      status: effectiveDeviceStatus(d.status, d.lastSeenAt ? new Date(d.lastSeenAt) : null, now),
      tenantName: tenant.name,
      storeName: store.name,
    })),
  );
  let online = 0, offline = 0, paused = 0;
  for (const d of devices) {
    if (d.status === "online") online++;
    else if (d.status === "offline") offline++;
    else if (d.status === "paused") paused++;
  }

  const stuckCutoff = new Date(now.getTime() - STUCK_PENDING_MINUTES * 60_000);
  const [{ stuck }] = await db
    .select({ stuck: sql<number>`count(*)::int` })
    .from(documentTable)
    .where(
      and(
        eq(documentTable.organizationId, organizationId),
        eq(documentTable.status, "pending"),
        lt(documentTable.createdAt, stuckCutoff),
      ),
    );
  const [{ last }] = await db
    .select({ last: max(documentTable.createdAt) })
    .from(documentTable)
    .where(eq(documentTable.organizationId, organizationId));

  const subscriptionStatus = b.settings?.subscriptionStatus ?? null;
  const level = tenantHealthLevel(
    {
      deviceCount: devices.length,
      onlineCount: online,
      offlineCount: offline,
      subscriptionStatus,
      stuckPendingCount: stuck,
      lastActivityAt: last ?? null,
    },
    now,
  );

  return {
    tenant,
    summary,
    devices,
    health: { level, online, offline, paused, stuckPendingCount: stuck, subscriptionStatus },
    monthly: monthlySeries(b, tenant.perPrintPrice),
    invoices: await getInvoices(organizationId),
    eco: computeEcoSavings(summary.documentsThisMonth),
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
    documents: row.documentCount,
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
  /** Printer theme tokens (bg/fg/muted resolved with defaults when unset). */
  brandBg: string;
  brandFg: string;
  brandMuted: string;
  /** Normalized v3 printer config (uploaded icon + image keys are presigned for display). */
  printerConfig: PrinterConfig;
  staffPin: string;
  supportEmail: string | null;
  supportUrl: string | null;
  returnWindowDays: number | null;
  warrantyPeriodMonths: number | null;
}

export async function getTenantBranding(
  organizationId: string,
): Promise<TenantBranding> {
  const [s] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.organizationId, organizationId))
    .limit(1);

  // Prefer v3 printerScreens; fall back to migrating the legacy printerLayout.
  const config = normalizePrinterConfig(s?.printerScreens ?? s?.printerLayout);

  // QR duration is owned by the Device Settings page (qrVisibleSeconds column).
  // Overlay it so the Branding preview's countdown reflects the canonical value.
  config.qrTimeoutSeconds = normalizeDeviceSettings({ qrVisibleSeconds: s?.qrVisibleSeconds }).qrVisibleSeconds;

  // Presign every uploaded icon + image key across all screens (collect → presign → map back).
  const assetKeys = new Set<string>();
  for (const screen of PRINTER_SCREENS) {
    for (const o of config.screens[screen].objects) {
      if (o.type === "icon" && o.icon?.source === "upload" && o.icon.url) assetKeys.add(o.icon.url);
      if (o.type === "image" && o.image?.url) assetKeys.add(o.image.url);
    }
  }
  const signed = new Map<string, string>();
  await Promise.all([...assetKeys].map(async (k) => signed.set(k, await presignedGetUrl(k))));
  for (const screen of PRINTER_SCREENS) {
    for (const o of config.screens[screen].objects) {
      if (o.type === "icon" && o.icon?.source === "upload" && o.icon.url) {
        o.icon = { ...o.icon, signedUrl: signed.get(o.icon.url) ?? undefined };
      }
      if (o.type === "image" && o.image?.url) {
        o.image = { ...o.image, signedUrl: signed.get(o.image.url) ?? undefined };
      }
    }
  }

  const brandColor = s?.brandColor ?? "#10A765";
  const tokens = resolveBrandTokens(brandColor, {
    bg: s?.brandBg,
    fg: s?.brandFg,
    muted: s?.brandMuted,
  });
  return {
    brandColor,
    brandBg: tokens.bg,
    brandFg: tokens.fg,
    brandMuted: tokens.muted,
    printerConfig: config,
    staffPin: s?.staffPin ?? "",
    supportEmail: s?.supportEmail ?? null,
    supportUrl: s?.supportUrl ?? null,
    returnWindowDays: s?.returnWindowDays ?? null,
    warrantyPeriodMonths: s?.warrantyPeriodMonths ?? null,
  };
}

export interface TenantDeviceSettings {
  qrVisibleSeconds: number;
  screenBrightness: number;
  screenSleepEnabled: boolean;
  screenSleepTimeoutSeconds: number;
  hasPassword: boolean;
}

/** View model for the tenant Device Settings page. Never exposes the PIN hash. */
export async function getTenantDeviceSettings(
  organizationId: string,
): Promise<TenantDeviceSettings> {
  const [s] = await db
    .select({
      qrVisibleSeconds: settingsTable.qrVisibleSeconds,
      screenBrightness: settingsTable.screenBrightness,
      screenSleepEnabled: settingsTable.screenSleepEnabled,
      screenSleepTimeoutSeconds: settingsTable.screenSleepTimeoutSeconds,
      deviceSettingsPasswordHash: settingsTable.deviceSettingsPasswordHash,
    })
    .from(settingsTable)
    .where(eq(settingsTable.organizationId, organizationId))
    .limit(1);

  const ds = normalizeDeviceSettings({
    qrVisibleSeconds: s?.qrVisibleSeconds,
    screenBrightness: s?.screenBrightness,
    screenSleepEnabled: s?.screenSleepEnabled,
    screenSleepTimeoutSeconds: s?.screenSleepTimeoutSeconds,
  });
  return { ...ds, hasPassword: !!s?.deviceSettingsPasswordHash };
}

/** Payload served to a device over GET /api/device/config (icons + images presigned). */
export interface DeviceConfigPayload {
  version: string;
  brandColor: string;
  brandBg: string;
  brandFg: string;
  brandMuted: string;
  wordmark: string; // brand wordmark text (= organization name) for the logo widget
  config: PrinterConfig; // uploaded icon + image keys presigned for rendering
  device: {
    brightness: number; // 10..100
    sleep: { enabled: boolean; timeoutSeconds: number };
    settingsPasswordHash: string | null;
    settingsPasswordSalt: string | null;
  };
}

/**
 * Resolve a device's display config + a stable version/ETag. Computes the version
 * from STORED inputs first so an If-None-Match hit can short-circuit (304) BEFORE
 * doing any presigning work.
 */
export async function getDeviceConfig(
  organizationId: string,
  ifNoneMatch?: string | null,
): Promise<{ version: string; notModified: boolean; payload: DeviceConfigPayload | null }> {
  const [s] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.organizationId, organizationId))
    .limit(1);

  const [org] = await db
    .select({ name: orgTable.name })
    .from(orgTable)
    .where(eq(orgTable.id, organizationId))
    .limit(1);
  const organizationName = org?.name ?? "";

  const ds = normalizeDeviceSettings({
    qrVisibleSeconds: s?.qrVisibleSeconds,
    screenBrightness: s?.screenBrightness,
    screenSleepEnabled: s?.screenSleepEnabled,
    screenSleepTimeoutSeconds: s?.screenSleepTimeoutSeconds,
  });

  const version = computeConfigVersion({
    printerScreens: s?.printerScreens ?? null,
    printerLayout: s?.printerLayout ?? null,
    organizationName,
    brandColor: s?.brandColor ?? null,
    brandBg: s?.brandBg ?? null,
    brandFg: s?.brandFg ?? null,
    brandMuted: s?.brandMuted ?? null,
    qrVisibleSeconds: ds.qrVisibleSeconds,
    screenBrightness: ds.screenBrightness,
    screenSleepEnabled: ds.screenSleepEnabled,
    screenSleepTimeoutSeconds: ds.screenSleepTimeoutSeconds,
    settingsPasswordHash: s?.deviceSettingsPasswordHash ?? null,
  });

  if (etagMatches(ifNoneMatch, version)) {
    return { version, notModified: true, payload: null };
  }

  const config = normalizePrinterConfig(s?.printerScreens ?? s?.printerLayout);

  // Presign uploaded icon + image keys across all screens (collect → presign → map back).
  const assetKeys = new Set<string>();
  for (const screen of PRINTER_SCREENS) {
    for (const o of config.screens[screen].objects) {
      if (o.type === "icon" && o.icon?.source === "upload" && o.icon.url) assetKeys.add(o.icon.url);
      if (o.type === "image" && o.image?.url) assetKeys.add(o.image.url);
    }
  }
  const signed = new Map<string, string>();
  await Promise.all([...assetKeys].map(async (k) => signed.set(k, await presignedGetUrl(k))));
  for (const screen of PRINTER_SCREENS) {
    for (const o of config.screens[screen].objects) {
      if (o.type === "icon" && o.icon?.source === "upload" && o.icon.url) {
        o.icon = { ...o.icon, signedUrl: signed.get(o.icon.url) ?? undefined };
      }
      if (o.type === "image" && o.image?.url) {
        o.image = { ...o.image, signedUrl: signed.get(o.image.url) ?? undefined };
      }
    }
  }

  // The device's libc needs a POSIX TZ string (not the stored IANA name) to apply
  // DST. Convert here; the editor keeps storing IANA. computeConfigVersion (above)
  // is keyed on the stored IANA value, so the ETag stays stable.
  config.clockTimezone = ianaToPosix(config.clockTimezone);

  // QR duration's source of truth is now the qrVisibleSeconds column; overlay it.
  config.qrTimeoutSeconds = ds.qrVisibleSeconds;

  const brandColor = s?.brandColor ?? "#10A765";
  const tokens = resolveBrandTokens(brandColor, { bg: s?.brandBg, fg: s?.brandFg, muted: s?.brandMuted });

  return {
    version,
    notModified: false,
    payload: {
      version,
      brandColor,
      brandBg: tokens.bg,
      brandFg: tokens.fg,
      brandMuted: tokens.muted,
      wordmark: organizationName,
      config,
      device: {
        brightness: ds.screenBrightness,
        sleep: { enabled: ds.screenSleepEnabled, timeoutSeconds: ds.screenSleepTimeoutSeconds },
        settingsPasswordHash: s?.deviceSettingsPasswordHash ?? null,
        settingsPasswordSalt: s?.deviceSettingsPasswordSalt ?? null,
      },
    },
  };
}

/**
 * Enqueue a config-changed command for EVERY device in an org so they re-pull
 * GET /api/device/config promptly after a branding change. No-op if the org has
 * no devices.
 */
export async function enqueueConfigChangedForOrg(
  organizationId: string,
  createdByUserId: string | null,
): Promise<void> {
  const devices = await db
    .select({ id: deviceTable.id })
    .from(deviceTable)
    .where(eq(deviceTable.organizationId, organizationId));
  if (devices.length === 0) return;
  await db.insert(deviceCommand).values(
    devices.map((d) => ({
      id: genId("cmd"),
      deviceId: d.id,
      organizationId,
      type: "config-changed" as const,
      createdByUserId: createdByUserId ?? undefined,
    })),
  );
}

// Device provisioning helpers live in lib/documents.ts (claimDevice,
// getUnclaimedDevices) — re-exported here so callers have one data entrypoint.
export { claimDevice, getUnclaimedDevices } from "./documents";

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
      documentCount: i.documentCount,
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
    actorType: r.actorType,
    actor: r.actorLabel ?? r.actorType,
    target: r.targetType && r.targetId ? `${r.targetType}:${r.targetId}` : null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    at: r.createdAt.toISOString(),
  }));
}

export async function getOrgAuditPage(
  organizationId: string,
  page: number,
  pageSize = 25,
): Promise<{
  rows: {
    id: string;
    action: string;
    actorType: string;
    actor: string;
    target: string | null;
    metadata: Record<string, unknown> | null;
    at: string;
  }[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}> {
  const requestedPage = Math.max(1, Math.floor(page) || 1);
  const [{ total }] = await db
    .select({ total: count() })
    .from(auditLogTable)
    .where(eq(auditLogTable.organizationId, organizationId));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Clamp into the valid range so an over-range ?page= shows the last page with
  // data (not an empty table reading "Page 99 of 2").
  const safePage = Math.min(requestedPage, pageCount);

  const rows = await db
    .select()
    .from(auditLogTable)
    .where(eq(auditLogTable.organizationId, organizationId))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorType: r.actorType,
      actor: r.actorLabel ?? r.actorType,
      target: r.targetType && r.targetId ? `${r.targetType}:${r.targetId}` : null,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      at: r.createdAt.toISOString(),
    })),
    total,
    page: safePage,
    pageSize,
    pageCount,
  };
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

export interface DocumentListRow {
  id: string;
  token: string;
  status: "pending" | "ready" | "downloaded";
  storeName: string | null;
  deviceName: string | null;
  createdAt: string;
  byteSize: number;
}

/** Build the WHERE conditions shared by the list + count queries. */
function documentConditions(f: DocumentFilters) {
  const c = [];
  if (f.organizationId) c.push(eq(documentTable.organizationId, f.organizationId));
  if (f.storeId) c.push(eq(documentTable.storeId, f.storeId));
  if (f.deviceId) c.push(eq(documentTable.deviceId, f.deviceId));
  if (f.status) c.push(eq(documentTable.status, f.status));
  if (f.from) c.push(gte(documentTable.createdAt, f.from));
  if (f.to) c.push(lte(documentTable.createdAt, f.to));
  if (f.token) c.push(eq(documentTable.token, f.token));
  return c;
}

/** Filterable, paginated document search (tenant: pass organizationId; admin: omit). */
export async function searchDocuments(
  f: DocumentFilters,
): Promise<{ rows: DocumentListRow[]; total: number }> {
  const conds = documentConditions(f);
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: documentTable.id,
      token: documentTable.token,
      status: documentTable.status,
      storeName: storeTable.name,
      deviceName: deviceTable.name,
      createdAt: documentTable.createdAt,
      byteSize: documentTable.byteSize,
    })
    .from(documentTable)
    .leftJoin(storeTable, eq(documentTable.storeId, storeTable.id))
    .leftJoin(deviceTable, eq(documentTable.deviceId, deviceTable.id))
    .where(where)
    .orderBy(desc(documentTable.createdAt))
    .limit(PAGE_SIZE)
    .offset((f.page - 1) * PAGE_SIZE);

  const [{ total }] = await db
    .select({ total: count() })
    .from(documentTable)
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

/** One document + a fresh presigned image URL. Read-only — never flips status. */
export async function getDocumentDetail(
  documentId: string,
  opts: { organizationId?: string },
) {
  const conds = [eq(documentTable.id, documentId)];
  if (opts.organizationId) conds.push(eq(documentTable.organizationId, opts.organizationId));
  const [r] = await db
    .select({
      id: documentTable.id,
      token: documentTable.token,
      status: documentTable.status,
      storageKey: documentTable.storageKey,
      byteSize: documentTable.byteSize,
      createdAt: documentTable.createdAt,
      downloadedAt: documentTable.downloadedAt,
      storeName: storeTable.name,
      deviceName: deviceTable.name,
      storeId: documentTable.storeId,
      deviceId: documentTable.deviceId,
    })
    .from(documentTable)
    .leftJoin(storeTable, eq(documentTable.storeId, storeTable.id))
    .leftJoin(deviceTable, eq(documentTable.deviceId, deviceTable.id))
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
    storeId: r.storeId,
    deviceId: r.deviceId,
  };
}

/** Stores + devices for an org, for the tenant filter dropdowns. */
export async function getDocumentFilterOptions(organizationId: string) {
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
    inactiveTenants: { id: string; name: string; lastDocumentAt: string | null }[];
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
    const devRows = await db
      .select({ status: deviceTable.status, lastSeenAt: deviceTable.lastSeenAt })
      .from(deviceTable);
    const byStatus = { online: 0, offline: 0, paused: 0 } as Record<string, number>;
    for (const d of devRows) {
      byStatus[effectiveDeviceStatus(d.status, d.lastSeenAt, now)] += 1;
    }
    const total = devRows.length;

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

    const [{ last1h }] = await db.select({ last1h: count() }).from(documentTable).where(gte(documentTable.createdAt, h1));
    const [{ last24h }] = await db.select({ last24h: count() }).from(documentTable).where(gte(documentTable.createdAt, h24));
    const breakdownRows = await db
      .select({ status: documentTable.status, c: count() })
      .from(documentTable)
      .where(gte(documentTable.createdAt, h24))
      .groupBy(documentTable.status);
    const breakdown = { ready: 0, downloaded: 0, pending: 0 } as Record<string, number>;
    for (const r of breakdownRows) breakdown[r.status] = Number(r.c);
    const [{ stuckPending }] = await db
      .select({ stuckPending: count() })
      .from(documentTable)
      .where(and(eq(documentTable.status, "pending"), lt(documentTable.createdAt, stuckCut)));

    const topRows = await db
      .select({ id: orgTable.id, name: orgTable.name, c: count() })
      .from(documentTable)
      .innerJoin(orgTable, eq(documentTable.organizationId, orgTable.id))
      .where(gte(documentTable.createdAt, h24))
      .groupBy(orgTable.id, orgTable.name)
      .orderBy(desc(count()))
      .limit(5);
    const topTenants = topRows.map((r) => ({ id: r.id, name: r.name, count: Number(r.c) }));

    const allOrgs = await db.select({ id: orgTable.id, name: orgTable.name }).from(orgTable);
    // One row per org (max createdAt) — avoids reading the whole document table.
    const lastRows = await db
      .select({ org: documentTable.organizationId, last: max(documentTable.createdAt) })
      .from(documentTable)
      .groupBy(documentTable.organizationId);
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
        lastDocumentAt: lastByOrg.get(o.id)?.toISOString() ?? null,
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

/**
 * The exact input `computeAlerts` needs, queried fresh. Standalone (the cron
 * evaluator calls this without loading the full health dashboard). Mirrors the
 * predicates getPlatformHealth uses so both produce the same alerts.
 */
export async function getAlertInputs(): Promise<{
  staleCount: number;
  stuckPendingCount: number;
  inactiveTenants: { id: string; name: string }[];
}> {
  const now = new Date();
  const staleCut = new Date(now.getTime() - STALE_MINUTES * 60_000);
  const stuckCut = new Date(now.getTime() - STUCK_PENDING_MINUTES * 60_000);
  const inactiveCut = new Date(now.getTime() - INACTIVE_DAYS * 24 * 60 * 60_000);

  const [{ staleCount }] = await db
    .select({ staleCount: count() })
    .from(deviceTable)
    .where(
      and(
        isNotNull(deviceTable.lastSeenAt),
        lt(deviceTable.lastSeenAt, staleCut),
        ne(deviceTable.status, "paused"),
      ),
    );
  const [{ stuckPendingCount }] = await db
    .select({ stuckPendingCount: count() })
    .from(documentTable)
    .where(and(eq(documentTable.status, "pending"), lt(documentTable.createdAt, stuckCut)));

  const allOrgs = await db.select({ id: orgTable.id, name: orgTable.name }).from(orgTable);
  const lastRows = await db
    .select({ org: documentTable.organizationId, last: max(documentTable.createdAt) })
    .from(documentTable)
    .groupBy(documentTable.organizationId);
  const lastByOrg = new Map<string, Date>();
  for (const r of lastRows) if (r.last) lastByOrg.set(r.org, r.last);
  const inactiveTenants = allOrgs
    .filter((o) => {
      const last = lastByOrg.get(o.id);
      return !last || last < inactiveCut;
    })
    .map((o) => ({ id: o.id, name: o.name }));

  return {
    staleCount: Number(staleCount),
    stuckPendingCount: Number(stuckPendingCount),
    inactiveTenants,
  };
}

export interface AlertRow {
  id: string;
  key: string;
  severity: string;
  message: string;
  firstSeenAt: string;
  resolvedAt: string | null;
  notifiedAt: string | null;
}

/** Open alerts + alerts resolved in the last 7 days, for the health page. */
export async function getAlertHistory(): Promise<{ open: AlertRow[]; resolved: AlertRow[] }> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const toRow = (r: typeof alertTable.$inferSelect): AlertRow => ({
      id: r.id,
      key: r.key,
      severity: r.severity,
      message: r.message,
      firstSeenAt: r.firstSeenAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      notifiedAt: r.notifiedAt ? r.notifiedAt.toISOString() : null,
    });
    const openRows = await db
      .select()
      .from(alertTable)
      .where(eq(alertTable.status, "open"))
      .orderBy(desc(alertTable.firstSeenAt));
    const resolvedRows = await db
      .select()
      .from(alertTable)
      .where(and(eq(alertTable.status, "resolved"), gte(alertTable.resolvedAt, sevenDaysAgo)))
      .orderBy(desc(alertTable.resolvedAt))
      .limit(25);
    return { open: openRows.map(toRow), resolved: resolvedRows.map(toRow) };
  } catch (err) {
    console.error("[health] getAlertHistory failed", err);
    return { open: [], resolved: [] };
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

// ============================================================================
// API keys
// ============================================================================

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** Non-secret API key listing for the management UI (never returns keyHash). */
export async function getApiKeys(organizationId: string): Promise<ApiKeyRow[]> {
  const rows = await db
    .select({
      id: apiKeyTable.id,
      name: apiKeyTable.name,
      prefix: apiKeyTable.prefix,
      lastUsedAt: apiKeyTable.lastUsedAt,
      createdAt: apiKeyTable.createdAt,
      revokedAt: apiKeyTable.revokedAt,
    })
    .from(apiKeyTable)
    .where(eq(apiKeyTable.organizationId, organizationId))
    .orderBy(desc(apiKeyTable.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  }));
}

// ============================================================================
// Public API v1 — cursor document list + usage aggregate
// ============================================================================

export interface ApiDocumentFilters {
  organizationId: string;
  storeId?: string;
  deviceId?: string;
  status?: "pending" | "ready" | "downloaded";
  createdAfter?: Date;
  createdBefore?: Date;
  token?: string;
  limit: number;            // pass desired+1 to detect a next page
  cursor?: { t: Date; id: string };
}

/** Keyset (cursor) document list for /api/v1, newest first. Org-scoped. */
export async function listDocumentsByCursor(f: ApiDocumentFilters): Promise<ApiDocumentRow[]> {
  const conds = [eq(documentTable.organizationId, f.organizationId)];
  if (f.storeId) conds.push(eq(documentTable.storeId, f.storeId));
  if (f.deviceId) conds.push(eq(documentTable.deviceId, f.deviceId));
  if (f.status) conds.push(eq(documentTable.status, f.status));
  if (f.createdAfter) conds.push(gte(documentTable.createdAt, f.createdAfter));
  if (f.createdBefore) conds.push(lte(documentTable.createdAt, f.createdBefore));
  if (f.token) conds.push(eq(documentTable.token, f.token));
  if (f.cursor) {
    // document.created_at is `timestamp without time zone`. Drizzle sends a JS Date
    // as a `timestamptz` parameter; Postgres then coerces it to `timestamp` using
    // the server's local timezone, shifting the value and breaking the boundary
    // exclusion. Fix: supply the cursor as an explicit `::timestamp` cast from the
    // ISO-8601 UTC string so no timezone conversion is applied. id is the strict
    // unique tiebreaker for rows that share the same millisecond.
    const tStr = f.cursor.t.toISOString(); // e.g. "2026-06-06T12:22:47.610Z"
    conds.push(
      sql`(${documentTable.createdAt}, ${documentTable.id}) < (${tStr}::timestamp, ${f.cursor.id})`,
    );
  }

  const rows = await db
    .select({
      id: documentTable.id,
      token: documentTable.token,
      status: documentTable.status,
      storeId: documentTable.storeId,
      deviceId: documentTable.deviceId,
      byteSize: documentTable.byteSize,
      createdAt: documentTable.createdAt,
    })
    .from(documentTable)
    .where(and(...conds))
    .orderBy(desc(documentTable.createdAt), desc(documentTable.id))
    .limit(f.limit);

  return rows;
}

export interface ApiUsageData {
  unitPriceCents: number;
  documentsThisMonth: number;
  currentPeriod: { start: string; end: string; documentCount: number; amountDueCents: number };
  daily: { date: string; documents: number }[];
  monthly: { month: string; documents: number }[];
}

/** Machine-keyed usage for /api/v1/usage (integer cents, UTC buckets). */
export async function getApiUsage(organizationId: string): Promise<ApiUsageData> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const since30 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
  const since12mo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

  const dayExpr = sql<string>`to_char(date_trunc('day', ${documentTable.createdAt}), 'YYYY-MM-DD')`;
  const monthExpr = sql<string>`to_char(date_trunc('month', ${documentTable.createdAt}), 'YYYY-MM')`;
  const orgScope = (since: Date) => and(eq(documentTable.organizationId, organizationId), gte(documentTable.createdAt, since));

  const [settingsRow] = await db
    .select({ price: settingsTable.perPrintPriceCents })
    .from(settingsTable)
    .where(eq(settingsTable.organizationId, organizationId))
    .limit(1);
  const unitPriceCents = settingsRow?.price ?? 4;

  const [dailyRows, monthlyRows, monthCountRows] = await Promise.all([
    db.select({ bucket: dayExpr, count: count() }).from(documentTable).where(orgScope(since30)).groupBy(dayExpr),
    db.select({ bucket: monthExpr, count: count() }).from(documentTable).where(orgScope(since12mo)).groupBy(monthExpr),
    db.select({ count: count() }).from(documentTable).where(orgScope(monthStart)),
  ]);

  const dailyMap = new Map(dailyRows.map((r) => [r.bucket, Number(r.count)]));
  const monthlyMap = new Map(monthlyRows.map((r) => [r.bucket, Number(r.count)]));
  const daily = dayKeys(now, 30).map((k) => ({ date: k.key, documents: dailyMap.get(k.key) ?? 0 }));
  const monthly = monthKeys(now, 12).map((k) => ({ month: k.key, documents: monthlyMap.get(k.key) ?? 0 }));
  const documentsThisMonth = Number(monthCountRows[0]?.count ?? 0);

  return {
    unitPriceCents,
    documentsThisMonth,
    currentPeriod: {
      start: monthStart.toISOString(),
      end: monthEnd.toISOString(),
      documentCount: documentsThisMonth,
      amountDueCents: documentsThisMonth * unitPriceCents,
    },
    daily,
    monthly,
  };
}

export async function getCreditLedger(organizationId: string, limit = 50) {
  return db
    .select({
      id: creditLedgerTable.id,
      kind: creditLedgerTable.kind,
      credits: creditLedgerTable.credits,
      deviceId: creditLedgerTable.deviceId,
      action: creditLedgerTable.action,
      note: creditLedgerTable.note,
      createdAt: creditLedgerTable.createdAt,
    })
    .from(creditLedgerTable)
    .where(eq(creditLedgerTable.organizationId, organizationId))
    .orderBy(desc(creditLedgerTable.createdAt))
    .limit(limit);
}

/** Per-device realized credit spend for a tenant (settle rows >= since). */
export async function getCreditUsageByDevice(organizationId: string, since: Date) {
  const rows = await db
    .select({ deviceId: creditLedgerTable.deviceId, credits: creditLedgerTable.credits })
    .from(creditLedgerTable)
    .where(
      and(
        eq(creditLedgerTable.organizationId, organizationId),
        eq(creditLedgerTable.kind, "settle"),
        gte(creditLedgerTable.createdAt, since),
      ),
    );
  return rollupByDevice(rows);
}

/** Platform-admin: realized credit spend grouped by org for a period. */
export async function getCreditUsageAllOrgs(since: Date) {
  return db
    .select({
      organizationId: creditLedgerTable.organizationId,
      name: orgTable.name,
      credits: sql<number>`sum(${creditLedgerTable.credits})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(creditLedgerTable)
    .leftJoin(orgTable, eq(orgTable.id, creditLedgerTable.organizationId))
    .where(and(eq(creditLedgerTable.kind, "settle"), gte(creditLedgerTable.createdAt, since)))
    .groupBy(creditLedgerTable.organizationId, orgTable.name)
    .orderBy(desc(sql`sum(${creditLedgerTable.credits})`));
}

/** Map of device id → name for an org, to label per-device credit usage. */
export async function deviceNamesForOrg(organizationId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: deviceTable.id, name: deviceTable.name })
    .from(deviceTable)
    .where(eq(deviceTable.organizationId, organizationId));
  return new Map(rows.map((r) => [r.id, r.name]));
}
