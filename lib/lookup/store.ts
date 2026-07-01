import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documentContact,
  marketingContact,
  lookupToken,
  document,
  tenantSettings,
} from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { hashLookupToken } from "@/lib/ids";
import { generateLookupToken, isLookupValid, LOOKUP_TTL_MS } from "./token";

export async function recordDocumentContact(input: {
  organizationId: string;
  documentId: string;
  email: string;
}): Promise<void> {
  await db.insert(documentContact).values({
    id: id("dc"),
    organizationId: input.organizationId,
    documentId: input.documentId,
    email: input.email,
  });
}

export async function upsertMarketingContact(input: {
  organizationId: string;
  email: string;
}): Promise<void> {
  await db
    .insert(marketingContact)
    .values({ id: id("mc"), organizationId: input.organizationId, email: input.email })
    .onConflictDoUpdate({
      target: [marketingContact.organizationId, marketingContact.email],
      set: { optInAt: new Date() },
    });
}

export async function createLookupToken(input: {
  organizationId: string;
  email: string;
}): Promise<{ raw: string }> {
  const { raw, hash } = generateLookupToken();
  await db.insert(lookupToken).values({
    id: id("lt"),
    organizationId: input.organizationId,
    email: input.email,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + LOOKUP_TTL_MS),
  });
  return { raw };
}

export async function consumeLookupToken(input: {
  organizationId: string;
  rawToken: string;
}): Promise<{ email: string } | null> {
  const hash = hashLookupToken(input.rawToken);
  const [row] = await db
    .select()
    .from(lookupToken)
    .where(and(eq(lookupToken.tokenHash, hash), eq(lookupToken.organizationId, input.organizationId)))
    .limit(1);
  if (!row) return null;
  if (!isLookupValid(row, new Date())) return null;
  await db
    .update(lookupToken)
    .set({ consumedAt: new Date() })
    .where(and(eq(lookupToken.id, row.id), isNull(lookupToken.consumedAt)));
  return { email: row.email };
}

export async function listDocumentsForEmail(input: {
  organizationId: string;
  email: string;
}): Promise<Array<{ token: string; createdAt: Date; returnWindowDays: number | null; warrantyPeriodMonths: number | null }>> {
  const rows = await db
    .select({
      token: document.token,
      createdAt: document.createdAt,
      returnWindowDays: tenantSettings.returnWindowDays,
      warrantyPeriodMonths: tenantSettings.warrantyPeriodMonths,
    })
    .from(documentContact)
    .innerJoin(document, eq(documentContact.documentId, document.id))
    .leftJoin(tenantSettings, eq(tenantSettings.organizationId, document.organizationId))
    .where(and(eq(documentContact.organizationId, input.organizationId), eq(documentContact.email, input.email)))
    .groupBy(document.token, document.createdAt, tenantSettings.returnWindowDays, tenantSettings.warrantyPeriodMonths)
    .orderBy(desc(document.createdAt));
  return rows;
}
