// Webhook event types + payload builder. Payload `data` reuses the public API's
// snake_case receipt shape so webhook + API consumers see identical resources.
import { serializeReceiptRow, type ApiReceiptRow } from "@/lib/api/serialize";
import { id } from "@/lib/ids";

export const WEBHOOK_EVENT_TYPES = ["receipt.created", "receipt.downloaded"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(t: string): t is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(t);
}

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  created: string; // ISO emission time
  data: ReturnType<typeof serializeReceiptRow>;
}

export function buildEvent(type: WebhookEventType, receipt: ApiReceiptRow, createdIso: string): WebhookEvent {
  return { id: id("evt"), type, created: createdIso, data: serializeReceiptRow(receipt) };
}
