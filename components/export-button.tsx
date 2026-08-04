"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Cell = string | number;

/**
 * CSV export button. Given `headers` + `rows`, it builds a CSV client-side
 * and triggers a download.
 */
export function ExportButton({
  label = "Export CSV",
  filename,
  headers,
  rows,
}: {
  label?: string;
  filename?: string;
  headers: string[];
  rows: Cell[][];
}) {
  function escapeCell(c: Cell): string {
    const s = String(c ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function handleClick() {
    const csv = [headers, ...rows]
      .map((r) => r.map(escapeCell).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename ?? "export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Export ready", {
      description: `${rows.length} row${rows.length === 1 ? "" : "s"} → ${a.download}`,
    });
  }

  return (
    <Button variant="outline" onClick={handleClick}>
      <Download className="size-4" />
      {label}
    </Button>
  );
}
