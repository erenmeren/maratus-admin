import Link from "next/link";
import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { ArrowLeft, Cable, Cpu, Globe, HardDrive, FileText, Wifi,  } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DevicePauseControl } from "@/components/device-pause-control";
import { DeviceMoveControl } from "@/components/device-move-control";
import { Card, CardContent, CardHeader, CardTitle,  } from "@/components/ui/card";
import { CommandBar } from "@/components/devices/command-bar";
import { getDevice, getDeviceCommands, getTenantStores } from "@/lib/data";
import { db } from "@/lib/db";
import { firmwareRelease } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { formatNumber, timeAgo } from "@/lib/format";

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ storeId: string; deviceId: string }>;
}) {
  const { storeId, deviceId } = await params;
  const { ctx, organizationId } = await requireTenant();
  const result = await getDevice(deviceId);
  if (!result || result.tenant.id !== organizationId) notFound();
  if (result.store.id !== storeId) notFound();

  const { device, store } = result;
  const commands = await getDeviceCommands(device.id);

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canManage = !!membership && ["owner", "admin"].includes(membership.role);
  const otherStores = canManage
    ? (await getTenantStores(organizationId))
        .filter((s) => s.id !== storeId)
        .map((s) => ({ id: s.id, name: s.name }))
    : [];

  const [latestFw] = await db
    .select({ version: firmwareRelease.version })
    .from(firmwareRelease)
    .orderBy(desc(firmwareRelease.createdAt))
    .limit(1);
  const updateAvailable = !!latestFw && latestFw.version !== device.firmwareVersion;

  const specs: { icon: typeof Cpu; label: string; value: string; mono?: boolean }[] = [
    { icon: HardDrive, label: "Device ID", value: device.id, mono: true },
    { icon: Globe, label: "IP address", value: device.ipAddress, mono: true },
    {
      icon: device.connectionType === "wifi" ? Wifi : Cable,
      label: "Connection",
      value: device.connectionType === "wifi" ? "Wi-Fi" : "Ethernet",
    },
    {
      icon: Cpu,
      label: "Firmware",
      value: `v${device.firmwareVersion}${updateAvailable ? ` → v${latestFw!.version} available` : ""}`,
      mono: true,
    },
  ];

  return (
    <>
      <Link
        href={`/tenant/stores/${storeId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {store.name}
      </Link>

      <PageHeader title={device.name} description={`Printer in ${store.name}`} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiCard
              label="Activations today"
              value={formatNumber(device.activationsToday)}
              icon={FileText}
            />
            <KpiCard
              label="Activations this month"
              value={formatNumber(device.activationsThisMonth)}
              icon={FileText}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Device details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2">
              {specs.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-3 bg-card p-4"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <s.icon className="size-4" />
                  </span>
                  <div>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p
                      className={
                        s.mono ? "font-mono text-sm" : "text-sm font-medium"
                      }
                    >
                      {s.value}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <DevicePauseControl
              deviceId={device.id}
              deviceName={device.name}
              initialStatus={device.status}
              canManage={canManage}
            />
            {canManage && otherStores.length > 0 && (
              <DeviceMoveControl
                deviceId={device.id}
                deviceName={device.name}
                stores={otherStores}
              />
            )}
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Connectivity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last seen</span>
                <span className="font-medium">{timeAgo(device.lastSeen)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Store</span>
                <span className="font-medium">{store.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Firmware</span>
                <span className="font-mono">v{device.firmwareVersion}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Remote control</h2>
        <CommandBar deviceId={device.id} canManage={canManage} />
        {commands.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="py-2">Command</th><th>Status</th><th>Queued</th></tr></thead>
            <tbody>
              {commands.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="py-2">{c.type}</td>
                  <td>{c.status}</td>
                  <td>{c.createdAt.slice(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
