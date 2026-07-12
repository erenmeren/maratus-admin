"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StorePickerDialog } from "@/components/store-picker-dialog";
import { assignDeviceToStore } from "@/lib/actions/devices";

/** Row-level action on the tenant Devices page: "Assign to store" for pool
 *  devices (storeId null), "Move to store" for already-assigned devices. */
export function DeviceListActions({
  deviceId,
  deviceName,
  storeId,
}: {
  deviceId: string;
  deviceName: string;
  storeId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const isPool = storeId === null;

  async function pick(targetStoreId: string) {
    setPending(true);
    const res = await assignDeviceToStore(deviceId, targetStoreId);
    setPending(false);
    if (!res.ok) {
      toast.error(isPool ? "Couldn't assign device" : "Couldn't move device", { description: res.error });
      return;
    }
    setOpen(false);
    toast.success(isPool ? "Device assigned" : "Device moved");
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {isPool ? "Assign to store" : "Move to store"}
      </Button>
      <StorePickerDialog
        open={open}
        onOpenChange={setOpen}
        title={`${isPool ? "Assign" : "Move"} ${deviceName}`}
        excludeStoreId={storeId}
        onPick={pick}
        pending={pending}
      />
    </>
  );
}
