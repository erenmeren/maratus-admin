import { guardApiRequest } from "@/lib/api/guard";
import { serializeUsage } from "@/lib/api/serialize";
import { apiJson } from "@/lib/api/respond";
import { getApiUsage, getCreditUsageByDevice } from "@/lib/data";
import { getBalance } from "@/lib/credits";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [usage, balance, creditUsage] = await Promise.all([
    getApiUsage(auth.organizationId),
    getBalance(auth.organizationId),
    getCreditUsageByDevice(auth.organizationId, monthStart),
  ]);

  return apiJson({
    ...serializeUsage(usage),
    credits: {
      available: balance.available,
      held: balance.held,
      period_start: monthStart.toISOString(),
      period_spend: creditUsage.total,
      by_device: creditUsage.byDevice.map((d) => ({
        device_id: d.deviceId,
        credits: d.credits,
        count: d.count,
      })),
    },
  });
}
