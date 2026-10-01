import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { handleTrigger } from "@/lib/api/trigger-device";
import { registerKey } from "@/lib/register-number";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ registerNumber: string }> }) {
  const { registerNumber } = await params;
  const key = registerKey(registerNumber);
  return handleTrigger(
    req,
    async (organizationId) => {
      const [dev] = await db.select().from(deviceTable)
        .where(and(eq(deviceTable.organizationId, organizationId), sql`lower(${deviceTable.registerNumber}) = ${key}`))
        .limit(1);
      return dev ?? null;
    },
    { code: "register_not_found", message: "No device has that register number." },
  );
}
