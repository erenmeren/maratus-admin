// Core domain types for the Ditto admin app.
// These mirror the shape a real API would eventually return.

export type DeviceStatus = "online" | "offline" | "paused";
export type ConnectionType = "ethernet" | "wifi";
export type TenantStatus = "active" | "trial" | "suspended";

export interface Device {
  id: string;
  storeId: string;
  tenantId: string;
  name: string;
  status: DeviceStatus;
  ipAddress: string;
  connectionType: ConnectionType;
  firmwareVersion: string;
  lastSeen: string; // ISO timestamp
  receiptsToday: number;
  receiptsThisMonth: number;
}

export interface Store {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  devices: Device[];
}

export interface Tenant {
  id: string;
  name: string;
  perPrintPrice: number; // price Ditto charges per digital receipt
  contact: {
    name: string;
    email: string;
    phone: string;
  };
  status: TenantStatus;
  /** The tenant's OWN brand color — DATA, shown only on the Branding screen. */
  brandColor: string;
  logoText: string;
  staffPin: string;
  stores: Store[];
}

export interface TimePoint {
  /** Short label for the axis (e.g. "May 24" or "Jan"). */
  label: string;
  receipts: number;
  revenue: number;
}

export type InvoiceStatus = "paid" | "due" | "overdue";
/** Raw billing lifecycle stored in the DB. */
export type InvoiceLifecycle = "draft" | "sent" | "paid" | "overdue" | "void";

export interface Invoice {
  id: string;
  tenantId: string;
  period: string; // e.g. "May 2026"
  receipts: number;
  amount: number;
  status: InvoiceStatus;
  /** Real billing lifecycle (draft → sent → paid). */
  lifecycle: InvoiceLifecycle;
  issuedOn: string; // ISO date
}

// ---- Derived / view-model shapes returned by the data layer ----

export interface TenantSummary {
  id: string;
  name: string;
  status: TenantStatus;
  storeCount: number;
  deviceCount: number;
  receiptsThisMonth: number;
  revenueThisMonth: number;
  perPrintPrice: number;
}

export interface DeviceRow extends Device {
  tenantName: string;
  storeName: string;
}

export interface StoreSummary {
  id: string;
  name: string;
  address: string;
  deviceCount: number;
  onlineCount: number;
  receiptsThisMonth: number;
  status: DeviceStatus; // rolled-up store status
}
