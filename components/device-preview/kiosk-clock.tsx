"use client";

import * as React from "react";

/** 720px design reference → container-query width units. */
const cq = (px: number) => `${(px / 7.2).toFixed(2)}cqw`;

/**
 * Live kiosk clock in a chosen timezone. Renders a stable "9:41" on first paint
 * (server + initial hydration) and switches to the real local time after mount,
 * so there's no hydration mismatch. Ticks every 20s.
 */
export function KioskClock({
  timezone,
  hour24 = false,
}: {
  timezone: string;
  hour24?: boolean;
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
          fontSize: cq(84),
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
        <div style={{ fontSize: cq(22), fontWeight: 500, color: "var(--k-muted)", marginTop: cq(12) }}>
          {date}
        </div>
      )}
    </div>
  );
}
