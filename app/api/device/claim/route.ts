// GET /api/device/claim?code=<pairing-code> — UNAUTHENTICATED, code-gated, rate-limited.
// A provisioning device polls this until claimed, then receives its device key ONCE.
//   no row for code        → { status: "pending" }
//   pendingDeviceKey set    → { status: "claimed", deviceKey } then null key + code
//   key already delivered   → { status: "claimed" }

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";
import { classifyClaimPoll } from "@/lib/provisioning";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  const rl = await checkRateLimit(`claim:${code}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const [device] = await db
    .select({ id: deviceTable.id, pendingDeviceKey: deviceTable.pendingDeviceKey })
    .from(deviceTable)
    .where(eq(deviceTable.pairingCode, code))
    .limit(1);

  const decision = classifyClaimPoll(device ?? null);

  if (decision.consume && device) {
    await db
      .update(deviceTable)
      .set({ pendingDeviceKey: null, pairingCode: null })
      .where(eq(deviceTable.id, device.id));
  }

  return NextResponse.json(
    decision.deviceKey
      ? { status: decision.status, deviceKey: decision.deviceKey }
      : { status: decision.status },
  );
}
