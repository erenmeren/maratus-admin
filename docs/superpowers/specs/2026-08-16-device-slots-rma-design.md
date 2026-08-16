# Device Slots — RMA, Replacement and Voluntary Removal

**Date:** 2026-08-16
**Status:** Approved

## Context & Goal

The subscription billing shipped on 2026-08-15 has no concept of a device
*leaving*. `device.subscriptionPaidAt` is written once and no code path ever
clears it, so:

- A device that breaks keeps its paid status forever. Marking its serial `rma`
  in `/admin/inventory` does not touch billing at all — the two systems are
  unaware of each other. The customer keeps paying for a dead device and its
  1000 triggers keep inflating the org's pool.
- The replacement device is treated as brand new: claiming it issues a
  **proration invoice**, so the customer is asked to pay twice inside the same
  year for what is, to them, one device.

There is also a latent defect the final review of that branch found and
deferred: activation currently compares `invoice.deviceCount` against a live
count of paid devices, so hard-deleting a paid device frees an activation slot
by accident. That accidental behaviour is roughly the right *outcome* for an
RMA — this spec makes it deliberate and correct instead of a side effect.

Decisions made with the operator:

1. **A replacement inherits the dead device's slot. No refund, no extra
   charge.** The customer bought a service, not a device.
2. **The transfer is automatic.** If the org has a free slot, a newly claimed
   device is activated without a proration invoice. The operator's only action
   is marking the old serial `rma` in inventory.
3. **Voluntary removal behaves identically.** A slot is held until the
   subscription year ends and is only recomputed at renewal, where it naturally
   falls to whatever the customer actually runs. One mechanism covers both
   cases; there is no "why was this removed" flag to get wrong.
4. **Quota is derived from slots, not from devices.** Otherwise an RMA'd device
   would shrink the pool and decision 1 would be meaningless.

Out of scope: any customer-facing fault-reporting channel (tracked separately),
refunds or credit notes, and partial-month proration on removal.

## 1. Data model

### `tenantSettings`

| Action | Column |
|---|---|
| Add | `paidDeviceSlots` — `integer`, default `0`, not null |

This is the number of device slots the org has **paid for**. It is the org's
entitlement, and it deliberately outlives the devices occupying it.

