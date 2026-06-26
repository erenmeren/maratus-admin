import { NextResponse } from "next/server";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { deviceCommand, apiIdempotency } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { releaseHold } from "@/lib/credits";
import { creditCostForAction } from "@/lib/trigger-actions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const expired = await db.select({ id: deviceCommand.id, organizationId: deviceCommand.organizationId, action: deviceCommand.action, deviceId: deviceCommand.deviceId })
    .from(deviceCommand)
    .where(and(eq(deviceCommand.type, "trigger"), inArray(deviceCommand.status, ["pending", "delivered"]), lt(deviceCommand.expiresAt, now)));
  let released = 0;
  for (const c of expired) {
    const [won] = await db.update(deviceCommand).set({ status: "expired" })
      .where(and(eq(deviceCommand.id, c.id), inArray(deviceCommand.status, ["pending", "delivered"])))
      .returning({ id: deviceCommand.id });
    if (!won) continue; // lost the race to an ack
    await releaseHold({ organizationId: c.organizationId, commandId: c.id, cost: creditCostForAction((c.action ?? "show_qr") as "show_qr"), deviceId: c.deviceId });
    released++;
  }
  const del = await db.delete(apiIdempotency).where(lt(apiIdempotency.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))).returning({ key: apiIdempotency.key });
  return NextResponse.json({ ok: true, released, idempotencyPurged: del.length });
}
