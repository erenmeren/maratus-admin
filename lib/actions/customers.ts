"use server";

// Customer (organization/tenant) mutations — platform-admin only.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organization, tenantSettings } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { id } from "@/lib/ids";

export interface CreateCustomerResult {
  ok: boolean;
  error?: string;
  organizationId?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export async function createCustomer(
  formData: FormData,
): Promise<CreateCustomerResult> {
  await requirePlatformAdmin();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Company name is required." };

  // Per-print price comes in as dollars; store as integer cents.
  const priceDollars = Number(formData.get("price"));
  const perPrintPriceCents =
    Number.isFinite(priceDollars) && priceDollars >= 0
      ? Math.round(priceDollars * 100)
      : 4;

  // Unique slug (append a short suffix if taken).
  let slug = slugify(name) || "customer";
  const existing = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);
  if (existing.length > 0) slug = `${slug}-${id("x").slice(2, 6).toLowerCase()}`;

  const orgId = id("org");
  await db.insert(organization).values({
    id: orgId,
    name,
    slug,
    createdAt: new Date(),
  });

  await db.insert(tenantSettings).values({
    organizationId: orgId,
    perPrintPriceCents,
    status: "active",
  });

  revalidatePath("/admin/customers");
  revalidatePath("/admin");
  revalidatePath("/admin/billing");
  return { ok: true, organizationId: orgId };
}
