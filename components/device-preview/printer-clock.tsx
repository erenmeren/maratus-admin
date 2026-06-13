"use client";

import * as React from "react";

/** 720px design reference → container-query width units. */
const cq = (px: number) => `${(px / 7.2).toFixed(2)}cqw`;

/**
 * Live printer clock in a chosen timezone. Renders a stable "9:41" on first paint
 * (server + initial hydration) and switches to the real local time after mount,
 * so there's no hydration mismatch. Ticks every 20s.
 */
export function PrinterClock({
  timezone,
  hour24 = false,
  size = 84,
}: {
  timezone: string;
  hour24?: boolean;
  size?: number;
}) {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(id);
  }, []);

  let time = "9:41";
  let date = "";
  if (now) {
    try {
      time = now.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        hour12: !hour24,
        timeZone: timezone,
      });
      date = now.toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: timezone,
      });
    } catch {
      /* invalid tz → keep placeholder */
    }
  }

  return (
    <div style={{ textAlign: "center" }} suppressHydrationWarning>
      <div
        style={{
          fontSize: cq(size),
          fontWeight: 700,
          letterSpacing: "-1.5px",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          color: "var(--k-fg)",
        }}
      >
        {time}
      </div>
      {date && (
        <div style={{ fontSize: cq(size * 0.26), fontWeight: 500, color: "var(--k-muted)", marginTop: cq(size * 0.14) }}>
          {date}
        </div>
      )}
    </div>
  );
}
