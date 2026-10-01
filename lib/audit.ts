// lib/audit.ts
// Best-effort audit logging. recordAudit never throws into its caller — auditing
// a device delete must not be able to fail the delete.

import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { id } from "@/lib/ids";

export type AuditActor =
  | { type: "user"; id: string; label: string }
  | { type: "system" }
  | { type: "stripe" };

/** Action name constants (stringly-typed at the DB; centralized here). */
export const AUDIT = {
  orgCreated: "org.created",
  orgSuspended: "org.suspended",
  orgReactivated: "org.reactivated",
  customerCreated: "customer.created",
  customerRenamed: "customer.renamed",
  deviceProvisioned: "device.provisioned",
  deviceRenamed: "device.renamed",
  deviceRegisterChanged: "device.register_changed",
  deviceReassigned: "device.reassigned",
  deviceUnassigned: "device.unassigned",
  deviceCommandEnqueued: "device.command_enqueued",
  deviceDeleted: "device.deleted",
  devicePaused: "device.paused",
  deviceResumed: "device.resumed",
  devicePinSet: "device.pin_set",
  devicePinCleared: "device.pin_cleared",
  devicePinModeNone: "device.pin_mode_none",
  orgPinSet: "org.pin_set",
  orgPinCleared: "org.pin_cleared",
  storePinSet: "store.pin_set",
  storePinCleared: "store.pin_cleared",
  storePinModeNone: "store.pin_mode_none",
  deviceClaimed: "device.claimed",
  deviceWentOffline: "device.went_offline",
  storeCreated: "store.created",
  storeUpdated: "store.updated",
  storeDeleted: "store.deleted",
  apiKeyCreated: "api_key.created",
  apiKeyRevoked: "api_key.revoked",
  apiKeyPlaygroundIssued: "api_key.playground_issued",
  brandingUpdated: "branding.updated",
  deviceSettingsUpdated: "device_settings.updated",
  memberInvited: "member.invited",
  memberAdded: "member.added",
  memberRemoved: "member.removed",
  memberRoleChanged: "member.role_changed",
  invitationCanceled: "invitation.canceled",
  deviceAutoClaimed: "device.auto_claimed",
  deviceSerialConflict: "device.serial_conflict",
  registryAllocated: "registry.allocated",
  registryDeallocated: "registry.deallocated",
  registryClaimReverted: "registry.claim_reverted",
  // Two constants rather than one with the status in metadata: the audit
  // tables render the LABEL only, and these are money-affecting events (both
  // release the device's paid slot) that must be readable at a glance.
  registryMarkedRma: "registry.marked_rma",
  registryRetired: "registry.retired",
  registryAllocationConflict: "registry.allocation_conflict",
  orgArchived: "org.archived",
  orgRestored: "org.restored",
  deviceReturnedToStock: "device.returned_to_stock",
  deviceLeftWithCustomer: "device.left_with_customer",
  invoiceIssued: "invoice.issued",
  invoicePaid: "invoice.paid",
  invoiceVoided: "invoice.void",
} as const;

export async function recordAudit(input: {
  organizationId: string;
  actor: AuditActor;
  action: string;
  target?: { type: string; id: string };
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: id("aud"),
      organizationId: input.organizationId,
      actorType: input.actor.type,
      actorId: input.actor.type === "user" ? input.actor.id : null,
      actorLabel: input.actor.type === "user" ? input.actor.label : input.actor.type,
      action: input.action,
      targetType: input.target?.type ?? null,
      targetId: input.target?.id ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (err) {
    console.error("[audit] failed to record", input.action, err);
  }
}
