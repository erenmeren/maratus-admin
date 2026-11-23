"use server";

// Per-section "who changed what" history (spec 5d). Read-only: anyone who can
// view the section sees it. Keyset pagination on (createdAt, id) desc.

import { and, desc, eq, like, lt, notLike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { apiKey, auditLog, device, invitation, member, store, user } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { canView, type Section } from "@/lib/roles";
import { actionLabel } from "@/lib/audit-labels";
import {
  HISTORY_PAGE_SIZE,
  HISTORY_SECTIONS,
  actionExcludePatternsFor,
  actionPatternsFor,
  decodeCursor,
  encodeCursor,
  type HistorySection,
} from "@/lib/section-history";

export type HistoryRow = {
  id: string;
  at: string;
  actor: string;
  actorRole: string | null;
  action: string;
  target: string | null;
  changed: string[] | null;
};

export async function getSectionHistory(
  section: Section,
  cursor?: string,
): Promise<{ ok: true; rows: HistoryRow[]; nextCursor: string | null } | { ok: false; error: string }> {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!HISTORY_SECTIONS.includes(section as HistorySection) || !canView(role, section)) {
    return { ok: false, error: "You don't have access to this history." };
  }
  const s = section as HistorySection;
  const after = cursor ? decodeCursor(cursor) : null;
  if (cursor && !after) return { ok: false, error: "Invalid cursor." };

  const targetMember = alias(member, "target_member");
  const targetUser = alias(user, "target_user");
  const isTarget = (type: string) => eq(auditLog.targetType, type);

  const rows = await db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      actorType: auditLog.actorType,
      actorLabel: auditLog.actorLabel,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      metadata: auditLog.metadata,
      userName: user.name,
      memberRole: member.role,
      // Human name of the thing acted on; null when it's gone or has no name.
      targetName: sql<string | null>`coalesce(${device.name}, ${store.name}, ${apiKey.name}, ${invitation.email}, ${targetUser.name})`,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .leftJoin(member, and(eq(member.userId, auditLog.actorId), eq(member.organizationId, organizationId)))
    .leftJoin(device, and(isTarget("device"), eq(device.id, auditLog.targetId), eq(device.organizationId, organizationId)))
    .leftJoin(store, and(isTarget("store"), eq(store.id, auditLog.targetId), eq(store.organizationId, organizationId)))
    .leftJoin(apiKey, and(isTarget("api_key"), eq(apiKey.id, auditLog.targetId), eq(apiKey.organizationId, organizationId)))
    .leftJoin(invitation, and(isTarget("invitation"), eq(invitation.id, auditLog.targetId), eq(invitation.organizationId, organizationId)))
    // member targets carry a member id or (on join) a user id
    .leftJoin(targetMember, and(isTarget("member"), eq(targetMember.id, auditLog.targetId), eq(targetMember.organizationId, organizationId)))
    .leftJoin(targetUser, and(isTarget("member"), eq(targetUser.id, sql`coalesce(${targetMember.userId}, ${auditLog.targetId})`)))
    .where(
      and(
        eq(auditLog.organizationId, organizationId),
        or(...actionPatternsFor(s).map((p) => like(auditLog.action, p))),
        ...actionExcludePatternsFor(s).map((p) => notLike(auditLog.action, p)),
        after
          ? or(
              lt(auditLog.createdAt, after.at),
              and(eq(auditLog.createdAt, after.at), lt(auditLog.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(HISTORY_PAGE_SIZE + 1);

  const page = rows.slice(0, HISTORY_PAGE_SIZE);
  const last = page[page.length - 1];
  const changed = (m: unknown) => {
    const c = (m as { changed?: unknown } | null)?.changed;
    return Array.isArray(c) && c.every((x) => typeof x === "string") ? (c as string[]) : null;
  };

  return {
    ok: true,
    rows: page.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      actor: r.userName || (r.actorType === "user" && r.actorLabel) || "System",
      actorRole: r.memberRole ?? null,
      action: actionLabel(r.action),
      target: r.targetName ?? null,
      changed: changed(r.metadata),
    })),
    nextCursor: rows.length > HISTORY_PAGE_SIZE ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
  };
}
