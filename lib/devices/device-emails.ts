// lib/devices/device-emails.ts
// Pure builder for the tenant-facing "device went offline" email (Phase 2B).
// Reuses the shared branded layout + escaping from the billing email module.
import { emailLayout, escapeHtml } from "@/lib/billing/invoice-emails";

export function deviceOfflineEmail(input: {
  orgName: string;
  devices: { name: string; storeName: string; lastSeenLabel: string }[];
}): { subject: string; html: string } {
  const n = input.devices.length;
  const subject = n === 1 ? "A Ditto printer went offline" : `${n} Ditto printers went offline`;
  const items = input.devices
    .map(
      (d) =>
        `<li><strong>${escapeHtml(d.name)}</strong> — ${escapeHtml(d.storeName)} · last seen ${escapeHtml(d.lastSeenLabel)}</li>`,
    )
    .join("");
  const lead = n === 1 ? "One of your printers has" : `${n} of your printers have`;
  const body =
    `<p>Hi ${escapeHtml(input.orgName)},</p>` +
    `<p>${lead} stopped responding:</p>` +
    `<ul>${items}</ul>` +
    `<p>If this is unexpected, check the device's power and network connection.</p>`;
  return { subject, html: emailLayout(body) };
}
