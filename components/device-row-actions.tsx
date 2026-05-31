"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link2Off, Loader2, MoreHorizontal, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setDeviceActiveAdmin, unassignDevice } from "@/lib/actions/devices";
import type { DeviceStatus } from "@/lib/types";

export function DeviceRowActions({
  deviceId,
  status,
}: {
  deviceId: string;
  status: DeviceStatus;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setPending(true);
    const res = await fn();
    setPending(false);
    if (!res.ok) {
      toast.error("Action failed", { description: res.error });
      return;
    }
    toast.success(ok, { description: `${deviceId} updated.` });
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MoreHorizontal className="size-4" />
          )}
          <span className="sr-only">Actions for {deviceId}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {status !== "offline" && (
          <DropdownMenuItem
            onClick={() =>
              run(
                () => setDeviceActiveAdmin(deviceId, status !== "online"),
                status === "online" ? "Device paused" : "Device activated",
              )
            }
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
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => run(() => unassignDevice(deviceId), "Device unassigned")}
        >
          <Link2Off className="size-4" /> Unassign
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
