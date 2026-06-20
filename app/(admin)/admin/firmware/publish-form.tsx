"use client";

import * as React from "react";
import { publishFirmware } from "@/lib/actions/firmware";

export function PublishForm() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await publishFirmware(new FormData(e.currentTarget));
    setBusy(false);
    setMsg(r.ok ? `Published ${r.version}.` : r.error);
    if (r.ok) e.currentTarget.reset();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 max-w-md">
      <input
        name="version"
        placeholder="Version (e.g. 0.3.0-m6b)"
        required
        className="rounded-md border px-3 py-2 text-sm"
      />
      <input
        name="file"
        type="file"
        accept=".bin,application/octet-stream"
        required
        className="text-sm"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Publishing…" : "Publish firmware"}
      </button>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </form>
  );
}