No other schema change. `device.subscriptionPaidAt` keeps its meaning ("this
device occupies a paid slot") and gains the ability to be cleared.

### Derived quantities

```
paidDevices = count(device WHERE organizationId = ? AND subscriptionPaidAt IS NOT NULL)
freeSlots   = max(0, paidDeviceSlots - paidDevices)
includedQuota = paidDeviceSlots × includedTriggersPerDevice
```

**`includedQuota` changing from a device count to a slot count is the load-bearing
change in this spec.** It is what keeps an RMA from shrinking the customer's
pool mid-year.

## 2. Slot lifecycle

`paidDeviceSlots` changes in exactly three places, all inside `markInvoicePaid`:

| Invoice kind | Effect |
|---|---|
| `subscription` (first activation or renewal) | `slots = invoice.deviceCount` |
| `proration` | `slots += 1` |
| `overage` | no effect |

Nothing else writes it. In particular, **removing a device never decrements
it** — that is the whole point. The count is corrected once a year, when the
renewal invoice is priced against what the customer actually runs.

## 3. Flows

### Device goes to RMA (or is retired)

`setRegistryStatusAction(serial, "rma" | "retired")` gains a billing side
effect: the `device` row linked to that serial (`factoryDevice.deviceId`) has
its `subscriptionPaidAt` cleared.

Consequences, all automatic: the device fails the subscription gate and returns
`403 device_not_subscribed`; `paidDevices` drops by one so `freeSlots` becomes
1; `includedQuota` is unchanged because it reads slots.

If the serial has no linked device, or the device is already unpaid, the action
is a no-op on the billing side.

### Replacement device is claimed

In `lib/device-claim.ts`, after a successful claim and before the existing
proration logic:

```
if (freeSlots(org) > 0) → set subscriptionPaidAt = now, issue NO invoice
else                    → existing proration flow, device stays unpaid
```

The customer does nothing different. The operator does nothing beyond the
inventory status change.

**A device moving into a free slot must not leave an unpaid invoice behind.**
A device can already hold an open proration invoice and *later* find itself in
a free slot — it was claimed when the org was full, and a paid device was
RMA'd afterwards. When a device is activated into a free slot, any open
`proration` invoice for that device is voided (`status: "void"`, with a note
recording why). Without this the customer is still billed for a device that
was activated for free — the exact double-charge this spec exists to remove.
`canVoidInvoice` already permits voiding a proration, so no new capability is
needed.

### Renewal

`lib/billing-cron.ts` prices renewals with `countPaidDevices`, and that stays
correct under this model — because every way a device leaves already removes it
from that count:

- RMA / retired → `subscriptionPaidAt` cleared by the inventory action, so it
  is not counted.
- Deleted or returned to stock → the row is gone, so it is not counted.
- Still installed and paid → counted.

So a customer who dropped from 2 devices to 1 is billed for 1 automatically,
and when that invoice is paid `slots` becomes 1. **No change is needed in the
cron.** (An earlier draft of this spec called for pricing on "active claimed
devices"; that would have required joining `factoryDevice` to discover RMA
status, which is both slower and redundant.)

### First subscription payment

Unchanged in spirit, simplified in mechanics: `slots = invoice.deviceCount` is
written first, then unpaid claimed devices are activated until the slots are
full. The current `activatableDeviceCount` / `claimedAt <= issuedAt` guards
exist to stop a lead-window device riding a renewal for free; with an explicit
slot counter the same protection falls out of "you cannot occupy a slot that
does not exist", so those guards are replaced rather than kept alongside.

## 4. Edge cases

- **Device RMA'd after its renewal invoice was issued but before payment.** The
  invoice stands. On payment `slots = invoice.deviceCount`, so the customer gets
  the slot they paid for and it sits empty. Correct: they paid for it.
- **Serial marked `rma` while unclaimed.** No billing effect; nothing owns it.
- **Trial devices never occupy slots.** An unpaid device has
  `subscriptionPaidAt IS NULL` by definition, so it neither fills a slot nor
  contributes quota. Its 50-trigger trial is unaffected.
- **Hard-deleted devices.** `deleteDevice` and `returnDeviceToStock` remove the
  row entirely. Because the slot lives on `tenantSettings`, the entitlement
  survives — which closes the deferred "deleted device frees an activation slot"
  defect by making that outcome intentional and bounded.
- **`freeSlots` can never go negative** (clamped), so a data anomaly degrades to
  "no free slot" rather than to free activations.
- **Archived orgs** are excluded from the billing sweep already; nothing here
  changes that.

## 5. Migration

Additive, single column, safe on a running system.

**Migration:** add `tenantSettings.paidDeviceSlots` (integer, default 0, not null).

**Backfill:** `paidDeviceSlots = count(devices WHERE subscriptionPaidAt IS NOT
NULL)` per org. On production today that yields `1` for the single existing org.
Run it in the same sitting as the migration — until it runs, every org reads 0
slots, which would zero out quotas and refuse replacement activations.

## 6. Code inventory

**Added:** `lib/device-slots.ts` — pure slot arithmetic (`freeSlots`,
`slotsAfterPayment`), plus its test file.

**Modified:**
- `lib/db/schema.ts` — the new column.
- `lib/invoices.ts` — `markInvoicePaid` writes slots; the activation guards are
  replaced by the slot check.
- `lib/device-claim.ts` — free-slot check before the proration path.
- `lib/actions/inventory.ts` / `lib/factory-registry.ts` — RMA/retire clears
  `subscriptionPaidAt`.
- `lib/billing-cron.ts` — no change needed (see §3 Renewal); listed here only
  so an implementer does not go looking for one.
- `lib/data.ts` — `getTenantBillingOverview` and `getBillingOverview` read
  quota from slots; the tenant page should show slots and how many are free.
- `components/billing/subscription-card.tsx` — show slots vs. occupied.

## 7. Testing

The money arithmetic goes in the pure module and is tested there, matching the
repo's pure-suite design (`vitest.config.ts` includes only `lib/**/*.test.ts`;
nothing touches a database):

- `freeSlots` — normal case, exact fit, over-subscribed (clamped to 0), zero
  slots.
- `slotsAfterPayment` — first subscription sets, renewal overwrites (including
  downward), proration increments, overage no-ops.
- Quota derivation — an RMA'd device does not shrink the pool; a dropped device
  does not shrink it until renewal.

DB-bound wiring (the inventory side effect, the claim-time slot check) is
verified by typecheck and reading, as elsewhere in this codebase.

## Open items

- Customer-facing fault reporting: no channel exists today; the customer phones
  the operator. Tracked as separate work.
- Refunds and credit notes are deliberately absent — the model has no mechanism
  for returning money, and decision 1 removes the need for one.
