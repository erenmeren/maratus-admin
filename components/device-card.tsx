"use client";

import * as React from "react";
import Link from "next/link";
import { Cable, ChevronRight, Cpu, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { StatusDot } from "@/components/status-badge";
import type { Device } from "@/lib/types";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DeviceCard({ device }: { device: Device }) {
  const [status, setStatus] = React.useState(device.status);
  const offline = status === "offline";

  function toggle(active: boolean) {
    // TODO: replace with API — optimistic local update for the prototype.
    const next = active ? "online" : "paused";
    setStatus(next);
    toast.success(
      active ? `${device.name} resumed` : `${device.name} paused`,
      { description: `${device.id} is now ${next}.` },
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/tenant/stores/${device.storeId}/${device.id}`}
            className="flex min-w-0 items-center gap-3"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Cpu className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-medium">
                {device.name}
                <ChevronRight className="size-3.5 text-muted-foreground" />
              </p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {device.id}
              </p>
            </div>
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize">
            <StatusDot status={status} pulse />
            {status}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-muted/50 p-2.5">
            <p className="font-display text-base font-bold tabular-nums">
              {formatNumber(device.receiptsToday)}
            </p>
            <p className="text-xs text-muted-foreground">today</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2.5">
            <p className="font-display text-base font-bold tabular-nums">
              {formatNumber(device.receiptsThisMonth)}
            </p>
            <p className="text-xs text-muted-foreground">this month</p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {device.connectionType === "wifi" ? (
              <Wifi className="size-3.5" />
            ) : (
              <Cable className="size-3.5" />
            )}
            {device.connectionType === "wifi" ? "Wi-Fi" : "Ethernet"}
          </span>
          <span>Seen {timeAgo(device.lastSeen)}</span>
        </div>
      </CardContent>

      <div
        className={cn(
          "flex items-center justify-between border-t px-4 py-3",
          offline ? "bg-muted/30" : "bg-card",
        )}
      >
        <Label
          htmlFor={`toggle-${device.id}`}
          className={cn("text-sm", offline && "text-muted-foreground")}
        >
          {offline ? "Unreachable" : status === "online" ? "Active" : "Paused"}
        </Label>
        <Switch
          id={`toggle-${device.id}`}
          checked={status === "online"}
          disabled={offline}
          onCheckedChange={toggle}
        />
      </div>
    </Card>
  );
}
