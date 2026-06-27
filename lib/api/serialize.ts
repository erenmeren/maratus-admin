// view-model → public API JSON (snake_case, integer cents). Pure.
import type { DocumentStatus } from "@/lib/documents-search";

const IMAGE_TTL_SECONDS = 300; // matches lib/storage presigned GET TTL

export interface ApiDocumentRow {
  id: string;
  token: string;
  status: DocumentStatus;
  storeId: string | null;
  deviceId: string | null;
  byteSize: number;
  createdAt: Date;
}

export function serializeDocumentRow(r: ApiDocumentRow) {
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

export interface ApiDocumentDetail {
  id: string;
  token: string;
  status: DocumentStatus;
  storeId: string | null;
  deviceId: string | null;
  byteSize: number;
  createdAt: string; // ISO
  downloadedAt: string | null;
  imageUrl: string | null;
}

export function serializeDocumentDetail(d: ApiDocumentDetail) {
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
  documentsThisMonth: number;
  currentPeriod: { start: string; end: string; documentCount: number; amountDueCents: number };
  daily: { date: string; documents: number }[];
  monthly: { month: string; documents: number }[];
}

export function serializeUsage(u: ApiUsage) {
  return {
    unit_price_cents: u.unitPriceCents,
    documents_this_month: u.documentsThisMonth,
    current_period: {
      start: u.currentPeriod.start,
      end: u.currentPeriod.end,
      document_count: u.currentPeriod.documentCount,
      amount_due_cents: u.currentPeriod.amountDueCents,
    },
    daily: u.daily,
    monthly: u.monthly,
  };
}
