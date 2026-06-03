import type { HealthAlert } from "@/lib/health";

export function AlertsBanner({ alerts }: { alerts: HealthAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-status-online/30 bg-status-online/10 px-4 py-3 text-sm text-status-online">
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
              ? "rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              : "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
          }
        >
          {a.message}
        </li>
      ))}
    </ul>
  );
}
