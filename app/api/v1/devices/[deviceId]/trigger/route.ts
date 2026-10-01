import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { handleTrigger } from "@/lib/api/trigger-device";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  return handleTrigger(
    req,
    async (organizationId) => {
      const [dev] = await db.select().from(deviceTable)
        .where(and(eq(deviceTable.id, deviceId), eq(deviceTable.organizationId, organizationId))).limit(1);
      return dev ?? null;
    },
    { code: "device_not_found", message: "Device not found." },
  );
}
