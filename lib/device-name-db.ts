import { eq } from "drizzle-orm";
import { db } from "./db";
import { device as deviceTable } from "./db/schema";
import { defaultDeviceName } from "./device-name";

export async function nextDeviceName(organizationId: string): Promise<string> {
  const rows = await db
    .select({ name: deviceTable.name })
    .from(deviceTable)
    .where(eq(deviceTable.organizationId, organizationId));
  return defaultDeviceName(rows.map((r) => r.name));
}
