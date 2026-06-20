// GET /api/device/firmware — device-key auth. Returns the latest published firmware
// release as { version, url, sha256, size } (url = short-lived presigned R2 GET), or
// 204 when nothing is published.

import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { firmwareRelease } from "@/lib/db/schema";
import { authenticateDevice } from "@/lib/device-auth";
import { presignedGetUrl } from "@/lib/storage";
import { latestFirmwareManifest } from "@/lib/firmware";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) {
    return NextResponse.json({ error: "Unknown or missing device key" }, { status: 401 });
  }

  const [rel] = await db
    .select()
    .from(firmwareRelease)
    .orderBy(desc(firmwareRelease.createdAt))
    .limit(1);
  if (!rel) return new NextResponse(null, { status: 204 });

  const url = await presignedGetUrl(rel.r2Key, 600);
  return NextResponse.json(latestFirmwareManifest(rel, url));
}
