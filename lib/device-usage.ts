// Per-device monthly trigger counter over device_usage_month.
// bump is a single atomic UPSERT increment returning the post-increment count
// (same CAS style as lib/credits.ts); unbump compensates a reservation that
// was rejected after the bump (fair-use / insufficient credits / enqueue
// failure), guarded so it can never go negative.

import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { deviceUsageMonth } from "./db/schema";

export async function bumpDeviceUsage(a: {
  deviceId: string;
  organizationId: string;
  month: string;
}): Promise<number> {
  const [row] = await db
    .insert(deviceUsageMonth)
    .values({
      deviceId: a.deviceId,
      organizationId: a.organizationId,
      month: a.month,
      triggers: 1,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [deviceUsageMonth.deviceId, deviceUsageMonth.month],
      set: {
        triggers: sql`${deviceUsageMonth.triggers} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ triggers: deviceUsageMonth.triggers });
  return row.triggers;
}

export async function unbumpDeviceUsage(a: {
  deviceId: string;
  month: string;
}): Promise<void> {
  await db
    .update(deviceUsageMonth)
    .set({ triggers: sql`${deviceUsageMonth.triggers} - 1`, updatedAt: new Date() })
    .where(
      and(
        eq(deviceUsageMonth.deviceId, a.deviceId),
        eq(deviceUsageMonth.month, a.month),
        gt(deviceUsageMonth.triggers, 0),
      ),
    );
}

export async function getOrgUsageForMonth(
  organizationId: string,
  month: string,
): Promise<{ deviceId: string; triggers: number }[]> {
  return db
    .select({
      deviceId: deviceUsageMonth.deviceId,
      triggers: deviceUsageMonth.triggers,
    })
    .from(deviceUsageMonth)
    .where(
      and(
        eq(deviceUsageMonth.organizationId, organizationId),
        eq(deviceUsageMonth.month, month),
      ),
    );
}
