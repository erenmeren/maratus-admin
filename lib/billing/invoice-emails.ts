// lib/billing/invoice-emails.ts
// Generic transactional-email helpers, now that the invoice-specific email
// builders (invoiceSentEmail/paymentFailedEmail/paidReceiptEmail/
// overdueReminderEmail) are gone along with the invoice-enforcement flow.
// escapeHtml/emailLayout are shared by lib/alerts-sync.ts and
// lib/devices/device-emails.ts; getOrgEmailContext is the one IO helper,
// resolving org owner email + org name. Org names are user-controlled, so
// escapeHtml() guards every interpolation.

import { db } from "@/lib/db";
import { member, user, organization } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const BRAND = "Ditto";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

/** Resolve the org owner's email (fallback: any member) + the org name, for
 * addressing/personalising a transition email. ownerEmail is null when the org
 * has no members. */
export async function getOrgEmailContext(
  organizationId: string,
): Promise<{ ownerEmail: string | null; orgName: string }> {
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  const rows = await db
    .select({ email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, organizationId));

  const owner = rows.find((r) => r.role === "owner") ?? rows[0] ?? null;
  return { ownerEmail: owner?.email ?? null, orgName: org?.name ?? "your organization" };
}
