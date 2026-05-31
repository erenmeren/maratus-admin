"use client";

import * as React from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/status-badge";
import { setDeviceActive } from "@/lib/actions/devices";
import type { DeviceStatus } from "@/lib/types";

export function DevicePauseControl({
  deviceId,
  deviceName,
  initialStatus,
}: {
  deviceId: string;
  deviceName: string;
  initialStatus: DeviceStatus;
}) {
  const [status, setStatus] = React.useState(initialStatus);
  const [pending, setPending] = React.useState(false);
  const offline = status === "offline";

  async function toggle() {
    const active = status !== "online"; // activate if paused, else pause
    setPending(true);
    const res = await setDeviceActive(deviceId, active);
    setPending(false);
    if (!res.ok || !res.status) {
      toast.error("Couldn't update device", { description: res.error });
      return;
    }
    setStatus(res.status);
    toast.success(
      res.status === "online" ? `${deviceName} resumed` : `${deviceName} paused`,
      { description: `${deviceId} is now ${res.status}.` },
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2.5">
        <StatusDot status={status} pulse />
        <div>
          <p className="text-sm font-medium capitalize">{status}</p>
          <p className="text-xs text-muted-foreground">
            {offline
              ? "Device is unreachable"
              : status === "online"
                ? "Accepting receipts"
                : "Paused — not accepting receipts"}
          </p>
        </div>
      </div>
      <Button
        variant={status === "online" ? "outline" : "default"}
        size="sm"
        disabled={offline || pending}
        onClick={toggle}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : status === "online" ? (
          <>
            <Pause className="size-4" /> Pause
          </>
        ) : (
          <>
            <Play className="size-4" /> Activate
          </>
        )}
      </Button>
    </div>
  );
}
