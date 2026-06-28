// lib/billing/billing-cron.ts
// The daily billing job (Phase 1B). Self-healing + idempotent: always processes
// the PREVIOUS calendar month, so a missed cron day catches up on the next run.
//   1. generate last month's draft invoices
//   2. auto-send drafts for tenants WITH a saved card (charge_automatically)
//   3. sweep sent invoices past their dueDate → overdue
import { and, eq, gte, lt, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoice as invoiceTable, tenantSettings } from "@/lib/db/schema";
import { runInvoiceGeneration } from "@/lib/billing-engine";
import { previousMonthMarker } from "@/lib/billing/dunning";
import { sendInvoiceToStripe } from "@/lib/billing/stripe-billing";
import { recordAudit, AUDIT } from "@/lib/audit";

export async function runBillingCron(
  now: Date,
): Promise<{ generated: number; autoSent: number; sweptOverdue: number }> {
  const marker = previousMonthMarker(now);
  const periodStart = new Date(marker.getFullYear(), marker.getMonth(), 1);
  const periodEndExclusive = new Date(marker.getFullYear(), marker.getMonth() + 1, 1);

  // 1. Generate last month's drafts (idempotent — only touches draft rows).
  const run = await runInvoiceGeneration(marker);
  const generated = run.created + run.updated;

  // 2. Auto-send drafts for orgs that have a saved card (charge_automatically).
  const drafts = await db
    .select({ id: invoiceTable.id, cardLast4: tenantSettings.cardLast4 })
    .from(invoiceTable)
    .leftJoin(tenantSettings, eq(tenantSettings.organizationId, invoiceTable.organizationId))
    .where(
      and(
        eq(invoiceTable.status, "draft"),
        gte(invoiceTable.periodStart, periodStart),
        lt(invoiceTable.periodStart, periodEndExclusive),
      ),
    );
  let autoSent = 0;
  for (const d of drafts) {
    if (d.cardLast4 == null) continue; // no card → leave as draft for admin review
    const res = await sendInvoiceToStripe(d.id);
    if (res.ok) autoSent++;
  }

  // 3. Sweep sent invoices past due → overdue (+ audit each).
  const swept = await db
    .update(invoiceTable)
    .set({ status: "overdue" })
    .where(
      and(
        eq(invoiceTable.status, "sent"),
        isNotNull(invoiceTable.dueDate),
        lt(invoiceTable.dueDate, now),
      ),
    )
    .returning({
      id: invoiceTable.id,
      organizationId: invoiceTable.organizationId,
      dueDate: invoiceTable.dueDate,
    });
  for (const row of swept) {
    await recordAudit({
      organizationId: row.organizationId,
      actor: { type: "system" },
      action: AUDIT.invoiceOverdue,
      target: { type: "invoice", id: row.id },
      metadata: { dueDate: row.dueDate?.toISOString() ?? null },
    });
  }

  return { generated, autoSent, sweptOverdue: swept.length };
}
