import { ArrowDownRight, ArrowUpRight } from "lucide-react";
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
  const positive = (delta ?? 0) >= 0;
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {Icon && (
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Icon className="size-4" />
            </span>
          )}
        </div>
        <p className="mt-3 font-display text-3xl font-bold tracking-tight tabular-nums">
          {value}
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs">
          {delta !== undefined && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium",
                positive
                  ? "bg-status-online/10 text-status-online"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {positive ? (
                <ArrowUpRight className="size-3" />
              ) : (
                <ArrowDownRight className="size-3" />
              )}
              {Math.abs(delta)}%
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
