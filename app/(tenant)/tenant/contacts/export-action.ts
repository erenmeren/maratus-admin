"use server";

import { requireTenant } from "@/lib/session";
import { getMarketingContacts } from "@/lib/data";

export async function exportContactsCsv(): Promise<{ filename: string; csv: string }> {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!role || !["owner", "admin"].includes(role)) {
    return { filename: "contacts.csv", csv: "" };
  }
  const rows = await getMarketingContacts(organizationId);
  const header = "email,opted_in_at\n";
  const body = rows
    .map((r) => `${csvCell(r.email)},${csvCell(r.optInAt.toISOString())}`)
    .join("\n");
  return { filename: "contacts.csv", csv: header + body };
}

function csvCell(s: string): string {
  // Neutralize CSV formula injection: a cell a spreadsheet would evaluate as a
  // formula (leading = + - @, tab, or CR) is prefixed with a single quote.
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  // Quote if the (guarded) value contains a comma, quote, CR, or LF.
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
