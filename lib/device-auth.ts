// lib/device-auth.ts
// Shared device bearer-key authentication (used by ingest + command endpoints).

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, type DeviceRowT } from "@/lib/db/schema";
import { hashDeviceKey } from "@/lib/ids";

/** Resolve the device from `Authorization: Bearer <deviceKey>`, or null. */
export async function authenticateDevice(req: Request): Promise<DeviceRowT | null> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const keyHash = hashDeviceKey(match[1].trim());
  const [device] = await db
    .select()
    .from(deviceTable)
    .where(eq(deviceTable.deviceKeyHash, keyHash))
    .limit(1);
  return device ?? null;
}
