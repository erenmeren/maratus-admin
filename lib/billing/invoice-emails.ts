// lib/billing/invoice-emails.ts
// Phase 1C — invoice transition emails. The four builders are PURE (data in →
// {subject, html} out), mirroring lib/alerts.ts so they unit-test without IO.
// The one IO helper (getOrgEmailContext) is added in a later task. Org names are
// user-controlled, so escapeHtml() guards every interpolation of them.

export interface InvoiceEmailData {
  orgName: string;
  periodLabel: string;       // e.g. "Jun 2026" (from invoicePeriodLabel)
  amountDollars: number;     // amountDueCents / 100
  payUrl: string;            // hostedInvoiceUrl, or a billing-page fallback (caller resolves)
  dueDateLabel?: string;     // e.g. "July 14, 2026"
}

const BRAND = "Ditto";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDueDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function money(d: number): string {
  return `$${d.toFixed(2)}`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${url}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${label}</a></p>`;
}

/** Wrap a body fragment in the shared branded shell. */
export function emailLayout(bodyHtml: string): string {
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#111">` +
    `<div style="font-weight:700;font-size:18px;margin-bottom:20px">${BRAND}</div>` +
    bodyHtml +
    `<hr style="border:none;border-top:1px solid #eee;margin:28px 0"/>` +
    `<p style="color:#888;font-size:12px">${BRAND} — paperless documents. Manage billing in your dashboard.</p>` +
    `</div>`
  );
}

export function invoiceSentEmail(d: InvoiceEmailData): { subject: string; html: string } {
  const due = d.dueDateLabel ? `, due ${escapeHtml(d.dueDateLabel)}` : "";
  const body =
    `<p>Hi ${escapeHtml(d.orgName)},</p>` +
    `<p>Your invoice for <strong>${escapeHtml(d.periodLabel)}</strong> is ready: <strong>${money(d.amountDollars)}</strong>${due}.</p>` +
    button(d.payUrl, "Pay invoice");
  return { subject: `Your ${BRAND} invoice for ${d.periodLabel}`, html: emailLayout(body) };
}

export function paymentFailedEmail(d: InvoiceEmailData): { subject: string; html: string } {
  const body =
    `<p>Hi ${escapeHtml(d.orgName)},</p>` +
    `<p>We couldn't process payment for your <strong>${escapeHtml(d.periodLabel)}</strong> invoice (${money(d.amountDollars)}). Please update your payment method to avoid interruption.</p>` +
    button(d.payUrl, "Update payment");
  return { subject: `Payment failed for your ${BRAND} invoice`, html: emailLayout(body) };
}

export function paidReceiptEmail(d: InvoiceEmailData): { subject: string; html: string } {
  const body =
    `<p>Hi ${escapeHtml(d.orgName)},</p>` +
    `<p>We received your payment of <strong>${money(d.amountDollars)}</strong> for <strong>${escapeHtml(d.periodLabel)}</strong>. Thank you!</p>`;
  return { subject: `Payment received — ${d.periodLabel}`, html: emailLayout(body) };
}

export function overdueReminderEmail(d: InvoiceEmailData): { subject: string; html: string } {
  const was = d.dueDateLabel ? ` (was due ${escapeHtml(d.dueDateLabel)})` : "";
  const body =
    `<p>Hi ${escapeHtml(d.orgName)},</p>` +
    `<p>Your <strong>${escapeHtml(d.periodLabel)}</strong> invoice (${money(d.amountDollars)}) is past due${was}. Please pay now to avoid interruption of service.</p>` +
    button(d.payUrl, "Pay now");
  return { subject: `Your ${BRAND} invoice is overdue`, html: emailLayout(body) };
}
