// Device-slot arithmetic (pure). A slot is what the org PAID for; a device is
// what currently occupies one. Keeping them separate is the whole point: an
// RMA'd or removed device frees its slot without shrinking the entitlement,
// so the customer keeps the quota they bought for the rest of the year.

/** Slots the org has paid for but nothing currently occupies. */
export function freeSlots(a: { paidDeviceSlots: number; paidDevices: number }): number {
  // Clamped: a data anomaly must degrade to "no free slot", never to free
  // activations.
  return Math.max(0, a.paidDeviceSlots - a.paidDevices);
}

/**
 * The entitlement after an invoice is paid. A subscription invoice — first
 * activation or renewal alike — REPLACES the entitlement with what it was
 * priced for, which is how a voluntary reduction settles once a year. A
 * proration adds exactly the one device it covers. An overage buys no slots.
 */
export function slotsAfterPayment(a: {
  kind: "subscription" | "proration" | "overage";
  currentSlots: number;
  invoiceDeviceCount: number | null;
}): number {
  switch (a.kind) {
    case "subscription":
      return Math.max(0, a.invoiceDeviceCount ?? 0);
    case "proration":
      return a.currentSlots + 1;
    case "overage":
      return a.currentSlots;
  }
}
