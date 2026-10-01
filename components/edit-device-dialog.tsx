"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateDeviceDetails } from "@/lib/actions/devices";

type Props = {
  deviceId: string;
  name: string;
  registerNumber: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditDeviceDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {/* Form state lives in the child, which mounts fresh on every open. */}
        <EditDeviceForm {...rest} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EditDeviceForm({
  deviceId,
  name,
  registerNumber,
  onDone,
}: Omit<Props, "open" | "onOpenChange"> & { onDone: () => void }) {
  const router = useRouter();
  const [nameValue, setNameValue] = React.useState(name);
  const [registerValue, setRegisterValue] = React.useState(registerNumber ?? "");
  const [pending, setPending] = React.useState(false);

  async function save() {
    setPending(true);
    const res = await updateDeviceDetails(deviceId, {
      name: nameValue,
      registerNumber: registerValue,
    });
    setPending(false);
    if (!res.ok) {
      toast.error(res.error ?? "Couldn't update device");
      return;
    }
    toast.success("Device updated");
    router.refresh();
    onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit device</DialogTitle>
        <DialogDescription className="font-mono text-xs">{deviceId}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor={`edit-name-${deviceId}`}>Name</Label>
          <Input
            id={`edit-name-${deviceId}`}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            maxLength={60}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`edit-register-${deviceId}`}>Register number</Label>
          <Input
            id={`edit-register-${deviceId}`}
            value={registerValue}
            onChange={(e) => setRegisterValue(e.target.value)}
            placeholder="Optional"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Letters, digits, . _ - · unique in your account
          </p>
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button disabled={pending || !nameValue.trim()} onClick={save}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

/** Self-contained "Edit" button + dialog for server-rendered pages. */
export function EditDeviceDialogButton(
  props: Omit<Props, "open" | "onOpenChange">,
) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4" /> Edit
      </Button>
      <EditDeviceDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}
