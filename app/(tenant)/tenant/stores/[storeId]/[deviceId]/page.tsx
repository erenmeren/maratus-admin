import Link from "next/link";
import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { ArrowLeft, Cable, Cpu, Globe, HardDrive, QrCode, Wifi } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DevicePauseControl } from "@/components/device-pause-control";
import { DeviceMoveControl } from "@/components/device-move-control";
import { DevicePinControl } from "@/components/device-pin-control";
import { Card, CardContent, CardHeader, CardTitle,  } from "@/components/ui/card";
import { CommandBar } from "@/components/devices/command-bar";
import { getDevice, getDeviceCommands, getTenantStores, getOrgQrStyle } from "@/lib/data";
import { db } from "@/lib/db";
import { firmwareRelease } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";
import { getBalance } from "@/lib/credits";
import { formatNumber, timeAgo } from "@/lib/format";

// Friendly names for the raw deviceCommand type/status values shown in the
// command-history table (raw values pass through for anything unmapped).
const COMMAND_LABELS: Record<string, string> = {
  trigger: "Trigger",
  reboot: "Reboot",
  refresh: "Refresh config",
  identify: "Identify",
  "config-changed": "Config sync",
  "firmware-update": "Firmware update",
  pin: "Pinned QR update",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "Queued",
  delivered: "Delivered",
  acked: "Completed",
  failed: "Failed",
  expired: "Expired",
};
const STATUS_DOTS: Record<string, string> = {
  pending: "bg-amber-500",
  delivered: "bg-sky-500",
  acked: "bg-emerald-500",
  failed: "bg-red-500",
  expired: "bg-muted-foreground/40",
};

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
  const commands = await getDeviceCommands(device.id, 8);
  const balance = await getBalance(organizationId);
  const qrStyle = await getOrgQrStyle(organizationId);

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canManage = canManageTenant(membership?.role);
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

      <PageHeader title={device.name} description={`Screen in ${store.name}`} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiCard
              label="Activations today"
              value={formatNumber(device.activationsToday)}
              icon={QrCode}
            />
            <KpiCard
              label="Activations this month"
              value={formatNumber(device.activationsThisMonth)}
              icon={QrCode}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Device details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {specs.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-3"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <s.icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p
                      className={
                        s.mono ? "truncate font-mono text-sm" : "text-sm font-medium"
                      }
                    >
                      {s.value}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Remote control</h2>
            <CommandBar deviceId={device.id} canManage={canManage} />
            {commands.length > 0 && (
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Command</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 text-right font-medium">Queued</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {commands.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-2.5 font-medium">
                          {COMMAND_LABELS[c.type] ?? c.type}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`size-1.5 rounded-full ${STATUS_DOTS[c.status] ?? "bg-muted-foreground/40"}`}
                            />
                            {STATUS_LABELS[c.status] ?? c.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                          {timeAgo(c.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
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
          <DevicePinControl
            deviceId={device.id}
            initialPinnedUrl={device.pinnedUrl}
            initialPinnedAt={device.pinnedAt}
            creditsAvailable={balance.available}
            canManage={canManage}
            qrShape={qrStyle.qrShape}
            qrFg={qrStyle.qrFg}
            qrBg={qrStyle.qrBg}
            qrCorner={qrStyle.qrCorner}
            qrShadowMode={qrStyle.qrShadowMode}
            qrShadowStrength={qrStyle.qrShadowStrength}
            qrShadowColor={qrStyle.qrShadowColor}
          />
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
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
