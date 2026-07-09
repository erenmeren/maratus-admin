// lib/audit-labels.ts
// Pure: turn raw audit action strings (lib/audit.ts AUDIT.*) into human-readable
// labels. Every known action is mapped; humanizeAction() is the safe fallback for
// any future/unmapped string. No IO.

export const AUDIT_LABELS: Record<string, string> = {
  "org.created": "Organization created",
  "org.suspended": "Organization suspended",
  "org.reactivated": "Organization reactivated",
  "subscription.status_changed": "Subscription status changed",
  "invoice.paid": "Invoice paid",
  "invoice.payment_failed": "Payment failed",
  "invoice.void": "Invoice voided",
  "invoice.sent": "Invoice sent",
  "invoice.overdue": "Invoice overdue",
  "billing.activated": "Billing activated",
  "customer.created": "Customer created",
  "device.provisioned": "Device provisioned",
  "device.renamed": "Device renamed",
  "device.reassigned": "Device reassigned",
  "device.unassigned": "Device unassigned",
  "device.command_enqueued": "Command sent to device",
  "device.deleted": "Device deleted",
  "device.paused": "Device paused",
  "device.resumed": "Device resumed",
  "device.claimed": "Device claimed",
  "device.went_offline": "Device went offline",
  "store.created": "Store created",
  "store.updated": "Store updated",
  "api_key.created": "API key created",
  "api_key.revoked": "API key revoked",
  "branding.updated": "Branding updated",
  "device_settings.updated": "Device settings updated",
  "member.invited": "Member invited",
  "member.added": "Member added",
  "member.removed": "Member removed",
  "member.role_changed": "Member role changed",
  "invitation.canceled": "Invitation canceled",
  "credits.granted": "Credits granted",
  "credits.purchased": "Credits purchased",
  "device.auto_claimed": "Device auto-claimed",
  "device.serial_conflict": "Duplicate device serial detected",
  "registry.allocated": "Inventory allocated",
  "registry.deallocated": "Inventory allocation removed",
};

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Fallback for any action not in AUDIT_LABELS: "device.command_enqueued" → "Device: Command enqueued". */
export function humanizeAction(action: string): string {
  const dot = action.indexOf(".");
  const entity = (dot === -1 ? action : action.slice(0, dot)).replace(/_/g, " ");
  const verb = (dot === -1 ? "" : action.slice(dot + 1)).replace(/_/g, " ");
  return verb ? `${cap(entity)}: ${cap(verb)}` : cap(entity);
}

export function actionLabel(action: string): string {
  return AUDIT_LABELS[action] ?? humanizeAction(action);
}
