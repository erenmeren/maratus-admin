"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIMEZONES } from "@/lib/timezones";
import { cn } from "@/lib/utils";

/**
 * Current wall-clock time per curated zone, keyed by IANA name.
 *
 * Computed on the client only — the server and the browser render at different
 * instants, so rendering a clock during SSR guarantees a hydration mismatch.
 * The first paint shows labels alone; the clock appears after mount.
 */
function useZoneClocks(enabled: boolean): Record<string, string> | null {
  const [clocks, setClocks] = React.useState<Record<string, string> | null>(null);

  React.useEffect(() => {
    if (!enabled) return;

    function tick() {
      const now = new Date();
      const next: Record<string, string> = {};
      for (const { value } of TIMEZONES) {
        try {
          next[value] = new Intl.DateTimeFormat("en-GB", {
            timeZone: value,
            hour: "2-digit",
            minute: "2-digit",
          }).format(now);
        } catch {
          // A zone the runtime's tz database doesn't know: show the label alone.
        }
      }
      setClocks(next);
    }

    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [enabled]);

  return clocks;
}

export interface TimezoneSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Rendered on the SelectTrigger, so a <Label htmlFor> still points at it. */
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * The timezone picker shared by every store/branch/printer form. Each option
 * shows the zone label with its current local time muted on the right.
 */
export function TimezoneSelect({
  value,
  onValueChange,
  id,
  disabled,
  placeholder = "Select timezone",
  className,
}: TimezoneSelectProps) {
  const clocks = useZoneClocks(!disabled);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {TIMEZONES.map((tz) => (
          <SelectItem
            key={tz.value}
            value={tz.value}
            // Stretch Radix's ItemText wrapper so the clock can sit flush right.
            className="[&>span:last-of-type]:flex-1"
          >
            <span className="flex w-full items-center justify-between gap-6">
              <span className="truncate">{tz.label}</span>
              {clocks?.[tz.value] ? (
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {clocks[tz.value]}
                </span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
