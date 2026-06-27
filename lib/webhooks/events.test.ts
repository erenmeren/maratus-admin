import { describe, it, expect } from "vitest";
import { buildEvent, isWebhookEventType, WEBHOOK_EVENT_TYPES } from "./events";
import type { ApiDocumentRow } from "@/lib/api/serialize";

const document: ApiDocumentRow = {
  id: "rcp_1", token: "tok", status: "ready",
  storeId: "str_1", deviceId: "dev_1", byteSize: 2048,
  createdAt: new Date("2026-06-07T12:00:00.000Z"),
};

describe("WEBHOOK_EVENT_TYPES / isWebhookEventType", () => {
  it("lists the v1 event types", () => {
    expect(WEBHOOK_EVENT_TYPES).toEqual(["document.created", "document.downloaded"]);
  });
  it("validates type strings", () => {
    expect(isWebhookEventType("document.created")).toBe(true);
    expect(isWebhookEventType("document.bogus")).toBe(false);
  });
});

describe("buildEvent", () => {
  it("wraps the serialized document with an evt_ id, type, created", () => {
    const e = buildEvent("document.created", document, "2026-06-07T12:00:01.000Z");
    expect(e.id).toMatch(/^evt_/);
    expect(e.type).toBe("document.created");
    expect(e.created).toBe("2026-06-07T12:00:01.000Z");
    expect(e.data).toEqual({
      id: "rcp_1", token: "tok", status: "ready",
      store_id: "str_1", device_id: "dev_1", byte_size: 2048,
      created_at: "2026-06-07T12:00:00.000Z",
    });
  });
});
