"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link2Off } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { assignDeviceToStore } from "@/lib/actions/devices";
import type { Device } from "@/lib/types";

/** Inventory-style pool of claimed devices whose store was deleted. */
export function UnassignedDevices({
  devices,
  stores,
  canManage,
}: {
  devices: Device[];
  stores: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [targets, setTargets] = React.useState<Record<string, string>>({});

  async function assign(deviceId: string) {
    const storeId = targets[deviceId];
    if (!storeId) return;
    setPendingId(deviceId);
    const res = await assignDeviceToStore(deviceId, storeId);
    setPendingId(null);
    if (!res.ok) {
      toast.error("Couldn't assign device", { description: res.error });
      return;
    }
    toast.success("Device assigned");
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-medium tracking-tight">
          <Link2Off className="size-4 text-muted-foreground" />
          Unassigned devices
        </h2>
        <p className="text-sm text-muted-foreground">
          These printers belonged to a deleted store. Assign them to a store to
          manage them again — they keep working in the meantime.
        </p>
      </div>
      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Device</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-64 text-right">Assign to store</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <StatusDot status={d.status} />
                    <span className="capitalize">{d.status}</span>
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {canManage && (
                    <span className="inline-flex items-center gap-2">
                      <Select
                        value={targets[d.id] ?? ""}
                        onValueChange={(v) => setTargets((t) => ({ ...t, [d.id]: v }))}
                      >
                        <SelectTrigger className="w-44" size="sm">
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
                      <Button
                        size="sm"
                        disabled={!targets[d.id] || pendingId === d.id}
                        onClick={() => assign(d.id)}
                      >
                        Assign
                      </Button>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}
