"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteStoreDialog } from "@/components/delete-store-dialog";
import { deleteStore } from "@/lib/actions/stores";

export function StoreDeleteButton({
  store,
  deviceCount,
  armedCount,
}: {
  store: { id: string; name: string };
  deviceCount: number;
  armedCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function onConfirm() {
    setPending(true);
    const res = await deleteStore(store.id);
    setPending(false);
    if (!res.ok) {
      toast.error("Couldn't delete store", { description: res.error });
      return;
    }
    toast.success("Store deleted");
    setOpen(false);
    router.push("/tenant/stores");
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" />
        Delete store
      </Button>
      <DeleteStoreDialog
        storeName={store.name}
        deviceCount={deviceCount}
        armedCount={armedCount}
        open={open}
        onOpenChange={setOpen}
        pending={pending}
        onConfirm={onConfirm}
      />
    </>
  );
}
