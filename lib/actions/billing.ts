"use server";

// Billing engine actions (platform-admin only). Authorization here; the
// computation lives in lib/billing-engine.ts so it can be tested in isolation.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoice as invoiceTable } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { runInvoiceGeneration } from "@/lib/billing-engine";
import { sendInvoiceToStripe } from "@/lib/billing/stripe-billing";
import { stripe } from "@/lib/stripe";
import { recordAudit, AUDIT } from "@/lib/audit";

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

/** Advance an invoice. draft → sent now creates a payable Stripe invoice; sent → paid is a manual override. */
export async function advanceInvoice(
  invoiceId: string,
): Promise<InvoiceActionResult> {
  const ctx = await requirePlatformAdmin();

  const [inv] = await db
    .select()
    .from(invoiceTable)
    .where(eq(invoiceTable.id, invoiceId))
    .limit(1);
  if (!inv) return { ok: false, error: "Invoice not found." };

  if (inv.status === "draft") {
    const res = await sendInvoiceToStripe(invoiceId);
    if (!res.ok) {
      const message: Record<typeof res.reason, string> = {
        not_found: "Invoice not found.",
        already_sent: "Invoice was already sent.",
        no_amount: "Nothing to collect — this invoice is $0.",
        stripe_disabled: "Billing is not configured.",
      };
      return { ok: false, error: message[res.reason] };
    }
    await recordAudit({
      organizationId: inv.organizationId,
      actor: { type: "user", id: ctx.user.id, label: ctx.user.name || ctx.user.email },
      action: AUDIT.invoiceSent,
      target: { type: "invoice", id: invoiceId },
      metadata: {
        stripeInvoiceId: res.stripeInvoiceId,
        collectionMethod: res.collectionMethod,
        amountDueCents: inv.amountDueCents,
      },
    });
    revalidatePath("/admin/billing");
    revalidatePath("/admin");
    return { ok: true };
  }

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

/** Void an invoice. If it has a Stripe invoice, void it there too (webhook reconciles); else flip locally. Paid invoices cannot be voided. */
export async function voidInvoice(
  invoiceId: string,
): Promise<InvoiceActionResult> {
  const ctx = await requirePlatformAdmin();

  const [inv] = await db
    .select()
    .from(invoiceTable)
    .where(eq(invoiceTable.id, invoiceId))
    .limit(1);
  if (!inv) return { ok: false, error: "Invoice not found." };
  if (inv.status === "void") return { ok: false, error: "Invoice is already void." };
  if (inv.status === "paid") return { ok: false, error: "Cannot void a paid invoice." };

  if (inv.stripeInvoiceId && stripe) {
    try {
      await stripe.invoices.voidInvoice(inv.stripeInvoiceId);
    } catch {
      return { ok: false, error: "Could not void the invoice in Stripe." };
    }
  }

  await db
    .update(invoiceTable)
    .set({ status: "void" })
    .where(eq(invoiceTable.id, invoiceId));

  await recordAudit({
    organizationId: inv.organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.name || ctx.user.email },
    action: AUDIT.invoiceVoid,
    target: { type: "invoice", id: invoiceId },
    metadata: { stripeInvoiceId: inv.stripeInvoiceId ?? null },
  });

  revalidatePath("/admin/billing");
  revalidatePath("/admin");
  return { ok: true };
}
