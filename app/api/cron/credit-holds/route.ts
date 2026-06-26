// Daily backstop sweep: release any expired trigger holds (active orgs also
// release their own holds lazily on the next trigger — see lib/credit-holds.ts)
// and purge old idempotency rows. Daily cadence because Vercel Hobby allows only
// daily crons; promptness for active orgs comes from the lazy on-trigger release.
import { NextResponse } from "next/server";
import { lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiIdempotency } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { releaseExpiredHolds } from "@/lib/credit-holds";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { released } = await releaseExpiredHolds();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const del = await db.delete(apiIdempotency).where(lt(apiIdempotency.createdAt, cutoff)).returning({ key: apiIdempotency.key });
  return NextResponse.json({ ok: true, released, idempotencyPurged: del.length });
}
