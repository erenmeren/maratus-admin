"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { enqueueDeviceCommand } from "@/lib/actions/device-commands";

const ACTIONS: { type: string; label: string }[] = [
  { type: "reboot", label: "Reboot" },
  { type: "refresh", label: "Refresh config" },
  { type: "identify", label: "Identify" },
  { type: "firmware-update", label: "Update firmware" },
];

export function CommandBar({ deviceId }: { deviceId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(type: string) {
    setMsg(null);
    start(async () => {
      const r = await enqueueDeviceCommand(deviceId, type);
      setMsg(r.ok ? `${type} queued — the device will pick it up on its next check-in.` : r.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <Button key={a.type} variant="outline" size="sm" disabled={pending} onClick={() => send(a.type)}>
            {a.label}
          </Button>
        ))}
      </div>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}
