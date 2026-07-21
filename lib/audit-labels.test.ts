import { describe, it, expect } from "vitest";
import { AUDIT_LABELS, humanizeAction, actionLabel } from "./audit-labels";
import { AUDIT } from "./audit";

describe("actionLabel", () => {
  it("maps known actions to friendly labels", () => {
    expect(actionLabel("device.went_offline")).toBe("Device went offline");
    expect(actionLabel("invoice.sent")).toBe("Invoice sent");
    expect(actionLabel("credits.purchased")).toBe("Credits purchased");
    expect(actionLabel("invoice.payment_failed")).toBe("Payment failed");
    expect(actionLabel("device.pin_set")).toBe("Pinned QR set");
    expect(actionLabel("device.pin_cleared")).toBe("Pinned QR removed");
  });
  it("falls back to humanizeAction for an unmapped action", () => {
    expect(actionLabel("foo.bar_baz")).toBe("Foo: Bar baz");
  });
});

describe("humanizeAction", () => {
  it("title-cases entity + verb, underscores → spaces", () => {
    expect(humanizeAction("device.command_enqueued")).toBe("Device: Command enqueued");
    expect(humanizeAction("api_key.revoked")).toBe("Api key: Revoked");
  });
  it("handles a bare entity with no verb", () => {
    expect(humanizeAction("created")).toBe("Created");
  });
});

describe("AUDIT_LABELS completeness", () => {
  it("has a label for every AUDIT constant (map cannot drift)", () => {
    for (const value of Object.values(AUDIT)) {
      expect(AUDIT_LABELS[value], `missing label for "${value}"`).toBeDefined();
    }
  });
});
