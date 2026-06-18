// Pure decision logic for the device claim-poll (GET /api/device/claim). Kept
// DB-free so it is unit-testable; the route handler does the DB lookup + applies
// the `consume` mutation.

export interface ClaimPollDecision {
  status: "pending" | "claimed";
  /** Present only on the one fetch that delivers the key. */
  deviceKey?: string;
  /** When true, the caller must null pendingDeviceKey + pairingCode (deliver once). */
  consume: boolean;
}

/**
 * Decide the claim-poll response from the matched device row (or null).
 * - no row            → pending (not claimed yet)
 * - pendingDeviceKey  → claimed + deliver the key, then consume
 * - key already gone  → claimed, no key
 */
export function classifyClaimPoll(
  device: { pendingDeviceKey: string | null } | null,
): ClaimPollDecision {
  if (!device) return { status: "pending", consume: false };
  if (device.pendingDeviceKey) {
    return { status: "claimed", deviceKey: device.pendingDeviceKey, consume: true };
  }
  return { status: "claimed", consume: false };
}
