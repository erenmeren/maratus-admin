// Credit primitives: reserve/settle/release/grant/getBalance.
//
// All balance mutations are single-statement atomic guards — no explicit
// transaction needed. The WHERE available >= cost / held >= cost clause makes
// each UPDATE a CAS: it either moves credits or returns zero rows (failure).
//
// Ledger convention: `credits` is always a positive integer; the `kind` conveys
// direction (hold/settle/release decrease one bucket; grant/purchase increase
// available).

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { creditBalance, creditLedger } from "./db/schema";
import { id } from "./ids";

/** Free credits granted once to a new tenant org so onboarding + first trigger work. */
export const STARTER_CREDITS = 50;

type LedgerRow = {
  organizationId: string;
  deviceId?: string | null;
  kind: "grant" | "purchase" | "hold" | "settle" | "release";
  credits: number;
  action?: string | null;
  commandId?: string | null;
  idempotencyKey?: string | null;
  balanceAfterAvailable?: number | null;
  note?: string | null;
  createdByUserId?: string | null;
};

async function ledger(row: LedgerRow) {
  await db.insert(creditLedger).values({ id: id("cl"), ...row });
}

export async function getBalance(
  organizationId: string,
): Promise<{ available: number; held: number }> {
  const [b] = await db
    .select({ available: creditBalance.available, held: creditBalance.held })
    .from(creditBalance)
    .where(eq(creditBalance.organizationId, organizationId))
    .limit(1);
  return { available: b?.available ?? 0, held: b?.held ?? 0 };
}

/** Atomically move `cost` from available→held iff available >= cost. */
export async function reserveCredit(a: {
  organizationId: string;
  deviceId: string;
  action: string;
  commandId: string;
  cost: number;
}): Promise<{ ok: true; availableAfter: number } | { ok: false; reason: "insufficient" }> {
  const [updated] = await db
    .update(creditBalance)
    .set({
      available: sql`${creditBalance.available} - ${a.cost}`,
      held: sql`${creditBalance.held} + ${a.cost}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(creditBalance.organizationId, a.organizationId),
        gte(creditBalance.available, a.cost),
      ),
    )
    .returning({ available: creditBalance.available });
  if (!updated) return { ok: false, reason: "insufficient" };
  await ledger({
    organizationId: a.organizationId,
    deviceId: a.deviceId,
    kind: "hold",
    credits: a.cost,
    action: a.action,
    commandId: a.commandId,
    balanceAfterAvailable: updated.available,
  });
  return { ok: true, availableAfter: updated.available };
}

/** Finalize a hold: clear it from `held` (credit truly spent). Idempotent via
 *  the held>=cost guard + caller's command-status lock. */
export async function settleHold(a: {
  organizationId: string;
  commandId: string;
  cost: number;
  deviceId?: string | null;
}): Promise<void> {
  const [updated] = await db
    .update(creditBalance)
    .set({
      held: sql`${creditBalance.held} - ${a.cost}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(creditBalance.organizationId, a.organizationId),
        gte(creditBalance.held, a.cost),
      ),
    )
    .returning({ available: creditBalance.available });
  if (!updated) return; // nothing held → already settled/released
  await ledger({
    organizationId: a.organizationId,
    deviceId: a.deviceId ?? null,
    kind: "settle",
    credits: a.cost,
    commandId: a.commandId,
    balanceAfterAvailable: updated.available,
  });
}

/** Refund a hold: move it back held→available. */
export async function releaseHold(a: {
  organizationId: string;
  commandId: string;
  cost: number;
  deviceId?: string | null;
}): Promise<void> {
  const [updated] = await db
    .update(creditBalance)
    .set({
      available: sql`${creditBalance.available} + ${a.cost}`,
      held: sql`${creditBalance.held} - ${a.cost}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(creditBalance.organizationId, a.organizationId),
        gte(creditBalance.held, a.cost),
      ),
    )
    .returning({ available: creditBalance.available });
  if (!updated) return;
  await ledger({
    organizationId: a.organizationId,
    deviceId: a.deviceId ?? null,
    kind: "release",
    credits: a.cost,
    commandId: a.commandId,
    balanceAfterAvailable: updated.available,
  });
}

/** Add credits. The ledger row (unique on kind+idempotencyKey where the key is
 *  non-null) is written FIRST; the balance bumps only if that row actually
 *  inserted — the replay guard. A null idempotencyKey means no guard (e.g. an
 *  admin manual grant), which stays non-idempotent as before. */
export async function grantCredits(a: {
  organizationId: string;
  credits: number;
  kind: "grant" | "purchase";
  note?: string;
  createdByUserId?: string;
  idempotencyKey?: string;
}): Promise<{ applied: boolean }> {
  const inserted = await db
    .insert(creditLedger)
    .values({
      id: id("cl"),
      organizationId: a.organizationId,
      kind: a.kind,
      credits: a.credits,
      idempotencyKey: a.idempotencyKey ?? null,
      note: a.note ?? null,
      createdByUserId: a.createdByUserId ?? null,
    })
    .onConflictDoNothing({
      target: [creditLedger.kind, creditLedger.idempotencyKey],
      where: sql`${creditLedger.idempotencyKey} is not null`,
    })
    .returning({ id: creditLedger.id });
  if (a.idempotencyKey && inserted.length === 0) return { applied: false }; // replay
  await db
    .insert(creditBalance)
    .values({ organizationId: a.organizationId, available: a.credits, held: 0, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: creditBalance.organizationId,
      set: {
        available: sql`${creditBalance.available} + ${a.credits}`,
        updatedAt: new Date(),
      },
    });
  return { applied: true };
}
