import { requirePlatformAdmin } from "@/lib/session";
import { getPlatformHealth, getAlertHistory } from "@/lib/data";
import { KpiCard } from "@/components/kpi-card";
import { AlertsBanner } from "@/components/health/alerts-banner";
import { AlertHistory } from "@/components/health/alert-history";

export default async function HealthPage() {
  await requirePlatformAdmin();
  const [h, history] = await Promise.all([getPlatformHealth(), getAlertHistory()]);
  const now = Date.now();

  return (
    <div className="flex flex-col gap-8 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Platform health</h1>

      <AlertsBanner alerts={h.alerts} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Fleet freshness</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Devices" value={String(h.fleet.total)} />
          <KpiCard label="Online" value={String(h.fleet.online)} />
          <KpiCard label="Paused" value={String(h.fleet.paused)} />
          <KpiCard label="Stale (15m+)" value={String(h.fleet.staleCount)} />
        </div>
        {h.fleet.stale.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground"><th className="py-2">Device</th><th>Tenant</th><th>Last seen</th></tr>
            </thead>
            <tbody>
              {h.fleet.stale.map((d) => (
                <tr key={d.deviceId} className="border-t">
                  <td className="py-2">{d.name}</td>
                  <td>{d.tenantName ?? "—"}</td>
                  <td>{d.lastSeen ? d.lastSeen.slice(0, 19).replace("T", " ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Ingest activity</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Documents (1h)" value={String(h.ingest.last1h)} />
          <KpiCard label="Documents (24h)" value={String(h.ingest.last24h)} />
          <KpiCard label="Stuck pending" value={String(h.ingest.stuckPending)} />
        </div>
        <p className="text-sm text-muted-foreground">
          Last 24h: {h.ingest.ready} ready · {h.ingest.downloaded} downloaded · {h.ingest.pending} pending
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Per-tenant usage</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Top tenants (24h)</h3>
            {h.usage.topTenants.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents in the last 24h.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {h.usage.topTenants.map((t) => (
                  <li key={t.id} className="flex justify-between border-t py-1.5"><span>{t.name}</span><span className="text-muted-foreground">{t.count}</span></li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Inactive (7d+)</h3>
            {h.usage.inactiveTenants.length === 0 ? (
              <p className="text-sm text-muted-foreground">All tenants active.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {h.usage.inactiveTenants.map((t) => (
                  <li key={t.id} className="flex justify-between border-t py-1.5">
                    <span>{t.name}</span>
                    <span className="text-muted-foreground">{t.lastDocumentAt ? t.lastDocumentAt.slice(0, 10) : "never"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <AlertHistory open={history.open} resolved={history.resolved} now={now} />
    </div>
  );
}
