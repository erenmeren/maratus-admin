import { describe, expect, it } from "vitest";
import { desiredSubscriptionState } from "./device-subscription-logic";

describe("desiredSubscriptionState", () => {
  it("credits plan with no subscription → none", () => {
    expect(
      desiredSubscriptionState({ plan: "credits", deviceCount: 5, hasSubscription: false, priceId: null }),
    ).toEqual({ action: "none" });
  });

  it("credits plan with a leftover subscription → cancel", () => {
    expect(
      desiredSubscriptionState({ plan: "credits", deviceCount: 5, hasSubscription: true, priceId: null }),
    ).toEqual({ action: "cancel" });
  });

  it("flat plan with devices and no subscription → create with device quantity", () => {
    expect(
      desiredSubscriptionState({ plan: "flat", deviceCount: 12, hasSubscription: false, priceId: "price_flat" }),
    ).toEqual({ action: "create", priceId: "price_flat", quantity: 12 });
  });

  it("flat plan with an existing subscription → update quantity", () => {
    expect(
      desiredSubscriptionState({ plan: "flat", deviceCount: 3, hasSubscription: true, priceId: "price_flat" }),
    ).toEqual({ action: "update", priceId: "price_flat", quantity: 3 });
  });

  it("zero devices cancels an existing subscription", () => {
    expect(
      desiredSubscriptionState({ plan: "flat", deviceCount: 0, hasSubscription: true, priceId: "price_flat" }),
    ).toEqual({ action: "cancel" });
  });

  it("unconfigured price id with no subscription → none (config error, nothing to wind down)", () => {
    expect(
      desiredSubscriptionState({ plan: "base_usage", deviceCount: 4, hasSubscription: false, priceId: null }),
    ).toEqual({ action: "none" });
  });

  it("unconfigured price id with an existing subscription → none (config-missing is NOT a wind-down; never auto-cancel a live sub over a missing env var)", () => {
    expect(
      desiredSubscriptionState({ plan: "base_usage", deviceCount: 4, hasSubscription: true, priceId: null }),
    ).toEqual({ action: "none" });
  });
});
