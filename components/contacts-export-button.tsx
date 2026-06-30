"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { exportContactsCsv } from "@/app/(tenant)/tenant/contacts/export-action";

export function ContactsExportButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleExport() {
    setError(null);
    startTransition(async () => {
      try {
        const { filename, csv } = await exportContactsCsv();
        if (!csv) return;
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        setError("Export failed. Please try again.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-sm text-destructive">{error}</span>}
      <Button onClick={handleExport} disabled={isPending} variant="outline" size="sm">
        {isPending ? "Exporting…" : "Export CSV"}
      </Button>
    </div>
  );
}
