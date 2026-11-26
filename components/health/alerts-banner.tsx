import type { HealthAlert } from "@/lib/health";
import { StatusGlyph } from "@/components/status-badge";

// Shape plus word: the glyph and the wash carry the tone, the message stays
// in the text colour.
const ROW = "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm text-foreground";

export function AlertsBanner({ alerts }: { alerts: HealthAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className={`${ROW} border-status-online/30 bg-status-online/10`}>
        <StatusGlyph kind="online" className="mt-[5px] text-status-online" />
        All systems nominal.
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((a) => (
        <li
          key={a.key}
          className={
            a.severity === "warning"
              ? `${ROW} border-destructive/30 bg-destructive/10`
              : `${ROW} border-status-paused/30 bg-status-paused/10`
          }
        >
          <StatusGlyph
            kind={a.severity === "warning" ? "suspended" : "paused"}
            className={
              a.severity === "warning"
                ? "mt-[5px] text-destructive"
                : "mt-[5px] text-status-paused"
            }
          />
          {a.message}
        </li>
      ))}
    </ul>
  );
}
