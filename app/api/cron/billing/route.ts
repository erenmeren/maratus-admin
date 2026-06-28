// Daily billing job (Phase 1B): generate last month's invoices, auto-send card
// tenants, sweep overdue. Daily cadence (Vercel Hobby) + self-healing — always
// processes the previous calendar month, so a missed day catches up next run.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { runBillingCron } from "@/lib/billing/billing-cron";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runBillingCron(new Date());
  return NextResponse.json({ ok: true, ...result });
}
