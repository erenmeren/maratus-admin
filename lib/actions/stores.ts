"use server";

// Store mutations (tenant-scoped). Create a new branch in the active org.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { store as storeTable } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { id } from "@/lib/ids";

export interface CreateStoreResult {
  ok: boolean;
  error?: string;
  storeId?: string;
}

export async function createStore(
  formData: FormData,
): Promise<CreateStoreResult> {
  const { ctx, organizationId } = await requireTenant();

  // Authorize: only owners/admins may add stores.
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission to add stores." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  if (!name) return { ok: false, error: "Store name is required." };

  const storeId = id("str");
  await db.insert(storeTable).values({
    id: storeId,
    organizationId,
    name,
    address,
    createdAt: new Date(),
  });

  revalidatePath("/tenant/stores");
  revalidatePath("/tenant");
  return { ok: true, storeId };
}
