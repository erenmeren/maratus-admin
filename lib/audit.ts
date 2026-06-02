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
  subscriptionStatusChanged: "subscription.status_changed",
  invoicePaid: "invoice.paid",
  invoicePaymentFailed: "invoice.payment_failed",
  invoiceVoid: "invoice.void",
  billingActivated: "billing.activated",
  customerCreated: "customer.created",
  deviceProvisioned: "device.provisioned",
  deviceRenamed: "device.renamed",
  deviceReassigned: "device.reassigned",
  deviceUnassigned: "device.unassigned",
  deviceDeleted: "device.deleted",
  devicePaused: "device.paused",
  deviceResumed: "device.resumed",
  deviceClaimed: "device.claimed",
  storeCreated: "store.created",
  brandingUpdated: "branding.updated",
  memberInvited: "member.invited",
  memberAdded: "member.added",
  memberRemoved: "member.removed",
  memberRoleChanged: "member.role_changed",
  invitationCanceled: "invitation.canceled",
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
