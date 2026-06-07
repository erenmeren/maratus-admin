import { describe, it, expect } from "vitest";
import { serializeReceiptRow, serializeReceiptDetail, serializeUsage } from "./serialize";

describe("serializeReceiptRow", () => {
  it("maps to snake_case with ISO created_at", () => {
    const out = serializeReceiptRow({
      id: "rcp_1", token: "tok", status: "ready",
      storeId: "str_1", deviceId: "dev_1", byteSize: 2048,
      createdAt: new Date("2026-06-07T12:00:00.000Z"),
    });
    expect(out).toEqual({
      id: "rcp_1", token: "tok", status: "ready",
      store_id: "str_1", device_id: "dev_1", byte_size: 2048,
      created_at: "2026-06-07T12:00:00.000Z",
    });
  });
});

describe("serializeReceiptDetail", () => {
  it("includes image url + expiry and downloaded_at", () => {
    const out = serializeReceiptDetail({
      id: "rcp_1", token: "tok", status: "downloaded",
      storeId: "str_1", deviceId: "dev_1", byteSize: 2048,
      createdAt: "2026-06-07T12:00:00.000Z", downloadedAt: "2026-06-07T13:00:00.000Z",
      imageUrl: "https://r2/x",
    });
    expect(out.image_url).toBe("https://r2/x");
    expect(out.image_expires_in).toBe(300);
    expect(out.downloaded_at).toBe("2026-06-07T13:00:00.000Z");
    expect(out.store_id).toBe("str_1");
  });
  it("nulls image_expires_in when there is no image", () => {
    const out = serializeReceiptDetail({
      id: "rcp_1", token: "tok", status: "pending",
      storeId: null, deviceId: "dev_1", byteSize: 0,
      createdAt: "2026-06-07T12:00:00.000Z", downloadedAt: null, imageUrl: null,
    });
    expect(out.image_url).toBeNull();
    expect(out.image_expires_in).toBeNull();
  });
});

describe("serializeUsage", () => {
  it("passes through integer cents + machine keys", () => {
    const out = serializeUsage({
      unitPriceCents: 4, receiptsThisMonth: 10,
      currentPeriod: { start: "2026-06-01T00:00:00.000Z", end: "2026-07-01T00:00:00.000Z", receiptCount: 10, amountDueCents: 40 },
      daily: [{ date: "2026-06-01", receipts: 3 }],
      monthly: [{ month: "2026-06", receipts: 10 }],
    });
    expect(out.unit_price_cents).toBe(4);
    expect(out.current_period.amount_due_cents).toBe(40);
    expect(out.daily[0]).toEqual({ date: "2026-06-01", receipts: 3 });
  });
});
