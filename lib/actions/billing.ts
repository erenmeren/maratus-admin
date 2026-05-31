"use server";

// Billing engine actions (platform-admin only). Authorization here; the
// computation lives in lib/billing-engine.ts so it can be tested in isolation.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoice as invoiceTable } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { runInvoiceGeneration } from "@/lib/billing-engine";

export interface GenerateInvoicesResult {
  ok: boolean;
  error?: string;
  created: number;
  updated: number;
  period: string;
}

export async function generateInvoices(): Promise<GenerateInvoicesResult> {
  await requirePlatformAdmin();
  const run = await runInvoiceGeneration(new Date());
  revalidatePath("/admin/billing");
  revalidatePath("/admin");
  return { ok: true, ...run };
}

export interface InvoiceActionResult {
  ok: boolean;
  error?: string;
}

const NEXT_STATUS: Record<string, "sent" | "paid" | null> = {
  draft: "sent",
  sent: "paid",
  paid: null,
};

/** Advance an invoice: draft → sent → paid. */
export async function advanceInvoice(
  invoiceId: string,
): Promise<InvoiceActionResult> {
  await requirePlatformAdmin();

  const [inv] = await db
    .select()
    .from(invoiceTable)
    .where(eq(invoiceTable.id, invoiceId))
    .limit(1);
  if (!inv) return { ok: false, error: "Invoice not found." };

  const next = NEXT_STATUS[inv.status];
  if (!next) return { ok: false, error: "Invoice is already paid." };

  await db
    .update(invoiceTable)
    .set({ status: next })
    .where(eq(invoiceTable.id, invoiceId));

  revalidatePath("/admin/billing");
  revalidatePath("/admin");
  return { ok: true };
}

/** Set an invoice to a specific status (draft|sent|paid). */
export async function setInvoiceStatus(
  invoiceId: string,
  status: "draft" | "sent" | "paid",
): Promise<InvoiceActionResult> {
  await requirePlatformAdmin();
  await db
    .update(invoiceTable)
    .set({ status })
    .where(eq(invoiceTable.id, invoiceId));
  revalidatePath("/admin/billing");
  revalidatePath("/admin");
  return { ok: true };
}
