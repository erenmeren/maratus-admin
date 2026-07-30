// lib/device-auth.ts
// Device bearer-key authentication. Sole caller since the HTTP device API was
// deleted: app/api/device/identity/route.ts (the device proves itself with its
// key to learn its MQTT identity). Everything else runs over MQTT, where the
// same key is the broker password.

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
