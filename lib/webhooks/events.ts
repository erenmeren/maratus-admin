// Webhook event types + payload builder. Payload `data` reuses the public API's
// snake_case document shape so webhook + API consumers see identical resources.
import { serializeDocumentRow, type ApiDocumentRow } from "@/lib/api/serialize";
import { id } from "@/lib/ids";

export const WEBHOOK_EVENT_TYPES = ["document.created", "document.downloaded"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(t: string): t is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(t);
}

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  created: string; // ISO emission time
  data: ReturnType<typeof serializeDocumentRow>;
}

export function buildEvent(type: WebhookEventType, document: ApiDocumentRow, createdIso: string): WebhookEvent {
  return { id: id("evt"), type, created: createdIso, data: serializeDocumentRow(document) };
}
