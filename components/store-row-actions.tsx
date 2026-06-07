"use client";

import * as React from "react";
import { MoreHorizontal, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditStoreDialog } from "@/components/edit-store-dialog";

export function StoreRowActions({
  store,
}: {
  store: { id: string; name: string; address: string; timezone: string };
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Store actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            <Pencil className="size-4" />
            Edit store
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditStoreDialog store={store} open={open} onOpenChange={setOpen} />
    </>
  );
}
