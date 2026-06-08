// GET /api/cron/webhooks — retry failed webhook deliveries past their nextRetryAt.
// Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>`.
import { NextResponse } from "next/server";
import { and, eq, isNotNull, lte, lt } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { db } from "@/lib/db";
import { webhookEndpoint as epTable, webhookDelivery as delTable } from "@/lib/db/schema";
import { attemptDelivery } from "@/lib/webhooks/deliver";
import { MAX_ATTEMPTS } from "@/lib/webhooks/retry";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await db
    .select({ delivery: delTable, endpoint: epTable })
    .from(delTable)
    .innerJoin(epTable, eq(delTable.endpointId, epTable.id))
    .where(
      and(
        eq(delTable.status, "failed"),
        isNotNull(delTable.nextRetryAt),
        lte(delTable.nextRetryAt, now),
        lt(delTable.attempts, MAX_ATTEMPTS),
        eq(epTable.enabled, true),
      ),
    )
    .limit(100);

  let retried = 0;
  let succeeded = 0;
  for (const { delivery, endpoint } of due) {
    try {
      const res = await attemptDelivery(delivery, endpoint);
      retried++;
      if (res.ok) succeeded++;
    } catch (err) {
      console.error("[webhooks] cron retry failed for delivery", delivery.id, err);
    }
  }

  return NextResponse.json({ ok: true, retried, succeeded });
}
