// GET /api/cron/usage — reconcile pending Stripe usage events.
// Re-reports any usage_event rows whose inline ingest attempt failed, so a
// dropped meter event is never permanent revenue loss.
// Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>`.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { reconcilePendingUsage } from "@/lib/billing/usage-metering";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await reconcilePendingUsage(new Date());
  return NextResponse.json({ ok: true, ...summary });
}
