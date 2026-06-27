// Billing engine core (no auth/request context) — testable in isolation.
// The server action in lib/actions/billing.ts authorizes, then calls these.

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "./db";
import {
  invoice as invoiceTable,
  organization as orgTable,
  document as documentTable,
  tenantSettings as settingsTable,
} from "./db/schema";
import { id } from "./ids";

export interface InvoiceRun {
  created: number;
  updated: number;
  period: string;
}

/**
 * Compute a draft invoice per organization for the month containing `now`,
 * from actual document counts × the tenant's per-print price. Idempotent:
 * refreshes an existing draft for the period, never touches sent/paid invoices.
 */
export async function runInvoiceGeneration(now: Date): Promise<InvoiceRun> {
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  const period = periodStart.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const orgs = await db.select({ id: orgTable.id }).from(orgTable);
  let created = 0;
  let updated = 0;

  for (const org of orgs) {
    const [settings] = await db
      .select({ cents: settingsTable.perPrintPriceCents })
      .from(settingsTable)
      .where(eq(settingsTable.organizationId, org.id))
      .limit(1);
    const unitPriceCents = settings?.cents ?? 4;

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documentTable)
      .where(
        and(
          eq(documentTable.organizationId, org.id),
          gte(documentTable.createdAt, periodStart),
          lte(documentTable.createdAt, periodEnd),
        ),
      );
    const documentCount = Number(count);
    const amountDueCents = documentCount * unitPriceCents;

    const existingRows = await db
      .select()
      .from(invoiceTable)
      .where(eq(invoiceTable.organizationId, org.id));
    const existing = existingRows.find(
      (i) =>
        i.periodStart.getFullYear() === periodStart.getFullYear() &&
        i.periodStart.getMonth() === periodStart.getMonth(),
    );

    if (existing) {
      if (existing.status === "draft") {
        await db
          .update(invoiceTable)
          .set({ documentCount, unitPriceCents, amountDueCents })
          .where(eq(invoiceTable.id, existing.id));
        updated++;
      }
    } else {
      await db.insert(invoiceTable).values({
        id: id("inv"),
        organizationId: org.id,
        periodStart,
        periodEnd,
        documentCount,
        unitPriceCents,
        amountDueCents,
        status: "draft",
        createdAt: now,
      });
      created++;
    }
  }

  return { created, updated, period };
}
