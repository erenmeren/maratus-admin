// view-model → public API JSON (snake_case, integer cents). Pure.
import type { ReceiptStatus } from "@/lib/receipts-search";

const IMAGE_TTL_SECONDS = 300; // matches lib/storage presigned GET TTL

export interface ApiReceiptRow {
  id: string;
  token: string;
  status: ReceiptStatus;
  storeId: string | null;
  deviceId: string | null;
  byteSize: number;
  createdAt: Date;
}

export function serializeReceiptRow(r: ApiReceiptRow) {
  return {
    id: r.id,
    token: r.token,
    status: r.status,
    store_id: r.storeId,
    device_id: r.deviceId,
    byte_size: r.byteSize,
    created_at: r.createdAt.toISOString(),
  };
}

export interface ApiReceiptDetail {
  id: string;
  token: string;
  status: ReceiptStatus;
  storeId: string | null;
  deviceId: string | null;
  byteSize: number;
  createdAt: string; // ISO
  downloadedAt: string | null;
  imageUrl: string | null;
}

export function serializeReceiptDetail(d: ApiReceiptDetail) {
  return {
    id: d.id,
    token: d.token,
    status: d.status,
    store_id: d.storeId,
    device_id: d.deviceId,
    byte_size: d.byteSize,
    created_at: d.createdAt,
    downloaded_at: d.downloadedAt,
    image_url: d.imageUrl,
    image_expires_in: d.imageUrl ? IMAGE_TTL_SECONDS : null,
  };
}

export interface ApiUsage {
  unitPriceCents: number;
  receiptsThisMonth: number;
  currentPeriod: { start: string; end: string; receiptCount: number; amountDueCents: number };
  daily: { date: string; receipts: number }[];
  monthly: { month: string; receipts: number }[];
}

export function serializeUsage(u: ApiUsage) {
  return {
    unit_price_cents: u.unitPriceCents,
    receipts_this_month: u.receiptsThisMonth,
    current_period: {
      start: u.currentPeriod.start,
      end: u.currentPeriod.end,
      receipt_count: u.currentPeriod.receiptCount,
      amount_due_cents: u.currentPeriod.amountDueCents,
    },
    daily: u.daily,
    monthly: u.monthly,
  };
}
