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
 * Normally zero, and a non-zero result is NOT by itself money owed. Two
 * different sequences produce it:
 *
 * 1. EXPECTED — the lead-window proration. A device claimed in the renewal
 *    lead window is prorated through the END of the upcoming period (a ~13
 *    month charge), so when that proration is paid and the renewal is paid
 *    after it, the floor writes a slot the renewal invoice was not priced for
 *    — but the customer already paid for it, on the proration. Billing the
 *    difference off-system here would DOUBLE-BILL.
 * 2. Genuinely unpriced — an org drops from 2 devices to 1, the cron prices
 *    the renewal at 1, and a device claims into the still-vacant slot for
 *    free (correct for the remainder of the OLD year) with no proration
 *    covering the new period.
 *
 * The floor stays either way: the alternative is confiscating quota the
 * customer paid for, which is worse, and case 2 self-corrects at the
 * following renewal (bounded at one device-year). This function exists so the
 * operator can SEE the surplus — but before billing anything off-system they
 * must check the org's PAID prorations and whether any of them covers the
 * renewal period (compare a proration's periodEnd with the renewal's).
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

/**
 * What a renewal payment writes to `paidDeviceSlots` NOW, and what it parks
 * for the anniversary. A renewal is issued 30 days early and priced at that
 * moment's paid-device count; when it is paid before the anniversary and that
 * count is LOWER than the current entitlement (a slot went vacant via RMA or
 * removal), the customer still owns the old year's slots through its last
 * day. Shrinking immediately would bill overage against a pool they paid
 * for, so the lower number is parked (`pending`) and applied by the billing
 * cron once the anniversary has passed. Paid at/after the anniversary, or
 * not lower at all → write it now, nothing pending.
 */
export function renewalSlotWrite(a: {
  currentSlots: number;
  newSlots: number;
  paidBeforeAnniversary: boolean;
}): { writeNow: number; pending: number | null } {
  if (!a.paidBeforeAnniversary || a.newSlots >= a.currentSlots) {
    return { writeNow: a.newSlots, pending: null };
  }
  return { writeNow: a.currentSlots, pending: a.newSlots };
}

/** The parked count takes effect, but never below what is paid by then — a
 *  proration settled in the meantime added a slot the customer paid for. */
export function applyPendingSlots(a: { pending: number; paidDevices: number }): number {
  return Math.max(a.pending, a.paidDevices);
}

/**
 * The entitlement that bounds NEW activations. While a shrink is parked (see
 * renewalSlotWrite), new activations are bounded by the parked count — the
 * old-year slots are paid for through the anniversary but must not be handed
 * out for the new year, or a device would occupy one, be kept by
 * applyPendingSlots' paid-device floor, and ride a whole year unpriced.
 * Never above what is actually paid for.
 */
export function effectiveSlots(a: {
  paidDeviceSlots: number;
  pendingDeviceSlots: number | null;
}): number {
  return a.pendingDeviceSlots === null
    ? a.paidDeviceSlots
    : Math.min(a.paidDeviceSlots, a.pendingDeviceSlots);
}
