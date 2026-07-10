import Link from "next/link";
import { notFound } from "next/navigation";
import { Cable, Cpu, Globe, HardDrive, FileText, Wifi, Tag } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { KpiCard } from "@/components/kpi-card";
import { StatusDot } from "@/components/status-badge";
import { DeviceRowActions } from "@/components/device-row-actions";
import { CommandBar } from "@/components/devices/command-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDevice, getDeviceCommands } from "@/lib/data";
import { db } from "@/lib/db";
import { device as deviceTable, factoryDevice, firmwareRelease } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { effectiveDeviceStatus, firmwareUpdateAvailable, type DeviceStatus } from "@/lib/device-status";
import { formatNumber, timeAgo } from "@/lib/format";

export default async function AdminDeviceDetailPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  await requirePlatformAdmin();
  const { deviceId } = await params;
  const result = await getDevice(deviceId);
  if (!result) notFound();

  const { device, store, tenant } = result;
  const commands = await getDeviceCommands(device.id);

  const [latestFw] = await db
    .select({ version: firmwareRelease.version })
    .from(firmwareRelease)
    .orderBy(desc(firmwareRelease.createdAt))
    .limit(1);
  const updateAvailable = firmwareUpdateAvailable(device.firmwareVersion, latestFw?.version ?? null);

  const [serialInfo] = await db
    .select({
      serial: deviceTable.serial,
      serialConflict: deviceTable.serialConflict,
      unregistered: factoryDevice.unregistered,
    })
    .from(deviceTable)
    .leftJoin(factoryDevice, eq(factoryDevice.deviceId, deviceTable.id))
    .where(eq(deviceTable.id, device.id))
    .limit(1);

  const status: DeviceStatus = effectiveDeviceStatus(
    device.status,
    device.lastSeenAt ? new Date(device.lastSeenAt) : null,
    new Date(),
  );

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
    { icon: Tag, label: "Serial", value: serialInfo?.serial ?? "—", mono: true },
  ];

  return (
    <>
      <PageHeader
        title={device.name}
        description={`Printer at ${store.name}`}
        backHref="/admin/devices"
        backLabel="Device Fleet"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiCard label="Activations today" value={formatNumber(device.activationsToday)} icon={FileText} />
            <KpiCard label="Activations this month" value={formatNumber(device.activationsThisMonth)} icon={FileText} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Device details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2">
              {specs.map((s) => (
                <div key={s.label} className="flex items-center gap-3 bg-card p-4">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <s.icon className="size-4" />
                  </span>
                  <div>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={s.mono ? "font-mono text-sm" : "text-sm font-medium"}>{s.value}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status & management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className="inline-flex items-center gap-1.5 capitalize">
                  <StatusDot status={status} />
                  {status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer</span>
                <Link href={`/admin/customers/${tenant.id}`} className="font-medium underline">
                  {tenant.name}
                </Link>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Store</span>
                <span className="font-medium">{store.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last seen</span>
                <span className="font-medium">{timeAgo(device.lastSeen)}</span>
              </div>
              {serialInfo?.serialConflict && (
                <Badge variant="destructive" className="w-full justify-center">
                  Duplicate serial detected — this row&apos;s serial was left unset
                </Badge>
              )}
              {serialInfo?.unregistered && (
                <Badge variant="outline" className="w-full justify-center">
                  Not in factory registry
                </Badge>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="text-muted-foreground">Actions</span>
                <DeviceRowActions deviceId={device.id} deviceName={device.name} status={status} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <SectionHeader title="Remote control" />
        <CommandBar deviceId={device.id} />
        {commands.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Command</th>
                <th>Status</th>
                <th>Queued</th>
              </tr>
            </thead>
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
