// Data layer — real Drizzle queries over Neon.
//
// Same function names + return types as the original mock layer, so screens are
// unchanged (they only gained `await`). Tenant-panel functions take an
// `organizationId` (the active tenant); super-admin functions span all orgs.
//
// DB conventions → view-model conversions happen here:
//   • money is stored in cents → exposed as dollars (invoice amount)
//   • tenant_settings.status (active|paused) → TenantStatus (active|suspended)
//   • device.lastSeenAt (Date|null) → Device.lastSeen (ISO string)
//   • activationsToday / activationsThisMonth are derived from acked device-trigger commands

import { and, count, desc, eq, gte, isNotNull, lt, max, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { id as genId } from "@/lib/ids";
import {
  alert as alertTable,
  apiKey as apiKeyTable,
  auditLog as auditLogTable,
  creditBalance as creditBalanceTable,
  creditLedger as creditLedgerTable,
  device as deviceTable,
  deviceCommand,
  factoryDevice,
  invitation as invitationTable,
  member as memberTable,
  organization as orgTable,
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
import { presignedGetUrl } from "./storage";
import { resolveBrandTokens } from "./color";
import { ianaToPosix } from "./posix-tz";
import { normalizePrinterConfig, PRINTER_SCREENS, type PrinterConfig } from "./printer-layout";
import { computeConfigVersion, etagMatches } from "@/lib/device-config";
import { normalizeDeviceSettings } from "@/lib/device-settings";
import { rollupByDevice } from "@/lib/credit-usage";
import { rollupCredits, type CreditsOverview } from "@/lib/credits-overview";
import { getBalance } from "./credits";
import { AUDIT } from "@/lib/audit";
import type {
  Device,
  DeviceRow,
  Store,
  StoreSummary,
  Tenant,
  TenantStatus,
  TenantSummary,
  TimePoint,
} from "./types";

// ============================================================================
// Internal: load an org's bounded metadata + SQL-aggregated activation rollups,
// then build view-models from the bundle. The unbounded per-trigger rows are
// NEVER pulled into app memory — only GROUP BY aggregates (per-device today/
// month counts, and per-day/per-month series buckets). A super-admin page is
// therefore O(devices + buckets) per org, not O(all triggers on the platform).
// ============================================================================

interface OrgBundle {
  org: typeof orgTable.$inferSelect;
  settings: typeof settingsTable.$inferSelect | undefined;
  stores: (typeof storeTable.$inferSelect)[];
  devices: (typeof deviceTable.$inferSelect)[];
  /** activations-per-device, today / this-month (UTC), from SQL GROUP BY. */
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
  const dayExpr = sql<string>`to_char(date_trunc('day', ${deviceCommand.createdAt}), 'YYYY-MM-DD')`;
  const monthExpr = sql<string>`to_char(date_trunc('month', ${deviceCommand.createdAt}), 'YYYY-MM')`;
  // Metric = acked trigger commands (a QR the device actually rendered).
  const orgScoped = (sinceStr: string) =>
    and(
      eq(deviceCommand.organizationId, organizationId),
      eq(deviceCommand.type, "trigger"),
      eq(deviceCommand.status, "acked"),
      sql`${deviceCommand.createdAt} >= ${sinceStr}::timestamp`,
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
        deviceId: deviceCommand.deviceId,
        today: sql<number>`count(*) FILTER (WHERE ${deviceCommand.createdAt} >= ${todayStartStr}::timestamp)`.mapWith(
          Number,
        ),
        month: sql<number>`count(*)`.mapWith(Number),
      })
      .from(deviceCommand)
      .where(orgScoped(monthStartStr))
      .groupBy(deviceCommand.deviceId),
    db
      .select({ bucket: dayExpr, count: count() })
      .from(deviceCommand)
      .where(orgScoped(since30Str))
      .groupBy(dayExpr),
    db
      .select({ bucket: monthExpr, count: count() })
      .from(deviceCommand)
      .where(orgScoped(since9moStr))
      .groupBy(monthExpr),
    db
      .select({ name: userTable.name, email: userTable.email, role: memberTable.role })
      .from(memberTable)
      .innerJoin(userTable, eq(memberTable.userId, userTable.id))
      .where(eq(memberTable.organizationId, organizationId)),
  ]);

  // Per-device rollup of acked triggers: a device appears in monthByDevice when
  // it has ≥1 activation this month, in todayByDevice when it has ≥1 today;
  // absent devices read back as 0 via `?? 0` in mapDevice. (count(*) here is ≥1.)
  const todayByDevice = new Map<string, number>();
  const monthByDevice = new Map<string, number>();
  for (const r of deviceCountRows) {
    // deviceId is non-null on device_command; the guard is cheap insurance.
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

async function loadAllOrgs(opts?: { includeArchived?: boolean }): Promise<OrgBundle[]> {
  const rows = await db
    .select({ id: orgTable.id, archivedAt: settingsTable.archivedAt })
    .from(orgTable)
    .leftJoin(settingsTable, eq(settingsTable.organizationId, orgTable.id));
  const ids = rows
    .filter((r) => opts?.includeArchived || r.archivedAt === null)
    .map((r) => r.id);
  const bundles = await Promise.all(ids.map((id) => loadOrg(id)));
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

function mapTenantStatus(s: string | undefined): TenantStatus {
  // tenant_settings.status is active|paused; the view model adds trial/suspended.
  return s === "paused" ? "suspended" : "active";
}

// ---- bundle → view models ---------------------------------------------------

function buildTenant(b: OrgBundle): Tenant {
  const todayBy = b.todayByDevice;
  const monthBy = b.monthByDevice;

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

  // Claimed but storeless (store deleted or admin-unassigned). Unclaimed
  // provisioned devices are also storeless by design — keep them out.
  const unassignedDevices: Device[] = b.devices
    .filter((d) => d.storeId === null && d.claimedAt !== null)
    .map((d) => mapDevice(d, b.org.id, todayBy, monthBy));

  return {
    id: b.org.id,
    name: b.org.name,
    contact: b.contact,
    status: mapTenantStatus(b.settings?.status),
    brandColor: b.settings?.brandColor ?? "#10A765",
    logoText: b.org.name,
    staffPin: b.settings?.staffPin ?? "",
    stores,
    unassignedDevices,
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
    activationsToday: todayBy.get(d.id) ?? 0,
    activationsThisMonth: monthBy.get(d.id) ?? 0,
  };
}

function rollUpStoreStatus(devices: Device[]): StoreSummary["status"] {
  if (devices.some((d) => d.status === "online")) return "online";
  if (devices.some((d) => d.status === "paused")) return "paused";
  return "offline";
}

function summarize(b: OrgBundle): TenantSummary {
  const tenant = buildTenant(b);
  const allDevices = [
    ...tenant.stores.flatMap((s) => s.devices),
    ...tenant.unassignedDevices,
  ];
  const activationsThisMonth = allDevices.reduce(
    (a, d) => a + d.activationsThisMonth,
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
    activationsThisMonth,
    health,
    archivedAt: b.settings?.archivedAt ? b.settings.archivedAt.toISOString() : null,
  };
}

// ---- time series from SQL-aggregated activation buckets ----------------------
// The bundle already holds GROUP BY counts keyed "YYYY-MM-DD" / "YYYY-MM" (UTC,
// via date_trunc). bucketsToSeries joins them onto the ordered day/month keys —
// the same join the per-store analytics (getStoreAnalytics/getStoresAnalytics)
// use, so org-wide and per-store series can never drift apart. Buckets outside
// the key window are simply not joined (identical to the old all-triggers path,
// which bucketed everything then dropped out-of-window keys).

function dailySeries(b: OrgBundle): TimePoint[] {
  return bucketsToSeries(b.dailyBuckets, dayKeys(new Date(), 30));
}

function monthlySeries(b: OrgBundle): TimePoint[] {
  return bucketsToSeries(b.monthlyBuckets, monthKeys(new Date(), 9));
}

function sumSeries(all: TimePoint[][]): TimePoint[] {
  if (all.length === 0) return [];
  return all[0].map((_, i) => ({
    label: all[0][i].label,
    activations: all.reduce((a, s) => a + s[i].activations, 0),
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
  activationsToday: number;
  activationsThisMonth: number;
  activeDevices: number;
  totalDevices: number;
  eco: ReturnType<typeof computeEcoSavings>;
  ecoYtdActivations: number;
  ecoYtd: ReturnType<typeof computeEcoSavings>;
  daily: TimePoint[];
}

export async function getTenantDashboard(
  organizationId: string,
): Promise<TenantDashboard> {
  const b = await loadOrg(organizationId);
  if (!b) throw new Error(`Organization not found: ${organizationId}`);
  const tenant = buildTenant(b);
  const devices = [
    ...tenant.stores.flatMap((s) => s.devices),
    ...tenant.unassignedDevices,
  ];
  const activationsToday = devices.reduce((a, d) => a + d.activationsToday, 0);
  const activationsThisMonth = devices.reduce((a, d) => a + d.activationsThisMonth, 0);
  const activeDevices = devices.filter((d) => d.status === "online").length;
  const ecoYtdActivations = Math.round(activationsThisMonth * 7.4);

  return {
    tenant,
    activationsToday,
    activationsThisMonth,
    activeDevices,
    totalDevices: devices.length,
    eco: computeEcoSavings(activationsThisMonth),
    ecoYtdActivations,
    ecoYtd: computeEcoSavings(ecoYtdActivations),
    daily: dailySeries(b),
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
    activationsThisMonth: s.devices.reduce((a, d) => a + d.activationsThisMonth, 0),
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
 * Per-store analytics: daily/monthly activation series, this-vs-last-month trend,
 * eco savings for this month, and busiest day-of-week / peak hour. Returns the
 * store too so the page can render without a second lookup. null if not found.
 */
export async function getStoreAnalytics(
  storeId: string,
): Promise<{ store: Store; analytics: StoreAnalytics } | null> {
  const result = await getStore(storeId);
  if (!result) return null;
  const { store } = result;
  const now = new Date();

  const since30 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
  const since9mo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 8, 1));
  const since90 = new Date(now.getTime() - 90 * 86_400_000);

  const dayExpr = sql<string>`to_char(date_trunc('day', ${deviceCommand.createdAt}), 'YYYY-MM-DD')`;
  const monthExpr = sql<string>`to_char(date_trunc('month', ${deviceCommand.createdAt}), 'YYYY-MM')`;
  // created_at is `timestamp` (no tz) storing UTC wall-clock, so re-anchor to UTC
  // before converting to the store's local zone — the double AT TIME ZONE is required.
  const localTs = sql`((${deviceCommand.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE ${store.timezone})`;
  const dowExpr = sql<number>`extract(dow from ${localTs})::int`;
  const hourExpr = sql<number>`extract(hour from ${localTs})::int`;
  const scoped = (since: Date) =>
    and(
      eq(deviceTable.storeId, storeId),
      eq(deviceCommand.type, "trigger"),
      eq(deviceCommand.status, "acked"),
      gte(deviceCommand.createdAt, since),
    );

  const [dailyRows, monthlyRows, gridRows] = await Promise.all([
    db.select({ bucket: dayExpr, count: count() }).from(deviceCommand).innerJoin(deviceTable, eq(deviceCommand.deviceId, deviceTable.id)).where(scoped(since30)).groupBy(dayExpr),
    db.select({ bucket: monthExpr, count: count() }).from(deviceCommand).innerJoin(deviceTable, eq(deviceCommand.deviceId, deviceTable.id)).where(scoped(since9mo)).groupBy(monthExpr),
    db.select({ dow: dowExpr, hour: hourExpr, count: count() }).from(deviceCommand).innerJoin(deviceTable, eq(deviceCommand.deviceId, deviceTable.id)).where(scoped(since90)).groupBy(sql`1`, sql`2`),
  ]);

  const daily = bucketsToSeries(dailyRows, dayKeys(now, 30));
  const monthly = bucketsToSeries(monthlyRows, monthKeys(now, 9));
  const thisMonth = monthly[monthly.length - 1]?.activations ?? 0;
  const lastMonth = monthly[monthly.length - 2]?.activations ?? 0;

  const heatmap = buildHeatmap(gridRows);
  const analytics: StoreAnalytics = {
    daily,
    monthly,
    monthTrend: computeTrend(thisMonth, lastMonth),
    eco: computeEcoSavings(thisMonth),
    peak: heatmap.peak,
    heatmap,
  };
  return { store, analytics };
}

/**
 * Cross-store comparison for the tenant Analytics page: per-store rows (activations
 * this month, trend vs last month, eco) sorted by activations, plus a
 * per-store monthly series for the comparison chart. Degrades to empty on error.
 */
export async function getStoresAnalytics(organizationId: string): Promise<{
  rows: StoreComparisonRow[];
  monthlyByStore: { storeId: string; storeName: string; monthly: TimePoint[] }[];
}> {
  try {
    const tenant = await getTenant(organizationId);
    const stores = tenant.stores;
    if (stores.length === 0) return { rows: [], monthlyByStore: [] };

    const now = new Date();
    const since9mo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 8, 1));
    const monthExpr = sql<string>`to_char(date_trunc('month', ${deviceCommand.createdAt}), 'YYYY-MM')`;

    const perStoreMonth = await db
      .select({ storeId: deviceTable.storeId, bucket: monthExpr, count: count() })
      .from(deviceCommand)
      .innerJoin(deviceTable, eq(deviceCommand.deviceId, deviceTable.id))
      .where(and(
        eq(deviceCommand.organizationId, organizationId),
        eq(deviceCommand.type, "trigger"),
        eq(deviceCommand.status, "acked"),
        gte(deviceCommand.createdAt, since9mo),
      ))
      .groupBy(deviceTable.storeId, monthExpr);

    const keys = monthKeys(now, 9);
    const thisKey = keys[keys.length - 1].key;
    const lastKey = keys[keys.length - 2].key;

    const rows = toComparisonRows(
      stores.map((s) => ({
        storeId: s.id,
        storeName: s.name,
        current: perStoreMonth.find((r) => r.storeId === s.id && r.bucket === thisKey)?.count ?? 0,
        previous: perStoreMonth.find((r) => r.storeId === s.id && r.bucket === lastKey)?.count ?? 0,
      })),
    );

    const monthlyByStore = stores.map((s) => ({
      storeId: s.id,
      storeName: s.name,
      monthly: bucketsToSeries(
        perStoreMonth.filter((r) => r.storeId === s.id).map((r) => ({ bucket: r.bucket, count: r.count })),
        keys,
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
  // Pool device: claimed but storeless. Represent with a synthetic "—" store
  // so the admin device-detail page can render without crashing/404ing.
  const pooled = tenant.unassignedDevices.find((d) => d.id === deviceId);
  if (pooled) {
    const unassignedStore: Store = {
      id: "",
      tenantId: tenant.id,
      name: "—",
      address: "",
      timezone: "",
      devices: [],
    };
    return { device: pooled, store: unassignedStore, tenant };
  }
  return null;
}

export async function tenantDaily(organizationId: string): Promise<TimePoint[]> {
  const b = await loadOrg(organizationId);
  if (!b) return [];
  return dailySeries(b);
}

export async function tenantMonthly(organizationId: string): Promise<TimePoint[]> {
  const b = await loadOrg(organizationId);
  if (!b) return [];
  return monthlySeries(b);
}

// ============================================================================
// Super-admin panel
// ============================================================================

export async function getTenantSummaries(opts?: {
  includeArchived?: boolean;
}): Promise<TenantSummary[]> {
  const bundles = await loadAllOrgs(opts);
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
    for (const device of tenant.unassignedDevices) {
      rows.push({
        ...device,
        status: effectiveDeviceStatus(
          device.status,
          device.lastSeenAt ? new Date(device.lastSeenAt) : null,
          now,
        ),
        tenantName: tenant.name,
        storeName: "—",
      });
    }
  }
  return rows;
}

export interface AdminOverview {
  activationsThisMonth: number;
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
  const monthly = sumSeries(bundles.map((b) => monthlySeries(b)));
  const daily = sumSeries(bundles.map((b) => dailySeries(b)));

  let activeDevices = 0;
  let totalDevices = 0;
  for (const b of bundles) {
    for (const d of b.devices) {
      totalDevices++;
      if (d.status === "online") activeDevices++;
    }
  }

  return {
    activationsThisMonth: summaries.reduce((a, s) => a + s.activationsThisMonth, 0),
    activeDevices,
    totalDevices,
    totalCustomers: summaries.length,
    totalStores: summaries.reduce((a, s) => a + s.storeCount, 0),
    monthly,
    daily,
    topCustomers: [...summaries]
      .sort((a, b) => b.activationsThisMonth - a.activationsThisMonth)
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
  };
  eco: ReturnType<typeof computeEcoSavings>;
  archivedAt: string | null;
  archivedNote: string | null;
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
  const devices: DeviceRow[] = [
    ...tenant.stores.flatMap((store) =>
      store.devices.map((d) => ({
        ...d,
        status: effectiveDeviceStatus(d.status, d.lastSeenAt ? new Date(d.lastSeenAt) : null, now),
        tenantName: tenant.name,
        storeName: store.name,
      })),
    ),
    ...tenant.unassignedDevices.map((d) => ({
      ...d,
      status: effectiveDeviceStatus(d.status, d.lastSeenAt ? new Date(d.lastSeenAt) : null, now),
      tenantName: tenant.name,
      storeName: "—",
    })),
  ];
  let online = 0, offline = 0, paused = 0;
  for (const d of devices) {
    if (d.status === "online") online++;
    else if (d.status === "offline") offline++;
    else if (d.status === "paused") paused++;
  }

  const stuckCutoff = new Date(now.getTime() - STUCK_PENDING_MINUTES * 60_000);
  const [{ stuck }] = await db
    .select({ stuck: sql<number>`count(*)::int` })
    .from(deviceCommand)
    .where(
      and(
        eq(deviceCommand.organizationId, organizationId),
        eq(deviceCommand.type, "trigger"),
        eq(deviceCommand.status, "pending"),
        lt(deviceCommand.createdAt, stuckCutoff),
      ),
    );
  const [{ last }] = await db
    .select({ last: max(deviceCommand.createdAt) })
    .from(deviceCommand)
    .where(and(
      eq(deviceCommand.organizationId, organizationId),
      eq(deviceCommand.type, "trigger"),
      eq(deviceCommand.status, "acked"),
    ));

  const level = tenantHealthLevel(
    {
      deviceCount: devices.length,
      onlineCount: online,
      offlineCount: offline,
      stuckPendingCount: stuck,
      lastActivityAt: last ?? null,
    },
    now,
  );

  return {
    tenant,
    summary,
    devices,
    health: { level, online, offline, paused, stuckPendingCount: stuck },
    eco: computeEcoSavings(summary.activationsThisMonth),
    archivedAt: b.settings?.archivedAt ? b.settings.archivedAt.toISOString() : null,
    archivedNote: b.settings?.archivedNote ?? null,
  };
}

/** Devices for an org, in the shape offboarding needs to present disposition
 *  choices (id/name/serial/status) — no view-model conversions applied. */
export async function getOrgDevicesForOffboard(
  organizationId: string,
): Promise<{ id: string; name: string; serial: string | null; status: string }[]> {
  return db
    .select({
      id: deviceTable.id,
      name: deviceTable.name,
      serial: deviceTable.serial,
      status: deviceTable.status,
    })
    .from(deviceTable)
    .where(eq(deviceTable.organizationId, organizationId))
    .orderBy(deviceTable.name);
}

// ============================================================================
// Billing
// ============================================================================

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

/** The org's unassigned pool (claimed devices whose store was deleted). */
export async function getTenantUnassignedDevices(
  organizationId: string,
): Promise<Device[]> {
  const tenant = await getTenant(organizationId);
  return tenant.unassignedDevices;
}

/**
 * Armed zero-touch allocations per store: factory serials allocated to a
 * store but not yet claimed. Deleting the store disarms them (FK set-null),
 * so delete dialogs surface this count as a warning.
 */
export async function getArmedAllocationCountByStore(
  organizationId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ storeId: factoryDevice.allocatedStoreId, n: count() })
    .from(factoryDevice)
    .where(
      and(
        eq(factoryDevice.allocatedOrganizationId, organizationId),
        eq(factoryDevice.status, "allocated"),
        isNotNull(factoryDevice.allocatedStoreId),
      ),
    )
    .groupBy(factoryDevice.allocatedStoreId);
  const out: Record<string, number> = {};
  for (const r of rows) if (r.storeId) out[r.storeId] = r.n;
  return out;
}

// Device provisioning helpers live in lib/documents.ts (claimDevice,
// getUnclaimedDevices) — re-exported here so callers have one data entrypoint.
export { claimDevice, getUnclaimedDevices } from "./documents";

// ============================================================================
// Tenant billing view-model (subscription status, saved card, invoices).
// ============================================================================

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

/** Latest `org.archived` audit row for an org — targeted single-row lookup
 *  for the offboarding-summary card, so it can't blank out once an org
 *  accrues more than the activity list's row cap. */
export async function getLatestOrgArchivedEntry(
  organizationId: string,
): Promise<{ metadata: Record<string, unknown> | null; at: string } | null> {
  const [row] = await db
    .select({ metadata: auditLogTable.metadata, createdAt: auditLogTable.createdAt })
    .from(auditLogTable)
    .where(and(eq(auditLogTable.organizationId, organizationId), eq(auditLogTable.action, AUDIT.orgArchived)))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    at: row.createdAt.toISOString(),
  };
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


export interface PlatformHealth {
  fleet: {
    total: number;
    online: number;
    offline: number;
    paused: number;
    staleCount: number;
    stale: { deviceId: string; name: string; tenantName: string | null; lastSeen: string }[];
  };
  activity: {
    last1h: number;
    last24h: number;
    acked: number;
    pending: number;
    failed: number;
    stuckPending: number;
  };
  usage: {
    topTenants: { id: string; name: string; count: number }[];
    inactiveTenants: { id: string; name: string; lastActivityAt: string | null }[];
  };
  alerts: HealthAlert[];
}

function zeroedHealth(): PlatformHealth {
  return {
    fleet: { total: 0, online: 0, offline: 0, paused: 0, staleCount: 0, stale: [] },
    activity: { last1h: 0, last24h: 0, acked: 0, pending: 0, failed: 0, stuckPending: 0 },
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

    const trigAcked = and(eq(deviceCommand.type, "trigger"), eq(deviceCommand.status, "acked"));
    const [{ last1h }] = await db.select({ last1h: count() }).from(deviceCommand).where(and(trigAcked, gte(deviceCommand.createdAt, h1)));
    const [{ last24h }] = await db.select({ last24h: count() }).from(deviceCommand).where(and(trigAcked, gte(deviceCommand.createdAt, h24)));
    // Status breakdown over all trigger commands in 24h (not just acked).
    const breakdownRows = await db
      .select({ status: deviceCommand.status, c: count() })
      .from(deviceCommand)
      .where(and(eq(deviceCommand.type, "trigger"), gte(deviceCommand.createdAt, h24)))
      .groupBy(deviceCommand.status);
    const bd = { acked: 0, pending: 0, failed: 0 } as Record<string, number>;
    for (const r of breakdownRows) {
      if (r.status === "acked") bd.acked += Number(r.c);
      else if (r.status === "pending" || r.status === "delivered") bd.pending += Number(r.c);
      else bd.failed += Number(r.c); // failed + expired
    }
    const [{ stuckPending }] = await db
      .select({ stuckPending: count() })
      .from(deviceCommand)
      .where(and(eq(deviceCommand.type, "trigger"), eq(deviceCommand.status, "pending"), lt(deviceCommand.createdAt, stuckCut)));

    const topRows = await db
      .select({ id: orgTable.id, name: orgTable.name, c: count() })
      .from(deviceCommand)
      .innerJoin(orgTable, eq(deviceCommand.organizationId, orgTable.id))
      .where(and(trigAcked, gte(deviceCommand.createdAt, h24)))
      .groupBy(orgTable.id, orgTable.name)
      .orderBy(desc(count()))
      .limit(5);
    const topTenants = topRows.map((r) => ({ id: r.id, name: r.name, count: Number(r.c) }));

    const allOrgs = await db.select({ id: orgTable.id, name: orgTable.name }).from(orgTable);
    const lastRows = await db
      .select({ org: deviceCommand.organizationId, last: max(deviceCommand.createdAt) })
      .from(deviceCommand)
      .where(trigAcked)
      .groupBy(deviceCommand.organizationId);
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
        lastActivityAt: lastByOrg.get(o.id)?.toISOString() ?? null,
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
      activity: {
        last1h: Number(last1h),
        last24h: Number(last24h),
        acked: bd.acked,
        pending: bd.pending,
        failed: bd.failed,
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
    .from(deviceCommand)
    .where(and(eq(deviceCommand.type, "trigger"), eq(deviceCommand.status, "pending"), lt(deviceCommand.createdAt, stuckCut)));

  const allOrgs = await db.select({ id: orgTable.id, name: orgTable.name }).from(orgTable);
  const lastRows = await db
    .select({ org: deviceCommand.organizationId, last: max(deviceCommand.createdAt) })
    .from(deviceCommand)
    .where(and(eq(deviceCommand.type, "trigger"), eq(deviceCommand.status, "acked")))
    .groupBy(deviceCommand.organizationId);
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

export interface ApiUsageData {
  credits: { available: number; held: number };
  creditsConsumedThisMonth: number;
  activationsThisMonth: number;
  period: { start: string; end: string };
}

/** Machine-keyed usage for /api/v1/usage — credit-denominated (UTC month). */
export async function getApiUsage(organizationId: string): Promise<ApiUsageData> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [credits, [consumedRow], [actRow]] = await Promise.all([
    getBalance(organizationId),
    db
      .select({ c: sql<number>`coalesce(sum(${creditLedgerTable.credits}), 0)::int` })
      .from(creditLedgerTable)
      .where(and(
        eq(creditLedgerTable.organizationId, organizationId),
        eq(creditLedgerTable.kind, "settle"),
        gte(creditLedgerTable.createdAt, monthStart),
      )),
    db
      .select({ c: count() })
      .from(deviceCommand)
      .where(and(
        eq(deviceCommand.organizationId, organizationId),
        eq(deviceCommand.type, "trigger"),
        eq(deviceCommand.status, "acked"),
        gte(deviceCommand.createdAt, monthStart),
      )),
  ]);

  return {
    credits,
    creditsConsumedThisMonth: Number(consumedRow?.c ?? 0),
    activationsThisMonth: Number(actRow?.c ?? 0),
    period: { start: monthStart.toISOString(), end: monthEnd.toISOString() },
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

export type { CreditsOverview };

/** Platform-admin: credits view for the admin Billing page (granted/purchased/consumed/outstanding). */
export async function getCreditsOverview(): Promise<CreditsOverview> {
  const [orgs, ledgerRows, balanceRows] = await Promise.all([
    db.select({ id: orgTable.id, name: orgTable.name }).from(orgTable),
    db
      .select({
        organizationId: creditLedgerTable.organizationId,
        kind: creditLedgerTable.kind,
        credits: creditLedgerTable.credits,
        createdAt: creditLedgerTable.createdAt,
      })
      .from(creditLedgerTable),
    db
      .select({
        organizationId: creditBalanceTable.organizationId,
        available: creditBalanceTable.available,
      })
      .from(creditBalanceTable),
  ]);

  const nameOf = new Map(orgs.map((o) => [o.id, o.name]));

  return rollupCredits(
    ledgerRows.map((r) => ({
      orgId: r.organizationId,
      name: nameOf.get(r.organizationId) ?? r.organizationId,
      kind: r.kind,
      credits: r.credits,
      createdAt: r.createdAt,
    })),
    balanceRows.map((b) => ({
      orgId: b.organizationId,
      name: nameOf.get(b.organizationId) ?? b.organizationId,
      available: b.available,
    })),
    new Date(),
  );
}
