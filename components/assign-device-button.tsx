"use client";

import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function AssignDeviceButton({ customerName }: { customerName: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() =>
        // TODO: replace with API — open assignment flow / POST assignment.
        toast.success("Device assignment", {
          description: `Pick an unassigned kiosk for ${customerName} (stub).`,
        })
      }
    >
      <Plus className="size-4" />
      Assign device
    </Button>
  );
}
