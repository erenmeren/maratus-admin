// GET /api/device/claim?code=<pairing-code>&serial=<efuse-mac> — UNAUTHENTICATED,
// code-gated, rate-limited (per-code AND per-IP). A provisioning device polls
// this until claimed, then receives its device key ONCE.
//   malformed code                    → 400 (validated before any DB hit)
//   no row, serial allocated          → auto-claim: key delivered + consumed NOW
//   no row otherwise                  → { status: "pending" }
//   pendingDeviceKey set              → { status: "claimed", deviceKey },
//                                       then null key + code, stamp serial
//   key already delivered             → { status: "claimed" }
// The serial is public (box label) and NEVER authenticates by itself; auto-claim
// is the one-shot allocated→claimed transition only (hijack guard).

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  classifyClaimPoll,
  isValidPairingCode,
  normalizeSerial,
  shouldAutoClaim,
} from "@/lib/provisioning";
import {
  autoClaimDevice,
  getRegistryBySerial,
  stampDeviceSerial,
} from "@/lib/factory-registry";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim().toUpperCase() ?? "";
  if (!isValidPairingCode(code)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }
  const serial = normalizeSerial(url.searchParams.get("serial"));

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const [ipRl, codeRl] = await Promise.all([
    checkRateLimit(`claim-ip:${ip}`, { limit: 60, windowMs: 60_000 }),
    checkRateLimit(`claim:${code}`, { limit: 30, windowMs: 60_000 }),
  ]);
  if (!ipRl.allowed || !codeRl.allowed) {
    const retryAfterMs = Math.max(ipRl.retryAfterMs, codeRl.retryAfterMs);
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const [device] = await db
    .select({
      id: deviceTable.id,
      pendingDeviceKey: deviceTable.pendingDeviceKey,
      organizationId: deviceTable.organizationId,
    })
    .from(deviceTable)
    .where(eq(deviceTable.pairingCode, code))
    .limit(1);

  // Zero-touch path: pre-allocated serial, no device row for this code yet.
  if (!device && serial) {
    const registry = await getRegistryBySerial(serial);
    if (shouldAutoClaim(false, registry)) {
      const auto = await autoClaimDevice(serial, code);
      if (auto) {
        return NextResponse.json({ status: "claimed", deviceKey: auto.deviceKey });
      }
    }
  }

  const decision = classifyClaimPoll(device ?? null);

  if (decision.consume && device) {
    await db
      .update(deviceTable)
      .set({ pendingDeviceKey: null, pairingCode: null })
      .where(eq(deviceTable.id, device.id));
    if (serial) {
      try {
        await stampDeviceSerial(device.id, device.organizationId, serial);
      } catch (err) {
        // Stamping is enrichment; it must never gate key delivery — the key
        // was already consumed above, so a stamping failure here must not
        // 500 the response and strand the raw key in the call stack.
        console.error("[claim] serial stamping failed (key still delivered)", err);
      }
    }
  }

  return NextResponse.json(
    decision.deviceKey
      ? { status: decision.status, deviceKey: decision.deviceKey }
      : { status: decision.status },
  );
}
