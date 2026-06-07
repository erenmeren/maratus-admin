"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditStoreDialog } from "@/components/edit-store-dialog";

export function StoreEditButton({
  store,
}: {
  store: { id: string; name: string; address: string; timezone: string };
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4" />
        Edit store
      </Button>
      <EditStoreDialog store={store} open={open} onOpenChange={setOpen} />
    </>
  );
}
