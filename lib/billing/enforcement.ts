// lib/billing/enforcement.ts
// Org payment-block decision used by ingest + the /api/v1 guard + the tenant
// layout. One read of subscription status + overdue invoices; pure verdict from
// lib/billing/dunning. Fails OPEN on any error — never block a paying customer
// because of an infra fault.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoice as invoiceTable, tenantSettings } from "@/lib/db/schema";
import { paymentBlockVerdict, isPastGrace } from "@/lib/billing/dunning";
import { reportError } from "@/lib/observability";

export async function isOrgPaymentBlocked(organizationId: string): Promise<{
  blocked: boolean;
  reason: "suspended" | "past_due" | null;
  hasOverdueInvoice: boolean;
}> {
  try {
    const now = new Date();
    const [settings] = await db
      .select({ status: tenantSettings.subscriptionStatus })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, organizationId))
      .limit(1);

    const overdue = await db
      .select({ status: invoiceTable.status, dueDate: invoiceTable.dueDate })
      .from(invoiceTable)
      .where(
        and(eq(invoiceTable.organizationId, organizationId), eq(invoiceTable.status, "overdue")),
      );

    const hasOverdueInvoice = overdue.length > 0;
    const hasPastGraceOverdue = overdue.some((r) => isPastGrace(r, now));
    const verdict = paymentBlockVerdict({
      subscriptionStatus: settings?.status ?? null,
      hasPastGraceOverdue,
    });
    return { ...verdict, hasOverdueInvoice };
  } catch (err) {
    reportError(err, { path: "enforcement.isOrgPaymentBlocked", extra: { organizationId } });
    return { blocked: false, reason: null, hasOverdueInvoice: false };
  }
}
