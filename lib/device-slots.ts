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
 * How many slots a subscription payment writes that its invoice was never
 * priced for — the size of the `max(…, paidDevices)` floor in
 * `slotsAfterPayment` when it actually fires.
 *
 * Normally zero. It is non-zero on a reachable, blameless sequence: an org
 * drops from 2 devices to 1, the cron prices the renewal at 1, a device then
 * claims into the still-vacant slot during the lead window (correctly free
 * for the remainder of the OLD year), and the renewal is paid — so the floor
 * writes 2 slots against an invoice for 1 and the customer runs two devices
 * for a year having paid for one.
 *
 * The floor stays: the alternative is confiscating quota the customer paid
 * for, which is worse, and the leak self-corrects at the following renewal
 * (bounded at one device-year). This function exists so the operator can SEE
 * it — nothing surfaced it before.
 */
export function unpricedSlots(a: {
  invoiceDeviceCount: number | null;
  paidDevices: number;
}): number {
  return Math.max(0, a.paidDevices - (a.invoiceDeviceCount ?? 0));
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
