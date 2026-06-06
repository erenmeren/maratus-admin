import type { AlertRow } from "@/lib/data";

function ago(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs}h` : `${Math.round(hrs / 24)}d`;
}

export function AlertHistory({
  open,
  resolved,
  now,
}: {
  open: AlertRow[];
  resolved: AlertRow[];
  now: number;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Alert history</h2>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Open</h3>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open alerts.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {open.map((a) => (
              <li key={a.id} className="flex items-center justify-between border-t py-1.5">
                <span>
                  <span
                    className={
                      a.severity === "warning"
                        ? "mr-2 font-medium text-destructive"
                        : "mr-2 font-medium text-amber-600 dark:text-amber-400"
                    }
                  >
                    {a.severity}
                  </span>
                  {a.message}
                </span>
                <span className="text-muted-foreground">
                  open {ago(a.firstSeenAt, now)}
                  {a.notifiedAt ? " · notified" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Resolved (7d)</h3>
        {resolved.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing resolved recently.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {resolved.map((a) => (
              <li key={a.id} className="flex items-center justify-between border-t py-1.5">
                <span className="text-muted-foreground">{a.message}</span>
                <span className="text-muted-foreground">
                  {a.resolvedAt ? a.resolvedAt.slice(0, 16).replace("T", " ") : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
