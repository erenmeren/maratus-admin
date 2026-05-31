"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Link2Off,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Store as StoreIcon,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteDevice,
  reassignDevice,
  renameDevice,
  setDeviceActiveAdmin,
  unassignDevice,
} from "@/lib/actions/devices";
import type { DeviceStatus } from "@/lib/types";

export function DeviceRowActions({
  deviceId,
  deviceName = "Device",
  status,
  stores,
}: {
  deviceId: string;
  deviceName?: string;
  status: DeviceStatus;
  /** Same-org stores; enables "Move to store" when provided. */
  stores?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [name, setName] = React.useState(deviceName);
  const [targetStore, setTargetStore] = React.useState(stores?.[0]?.id ?? "");

  async function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    ok: string,
    onDone?: () => void,
  ) {
    setPending(true);
    const res = await fn();
    setPending(false);
    if (!res.ok) {
      toast.error("Action failed", { description: res.error });
      return;
    }
    toast.success(ok);
    onDone?.();
    router.refresh();
  }

  return (
    <>
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
        <DropdownMenuContent align="end" className="w-48">
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
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setName(deviceName);
              setRenameOpen(true);
            }}
          >
            <Pencil className="size-4" /> Rename
          </DropdownMenuItem>
          {stores && stores.length > 0 && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setMoveOpen(true);
              }}
            >
              <StoreIcon className="size-4" /> Move to store
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => run(() => unassignDevice(deviceId), "Device unassigned")}
          >
            <Link2Off className="size-4" /> Unassign
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setDeleteOpen(true);
            }}
          >
            <Trash2 className="size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rename */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename device</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {deviceId}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor={`rename-${deviceId}`}>Device name</Label>
            <Input
              id={`rename-${deviceId}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={pending || !name.trim()}
              onClick={() =>
                run(() => renameDevice(deviceId, name), "Device renamed", () =>
                  setRenameOpen(false),
                )
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to store */}
      {stores && stores.length > 0 && (
        <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Move device</DialogTitle>
              <DialogDescription>
                Reassign {deviceName} to another branch.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label>Store</Label>
              <Select value={targetStore} onValueChange={setTargetStore}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a store" />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                disabled={pending || !targetStore}
                onClick={() =>
                  run(
                    () => reassignDevice(deviceId, targetStore),
                    "Device moved",
                    () => setMoveOpen(false),
                  )
                }
              >
                Move
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete device?</DialogTitle>
            <DialogDescription>
              This permanently removes <span className="font-medium">{deviceName}</span>{" "}
              and its receipt history. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run(() => deleteDevice(deviceId), "Device deleted", () =>
                  setDeleteOpen(false),
                )
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
