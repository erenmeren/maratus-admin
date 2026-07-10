// Pure offboarding logic (DB-free, unit-tested). The server action in
// lib/actions/offboarding.ts applies the DB mutations these helpers describe.

export type DeviceDisposition = "return_to_stock" | "leave_with_customer";

export interface DeviceChoice {
  deviceId: string;
  disposition: DeviceDisposition;
}

export type ArchivedStatus = "active" | "archived";

export function deriveArchivedStatus(
  archivedAt: Date | string | null | undefined,
): ArchivedStatus {
  return archivedAt ? "archived" : "active";
}

export function partitionDispositions(choices: DeviceChoice[]): {
  returnIds: string[];
  leaveIds: string[];
} {
  const returnIds: string[] = [];
  const leaveIds: string[] = [];
  for (const c of choices) {
    if (c.disposition === "return_to_stock") returnIds.push(c.deviceId);
    else leaveIds.push(c.deviceId);
  }
  return { returnIds, leaveIds };
}

export interface OffboardSummary {
  returnedToStock: number;
  leftWithCustomer: number;
  revokedKeys: number;
  sweptAllocations: number;
  frozenCreditsAvailable: number;
  frozenCreditsHeld: number;
}

export function buildOffboardMetadata(
  summary: OffboardSummary,
  note: string | null,
): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...summary };
  if (note) meta.note = note;
  return meta;
}
