// Thin data layer for the Ditto prototype.
//
// Every screen reads from these functions. Swapping to a real backend means
// replacing the bodies here with API calls — nothing else changes.
// TODO: replace with API.

import { TENANTS, INVOICES, dailySeries, monthlySeries } from "./mock-data";
import { computeEcoSavings } from "./eco";
import type {
  Device,
  DeviceRow,
  Invoice,
  Store,
  StoreSummary,
  Tenant,
  TenantSummary,
  TimePoint,
} from "./types";

const DEFAULT_TENANT_ID = "roastwell";

function allDevicesOf(tenant: Tenant): Device[] {
  return tenant.stores.flatMap((s) => s.devices);
}

function rollUpStoreStatus(devices: Device[]): StoreSummary["status"] {
  if (devices.some((d) => d.status === "online")) return "online";
  if (devices.some((d) => d.status === "paused")) return "paused";
  return "offline";
}

// ---- Tenant lookups ---------------------------------------------------------

export function getTenants(): Tenant[] {
  return TENANTS;
}

export function getTenant(tenantId: string = DEFAULT_TENANT_ID): Tenant {
  return TENANTS.find((t) => t.id === tenantId) ?? TENANTS[0];
}

export function getDefaultTenant(): Tenant {
  return getTenant(DEFAULT_TENANT_ID);
}

// ---- Tenant panel -----------------------------------------------------------

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

export function getTenantDashboard(
  tenantId: string = DEFAULT_TENANT_ID,
): TenantDashboard {
  const tenant = getTenant(tenantId);
  const devices = allDevicesOf(tenant);
  const receiptsToday = devices.reduce((a, d) => a + d.receiptsToday, 0);
  const receiptsThisMonth = devices.reduce((a, d) => a + d.receiptsThisMonth, 0);
  const activeDevices = devices.filter((d) => d.status === "online").length;
  // YTD ≈ this-month total times a rough multiplier for the prototype.
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
    daily: tenantDaily(tenantId),
  };
}

export function getTenantStores(
  tenantId: string = DEFAULT_TENANT_ID,
): StoreSummary[] {
  const tenant = getTenant(tenantId);
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

export function getStore(
  storeId: string,
): { store: Store; tenant: Tenant } | null {
  for (const tenant of TENANTS) {
    const store = tenant.stores.find((s) => s.id === storeId);
    if (store) return { store, tenant };
  }
  return null;
}

export function getDevice(
  deviceId: string,
): { device: Device; store: Store; tenant: Tenant } | null {
  for (const tenant of TENANTS) {
    for (const store of tenant.stores) {
      const device = store.devices.find((d) => d.id === deviceId);
      if (device) return { device, store, tenant };
    }
  }
  return null;
}

// ---- Time series helpers ----------------------------------------------------

function tenantScale(tenant: Tenant): number {
  return Math.max(
    20,
    Math.round(allDevicesOf(tenant).reduce((a, d) => a + d.receiptsToday, 0)),
  );
}

function seedOf(tenantId: string): number {
  return tenantId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
}

export function tenantDaily(tenantId: string = DEFAULT_TENANT_ID): TimePoint[] {
  const tenant = getTenant(tenantId);
  return dailySeries(tenantScale(tenant), seedOf(tenantId)).map((p) => ({
    ...p,
    revenue: Math.round(p.receipts * tenant.perPrintPrice * 100) / 100,
  }));
}

export function tenantMonthly(
  tenantId: string = DEFAULT_TENANT_ID,
): TimePoint[] {
  const tenant = getTenant(tenantId);
  return monthlySeries(tenantScale(tenant), seedOf(tenantId)).map((p) => ({
    ...p,
    revenue: Math.round(p.receipts * tenant.perPrintPrice * 100) / 100,
  }));
}

/** Platform-wide monthly series, summed across all tenants. */
export function platformMonthly(): TimePoint[] {
  const series = TENANTS.map((t) => tenantMonthly(t.id));
  return series[0].map((_, i) => ({
    label: series[0][i].label,
    receipts: series.reduce((a, s) => a + s[i].receipts, 0),
    revenue:
      Math.round(series.reduce((a, s) => a + s[i].revenue, 0) * 100) / 100,
  }));
}

/** Platform-wide daily series, summed across all tenants. */
export function platformDaily(): TimePoint[] {
  const series = TENANTS.map((t) => tenantDaily(t.id));
  return series[0].map((_, i) => ({
    label: series[0][i].label,
    receipts: series.reduce((a, s) => a + s[i].receipts, 0),
    revenue:
      Math.round(series.reduce((a, s) => a + s[i].revenue, 0) * 100) / 100,
  }));
}

// ---- Super-admin panel ------------------------------------------------------

export function getTenantSummaries(): TenantSummary[] {
  return TENANTS.map((t) => {
    const devices = allDevicesOf(t);
    const receiptsThisMonth = devices.reduce(
      (a, d) => a + d.receiptsThisMonth,
      0,
    );
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      storeCount: t.stores.length,
      deviceCount: devices.length,
      receiptsThisMonth,
      revenueThisMonth:
        Math.round(receiptsThisMonth * t.perPrintPrice * 100) / 100,
      perPrintPrice: t.perPrintPrice,
    };
  });
}

