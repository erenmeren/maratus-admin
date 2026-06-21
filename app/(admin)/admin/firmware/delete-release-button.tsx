"use client";

import * as React from "react";
import { deleteFirmwareRelease } from "@/lib/actions/firmware";

export function DeleteReleaseButton({
  id,
  version,
  isLatest,
}: {
  id: string;
  version: string;
  isLatest: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function onDelete() {
    const warning = isLatest
      ? `Delete ${version}? It is the LATEST release — devices will fall back to the previous release as their OTA target.`
      : `Delete ${version}? This permanently removes the binary and cannot be undone.`;
    if (!window.confirm(warning)) return;
    setBusy(true);
    setErr(null);
    const r = await deleteFirmwareRelease(id);
    setBusy(false);
    if (!r.ok) setErr(r.error);
    // on success, the action revalidates /admin/firmware and this row disappears
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </span>
  );
}
