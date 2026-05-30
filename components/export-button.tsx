"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ExportButton({ label = "Export CSV" }: { label?: string }) {
  return (
    <Button
      variant="outline"
      onClick={() =>
        // TODO: replace with API — generate and download a real export.
        toast.info("Export queued", {
          description: "Your report will download shortly (stub).",
        })
      }
    >
      <Download className="size-4" />
      {label}
    </Button>
  );
}