export function getAllDevices(): DeviceRow[] {
  const rows: DeviceRow[] = [];
  for (const tenant of TENANTS) {
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

export function getAdminOverview(): AdminOverview {
  const summaries = getTenantSummaries();
  const devices = getAllDevices();
  const receiptsThisMonth = summaries.reduce(
    (a, s) => a + s.receiptsThisMonth,
    0,
  );
  const mrr = summaries.reduce((a, s) => a + s.revenueThisMonth, 0);
  return {
    mrr,
    receiptsThisMonth,
    activeDevices: devices.filter((d) => d.status === "online").length,
    totalDevices: devices.length,
    totalCustomers: summaries.length,
    totalStores: summaries.reduce((a, s) => a + s.storeCount, 0),
    monthly: platformMonthly(),
    daily: platformDaily(),
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

export function getCustomerDetail(tenantId: string): CustomerDetail | null {
  const tenant = TENANTS.find((t) => t.id === tenantId);
  if (!tenant) return null;
  const summary = getTenantSummaries().find((s) => s.id === tenantId)!;
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
    monthly: tenantMonthly(tenantId),
    invoices: getInvoices(tenantId),
    eco: computeEcoSavings(summary.receiptsThisMonth),
  };
}

// ---- Billing ----------------------------------------------------------------

export interface BillingOverview {
  totalEarnings: number;
  outstanding: number;
  invoices: Invoice[];
  byTenant: (TenantSummary & { amountOwed: number })[];
  monthly: TimePoint[];
}

export function getInvoices(tenantId?: string): Invoice[] {
  const list = tenantId
    ? INVOICES.filter((i) => i.tenantId === tenantId)
    : INVOICES;
  return [...list].sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
}

export function getBillingOverview(): BillingOverview {
  const summaries = getTenantSummaries();
  const totalEarnings =
    Math.round(
      INVOICES.filter((i) => i.status === "paid").reduce(
        (a, i) => a + i.amount,
        0,
      ) * 100,
    ) / 100;
  const outstanding =
    Math.round(
      INVOICES.filter((i) => i.status !== "paid").reduce(
        (a, i) => a + i.amount,
        0,
      ) * 100,
    ) / 100;
  const byTenant = summaries.map((s) => {
    const owed = INVOICES.filter(
      (i) => i.tenantId === s.id && i.status !== "paid",
    ).reduce((a, i) => a + i.amount, 0);
    return { ...s, amountOwed: Math.round(owed * 100) / 100 };
  });
  return {
    totalEarnings,
    outstanding,
    invoices: getInvoices(),
    byTenant,
    monthly: platformMonthly(),
  };
}

/** Map a tenantId to its display name (used by billing/fleet tables). */
export function tenantNameOf(tenantId: string): string {
  return TENANTS.find((t) => t.id === tenantId)?.name ?? tenantId;
}
