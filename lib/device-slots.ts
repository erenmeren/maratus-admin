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
 *
 * The subscription branch never writes BELOW `paidDevices`, the org's actual
 * paid-device count at payment time. A renewal invoice's `deviceCount` is
 * fixed at ISSUANCE; if a device is prorated and paid for *after* issuance but
 * *before* the renewal is paid, the invoice's number under-counts what is
 * already paid and occupied. Replacing down to the stale, lower number would
 * not be a settlement — those devices are still there — it would confiscate
 * quota the customer already bought. A genuine voluntary reduction is
 * unaffected: the departed devices are already unpaid, so `paidDevices` has
 * already dropped and the invoice's (lower) number wins the max.
 */
export function slotsAfterPayment(a: {
  kind: "subscription" | "proration" | "overage";
  currentSlots: number;
  invoiceDeviceCount: number | null;
  paidDevices: number;
}): number {
  switch (a.kind) {
    case "subscription":
      return Math.max(0, a.invoiceDeviceCount ?? 0, a.paidDevices);
    case "proration":
      return a.currentSlots + 1;
    case "overage":
      return a.currentSlots;
  }
}
