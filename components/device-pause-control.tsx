"use client";

import * as React from "react";
import { Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/status-badge";
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
  const offline = status === "offline";

  function toggle() {
    // TODO: replace with API.
    const next: DeviceStatus = status === "online" ? "paused" : "online";
    setStatus(next);
    toast.success(
      next === "online" ? `${deviceName} resumed` : `${deviceName} paused`,
      { description: `${deviceId} is now ${next}.` },
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
        disabled={offline}
        onClick={toggle}
      >
        {status === "online" ? (
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
