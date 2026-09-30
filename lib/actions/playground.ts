"use server";

// Docs-site "Try it" console support: mint an ephemeral playground API key for
// the signed-in user's active org, and read the header context (who's signed
// in, which org, which devices/stores to prefill). Never redirects — the docs
// page is public, so signed-out / org-less callers get a typed reason instead.

import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { device, store } from "@/lib/db/schema";
import { getContext, type AppContext, type OrgRef } from "@/lib/session";
import { isOrgArchived } from "@/lib/archived-guard";
import { mintPlaygroundKey } from "@/lib/playground-key";
import type { ApiScope } from "@/lib/api-scopes";

export type IssuePlaygroundKeyResult =
  | {
      ok: true;
      key: string; // raw key, returned ONCE — keep in browser memory only
      expiresAt: string; // ISO
      scopes: ApiScope[];
      organizationName: string;
    }
  | { ok: false; reason: "signed_out" | "no_org" | "archived" };

export interface PlaygroundContext {
  signedIn: boolean;
  email?: string;
  organizationName?: string;
  role?: string;
  devices: { id: string; name: string; storeName: string | null }[];
  stores: { id: string; name: string }[];
}

/** Active org resolved exactly as requireTenant does (getContext already
 *  drops archived memberships and falls back to the first active org). */
function activeOrg(ctx: AppContext): OrgRef | null {
  if (!ctx.activeOrganizationId) return null;
  return ctx.organizations.find((o) => o.id === ctx.activeOrganizationId) ?? null;
}

export async function issuePlaygroundKey(): Promise<IssuePlaygroundKeyResult> {
  const ctx = await getContext();
  if (!ctx) return { ok: false, reason: "signed_out" };
  const org = activeOrg(ctx);
  if (!org) return { ok: false, reason: "no_org" };
  // Backstop: getContext filters archived orgs, but re-check at mint time.
  if (await isOrgArchived(org.id)) return { ok: false, reason: "archived" };

  const minted = await mintPlaygroundKey({
    organizationId: org.id,
    userId: ctx.user.id,
    role: org.role,
    actorLabel: ctx.user.email,
  });
  return {
    ok: true,
    key: minted.key,
    expiresAt: minted.expiresAt.toISOString(),
    scopes: minted.scopes,
    organizationName: org.name,
  };
}

const MAX_DEVICES = 200;
const MAX_STORES = 200;

export async function getPlaygroundContext(): Promise<PlaygroundContext> {
  const ctx = await getContext();
  if (!ctx) return { signedIn: false, devices: [], stores: [] };
  const org = activeOrg(ctx);
  if (!org) return { signedIn: true, email: ctx.user.email, devices: [], stores: [] };

  const [devices, stores] = await Promise.all([
    db
      .select({ id: device.id, name: device.name, storeName: store.name })
      .from(device)
      .leftJoin(store, eq(store.id, device.storeId))
      .where(and(eq(device.organizationId, org.id), isNotNull(device.claimedAt)))
      .orderBy(asc(device.name))
      .limit(MAX_DEVICES),
    db
      .select({ id: store.id, name: store.name })
      .from(store)
      .where(eq(store.organizationId, org.id))
      .orderBy(asc(store.name))
      .limit(MAX_STORES),
  ]);

  return {
    signedIn: true,
    email: ctx.user.email,
    organizationName: org.name,
    role: org.role,
    devices,
    stores,
  };
}
