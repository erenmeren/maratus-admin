// lib/devices/device-emails.ts
// Pure builder for the tenant-facing "device went offline" email (Phase 2B).
// Reuses the shared branded layout + escaping from the billing email module.
import {
  emailAccent,
  emailButton,
  emailDetails,
  emailEyebrow,
  emailHeading,
  emailLayout,
  emailNote,
  emailText,
  escapeHtml,
} from "@/lib/billing/invoice-emails";

export function deviceOfflineEmail(input: {
  orgName: string;
  devices: { name: string; storeName: string; lastSeenLabel: string }[];
}): { subject: string; html: string } {
  const n = input.devices.length;
  const subject = n === 1 ? "A Maratus printer went offline" : `${n} Maratus printers went offline`;
  const lead = n === 1 ? "One of your printers has" : `${n} of your printers have`;
  const body =
    emailEyebrow(escapeHtml(input.orgName)) +
    emailHeading(n === 1 ? `A printer went ${emailAccent("quiet.")}` : `${n} printers went ${emailAccent("quiet.")}`) +
    emailText(`${lead} stopped responding:`) +
    emailDetails(
      input.devices.map((d) => ({
        label: escapeHtml(d.storeName),
        value: `${escapeHtml(d.name)}<br/><span class="muted" style="font-size:13px;color:#6b6980">Last seen ${escapeHtml(d.lastSeenLabel)}</span>`,
      })),
    ) +
    emailText("If this is unexpected, check the device’s power and network connection. It will reconnect on its own once it’s back online.") +
    emailButton("https://console.maratus.co/tenant/devices", "View devices") +
    emailNote("You’re getting this because you own this Maratus account.");
  return { subject, html: emailLayout(body, { title: subject, preheader: `${lead} stopped responding.` }) };
}
