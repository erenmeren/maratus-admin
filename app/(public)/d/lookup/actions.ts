"use server";

import { getEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/lookup/normalize";
import {
  recordDocumentContact, upsertMarketingContact, createLookupToken,
} from "@/lib/lookup/store";
import { getDocumentByTokenMeta } from "@/lib/documents";
import { sendEmail } from "@/lib/email";
import { documentEmail, lookupEmail } from "@/lib/lookup/email-templates";

const RL = { limit: 5, windowMs: 60_000 };

export async function requestDocumentEmail(formData: FormData): Promise<{ ok: boolean }> {
  const token = String(formData.get("token") ?? "");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const optIn = formData.get("optIn") === "on";
  if (!email) return { ok: false };

  const rl = await checkRateLimit(`doc-email:${email}`, RL);
  if (!rl.allowed) return { ok: true }; // generic — don't reveal throttling

  const doc = await getDocumentByTokenMeta(token);
  if (doc) {
    await recordDocumentContact({ organizationId: doc.organizationId, documentId: doc.id, email });
    if (optIn) await upsertMarketingContact({ organizationId: doc.organizationId, email });
    const url = `${getEnv().BETTER_AUTH_URL}/d/${token}`;
    const { subject, html } = documentEmail({ orgName: doc.organizationName, documentUrl: url });
    await sendEmail(email, subject, html);
  }
  return { ok: true }; // always generic
}

export async function requestLookupLink(formData: FormData): Promise<{ ok: boolean }> {
  const orgId = String(formData.get("orgId") ?? "");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email || !orgId) return { ok: true };

  const rl = await checkRateLimit(`lookup-link:${email}`, RL);
  if (!rl.allowed) return { ok: true };

  const { raw } = await createLookupToken({ organizationId: orgId, email });
  const url = `${getEnv().BETTER_AUTH_URL}/d/lookup/${orgId}/${raw}`;
  const orgName = await orgNameById(orgId);
  const { subject, html } = lookupEmail({ orgName, recoveryUrl: url });
  await sendEmail(email, subject, html);
  return { ok: true }; // always generic — no enumeration
}

async function orgNameById(orgId: string): Promise<string> {
  const { db } = await import("@/lib/db");
  const { organization } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId)).limit(1);
  return row?.name ?? "your merchant";
}
