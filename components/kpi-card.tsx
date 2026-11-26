import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  delta,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
  icon?: LucideIcon;
}) {
  // Flat (0%) is its own state: a metric that did not move must not render as
  // green growth. Only a real move gets a direction colour.
  const trend = delta === undefined ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-5 max-md:px-3 max-md:py-3.5">
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <p className="text-[13px] max-md:text-xs max-md:whitespace-nowrap">{label}</p>
          {Icon && <Icon aria-hidden className="size-4 shrink-0 stroke-[1.6] max-md:size-3.5" />}
        </div>
        <p className="mt-3 font-display text-[32px] leading-9 font-medium tracking-[-0.02em] tabular-nums max-md:text-[28px] max-md:leading-8">
          {value}
        </p>
        {(trend !== null || hint) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-5 text-muted-foreground">
            {trend !== null && delta !== undefined && (
              <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
                {/* Direction is the arrow's shape; colour only repeats it. */}
                <TrendIcon
                  aria-hidden
                  className={cn(
                    "size-3.5 stroke-2",
                    trend === "up"
                      ? "text-status-online"
                      : trend === "down"
                        ? "text-destructive"
                        : "text-muted-foreground",
                  )}
                />
                <span className="sr-only">
                  {trend === "up" ? "Up" : trend === "down" ? "Down" : "No change"}
                </span>
                {Math.abs(delta)}%
              </span>
            )}
            {hint && <span>{hint}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const KPI_COLUMNS = {
  3: "grid-cols-2 md:grid-cols-3 max-md:[&>*:last-child:nth-child(odd)]:col-span-2",
  4: "grid-cols-2 lg:grid-cols-4",
} as const;

/**
 * Metrics as one ruled block: a single panel, hairlines between the cells,
 * two across on a phone. Wrap `KpiCard`s in it; outside a group a `KpiCard`
 * stays a card of its own.
 */
export function KpiGroup({
  columns,
  children,
}: {
  columns: keyof typeof KPI_COLUMNS;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-panel overflow-hidden rounded-xl">
      {/* Each cell draws its left and top rule; the -1px shift tucks the outer ones under the panel's edge. */}
      <div className={cn("kpi-group -mt-px -ml-px grid", KPI_COLUMNS[columns])}>{children}</div>
    </div>
  );
}
