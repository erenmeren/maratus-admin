// Pure builder for the platform-admin "device auto-claimed" notification.
// Auto-claim is the zero-touch, no-human-approval allocated→claimed transition
// (see autoClaimDevice in lib/factory-registry.ts) — the serial on the box is
// public and the pairing code space is small, so this email is the only
// signal platform admins get to notice an unexpected/hijacking claim. See
// docs/runbooks/factory-registry-hijack-recovery.md for what to do about it.
import { emailLayout, escapeHtml } from "@/lib/billing/invoice-emails";

export function autoClaimEmail(input: {
  serial: string;
  orgName: string;
  deviceId: string;
  claimedAt: Date;
}): { subject: string; html: string } {
  const subject = `Device auto-claimed: ${input.serial}`;
  const when = `${input.claimedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const body =
    `<p>A factory-registry device was auto-claimed — zero-touch, no human approval:</p>` +
    `<ul>` +
    `<li><strong>Serial:</strong> ${escapeHtml(input.serial)}</li>` +
    `<li><strong>Organization:</strong> ${escapeHtml(input.orgName)}</li>` +
    `<li><strong>Device ID:</strong> ${escapeHtml(input.deviceId)}</li>` +
    `<li><strong>Claimed at:</strong> ${escapeHtml(when)}</li>` +
    `</ul>` +
    `<p>If this wasn't expected, see the hijack-recovery runbook: ` +
    `<code>docs/runbooks/factory-registry-hijack-recovery.md</code>.</p>`;
  return { subject, html: emailLayout(body) };
}
