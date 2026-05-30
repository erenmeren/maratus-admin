"use client";

import * as React from "react";
import { Plus } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewCustomerDialog() {
  const [open, setOpen] = React.useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name") || "New customer");
    // TODO: replace with API — POST the new customer.
    setOpen(false);
    toast.success("Customer created", {
      description: `${name} has been added (stub).`,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New customer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
            <DialogDescription>
              Add a store chain to the Ditto platform.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Company name</Label>
              <Input id="name" name="name" placeholder="e.g. Roastwell Coffee" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contact">Contact name</Label>
                <Input id="contact" name="contact" placeholder="Jane Doe" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Contact email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="jane@store.com"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Per-print price (USD)</Label>
              <Input
                id="price"
                name="price"
                type="number"
                step="0.005"
                min="0"
                defaultValue="0.04"
              />
              <p className="text-xs text-muted-foreground">
                Charged per digital receipt issued.
              </p>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">Create customer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
