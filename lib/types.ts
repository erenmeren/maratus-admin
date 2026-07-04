// Core domain types for the Ditto admin app.
// These mirror the shape a real API would eventually return.

import type { HealthLevel } from "./tenant-health";

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
  lastSeen: string; // ISO timestamp (falls back to createdAt for display)
  lastSeenAt: string | null; // raw last-seen, null if never seen (for status)
  activationsToday: number;
  activationsThisMonth: number;
}

export interface Store {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  timezone: string;
  devices: Device[];
}

export interface Tenant {
  id: string;
  name: string;
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
  activations: number;
}

export type InvoiceStatus = "paid" | "due" | "overdue";
/** Raw billing lifecycle stored in the DB. */
export type InvoiceLifecycle = "draft" | "sent" | "paid" | "overdue" | "void";

export interface Invoice {
  id: string;
  tenantId: string;
  period: string; // e.g. "May 2026"
  documents: number;
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
  onlineCount: number;
  offlineCount: number;
  health: HealthLevel;
  activationsThisMonth: number;
}

export interface DeviceRow extends Device {
  tenantName: string;
  storeName: string;
}

export interface StoreSummary {
  id: string;
  name: string;
  address: string;
  timezone: string;
  deviceCount: number;
  onlineCount: number;
  activationsThisMonth: number;
  status: DeviceStatus; // rolled-up store status
}
