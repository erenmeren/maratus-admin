import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Cable,
  Cpu,
  Globe,
  HardDrive,
  Receipt,
  ReceiptText,
  Wifi,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DevicePauseControl } from "@/components/device-pause-control";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDevice } from "@/lib/data";
import { formatNumber, timeAgo } from "@/lib/format";

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ storeId: string; deviceId: string }>;
}) {
  const { storeId, deviceId } = await params;
  const result = getDevice(deviceId);
  if (!result || result.tenant.id !== "roastwell") notFound();

  const { device, store } = result;

  const specs: { icon: typeof Cpu; label: string; value: string; mono?: boolean }[] = [
    { icon: HardDrive, label: "Device ID", value: device.id, mono: true },
    { icon: Globe, label: "IP address", value: device.ipAddress, mono: true },
    {
      icon: device.connectionType === "wifi" ? Wifi : Cable,
      label: "Connection",
      value: device.connectionType === "wifi" ? "Wi-Fi" : "Ethernet",
    },
    { icon: Cpu, label: "Firmware", value: `v${device.firmwareVersion}`, mono: true },
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

      <PageHeader title={device.name} description={`Kiosk in ${store.name}`} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiCard
              label="Receipts today"
              value={formatNumber(device.receiptsToday)}
              icon={Receipt}
            />
            <KpiCard
              label="Receipts this month"
              value={formatNumber(device.receiptsThisMonth)}
              icon={ReceiptText}
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
          <DevicePauseControl
            deviceId={device.id}
            deviceName={device.name}
            initialStatus={device.status}
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
              <div className="flex justify-between">
                <span className="text-muted-foreground">Firmware</span>
                <span className="font-mono">v{device.firmwareVersion}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
