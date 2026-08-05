// GET /api/cron/health — scheduled platform-health evaluator (Vercel cron).
// Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { evaluateAndPersistAlerts } from "@/lib/alerts-sync";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await evaluateAndPersistAlerts();
  return NextResponse.json({ ok: true, ...summary });
}
