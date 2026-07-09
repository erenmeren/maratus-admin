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

/** Normalize a device serial (eFuse base MAC): strip `:`/`-`/space separators,
 *  lowercase. Valid only as exactly 12 hex chars. */
export function normalizeSerial(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/[:\-\s]/g, "").toLowerCase();
  return /^[0-9a-f]{12}$/.test(s) ? s : null;
}

// Firmware pairing codes: XXXX-XXXX from "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
// (no I, O, 0, 1). Validated server-side before any DB query.
const PAIRING_CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export function isValidPairingCode(code: string): boolean {
  return PAIRING_CODE_RE.test(code);
}

export type RegistryStatus = "manufactured" | "allocated" | "claimed" | "rma" | "retired";

export interface RegistryAllocationSnapshot {
  status: RegistryStatus;
  allocatedOrganizationId: string | null;
  allocatedStoreId: string | null;
}

/**
 * Auto-claim fires ONLY when no device row matches the polled code AND the
 * serial's registry row is `allocated` with both an org and a store. The serial
 * is public (printed on the box), so nothing else may ever mint a key from it:
 * `claimed` never re-fires (hijack guard), and a store-less allocation stays on
 * the human-claim path (store-less claimed devices are invisible to the
 * store-scoped device queries).
 */
export function shouldAutoClaim(
  deviceRowExists: boolean,
  registry: RegistryAllocationSnapshot | null,
): boolean {
  return (
    !deviceRowExists &&
    registry !== null &&
    registry.status === "allocated" &&
    registry.allocatedOrganizationId !== null &&
    registry.allocatedStoreId !== null
  );
}
