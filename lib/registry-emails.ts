// Pure builder for the platform-admin "device auto-claimed" notification.
// Auto-claim is the zero-touch, no-human-approval allocated→claimed transition
// (see autoClaimDevice in lib/factory-registry.ts) — the serial on the box is
// public and the pairing code space is small, so this email is the only
// signal platform admins get to notice an unexpected/hijacking claim. See
// docs/runbooks/factory-registry-hijack-recovery.md for what to do about it.
import {
  emailAccent,
  emailDetails,
  emailEyebrow,
  emailHeading,
  emailLayout,
  emailText,
  escapeHtml,
} from "@/lib/billing/invoice-emails";

export function autoClaimEmail(input: {
  serial: string;
  orgName: string;
  deviceId: string;
  claimedAt: Date;
}): { subject: string; html: string } {
  const subject = `Device auto-claimed: ${input.serial}`;
  const when = `${input.claimedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const body =
    emailEyebrow("Factory registry") +
    emailHeading(`A device claimed ${emailAccent("itself.")}`) +
    emailText("A factory-registry device was auto-claimed — zero-touch, no human approval:") +
    emailDetails([
      { label: "Serial", value: escapeHtml(input.serial) },
      { label: "Organization", value: escapeHtml(input.orgName) },
      { label: "Device ID", value: escapeHtml(input.deviceId) },
      { label: "Claimed at", value: escapeHtml(when) },
    ]) +
    emailText(
      `If this wasn’t expected, follow the hijack-recovery runbook: ` +
        `<code style="font-family:'Courier New',Courier,monospace;font-size:13px">docs/runbooks/factory-registry-hijack-recovery.md</code>`,
    );
  return { subject, html: emailLayout(body, { title: subject, preheader: `${escapeHtml(input.serial)} → ${escapeHtml(input.orgName)}` }) };
}
