"use server";
import { requirePlatformAdmin } from "@/lib/session";
import { grantCredits } from "@/lib/credits";
import { recordAudit, AUDIT } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { isOrgArchived } from "@/lib/archived-guard";

export type GrantState = { ok: boolean; error?: string };

export async function grantCreditsAction(
  _prev: GrantState,
  formData: FormData,
): Promise<GrantState> {
  const ctx = await requirePlatformAdmin();
  const orgId = String(formData.get("organizationId") ?? "");
  const credits = Number(formData.get("credits") ?? 0);
  const note = String(formData.get("note") ?? "").trim() || undefined;
  if (
    !orgId ||
    !Number.isInteger(credits) ||
    credits <= 0 ||
    credits > 1_000_000
  ) {
    return {
      ok: false,
      error: "Enter a whole credit amount between 1 and 1,000,000.",
    };
  }
  if (await isOrgArchived(orgId)) {
    return { ok: false, error: "Customer is archived." };
  }
  await grantCredits({
    organizationId: orgId,
    credits,
    kind: "grant",
    note,
    createdByUserId: ctx.user.id,
  });
  await recordAudit({
    organizationId: orgId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.creditsGranted,
    metadata: { credits, note },
  });
  revalidatePath(`/admin/customers/${orgId}`);
  return { ok: true };
}
