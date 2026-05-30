"use client";

import { MoreHorizontal, Link2, Link2Off, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DeviceStatus } from "@/lib/types";

export function DeviceRowActions({
  deviceId,
  status,
  assigned = true,
}: {
  deviceId: string;
  status: DeviceStatus;
  assigned?: boolean;
}) {
  // TODO: replace with API — all actions are stubs for the prototype.
  const act = (msg: string, desc: string) =>
    toast.success(msg, { description: desc });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Actions for {deviceId}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {status !== "offline" && (
          <DropdownMenuItem
            onClick={() =>
              act(
                status === "online" ? "Device paused" : "Device activated",
                `${deviceId} updated (stub).`,
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
        {assigned ? (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => act("Device unassigned", `${deviceId} unassigned (stub).`)}
          >
            <Link2Off className="size-4" /> Unassign
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => act("Device assigned", `${deviceId} assigned (stub).`)}
          >
            <Link2 className="size-4" /> Assign
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
