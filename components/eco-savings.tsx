import { Cloud, Droplets, Leaf, ScrollText, TreePine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ecoFormat, type EcoSavings } from "@/lib/eco";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

function EcoStat({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Leaf;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card/60 p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0">
        <p className="font-display text-lg font-bold leading-none tabular-nums">
          {value}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function EcoSavingsCard({
  eco,
  period = "this month",
  className,
}: {
  eco: EcoSavings;
  period?: string;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.07] to-primary/[0.01]",
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-primary/10 blur-2xl" />
      <CardHeader className="relative">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Leaf className="size-3.5" />
          </span>
          Eco impact
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          From{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatNumber(eco.documents)}
          </span>{" "}
          paperless documents {period}.
        </p>
      </CardHeader>
      <CardContent className="relative grid grid-cols-2 gap-3">
        <EcoStat
          icon={TreePine}
          value={ecoFormat.trees(eco.trees)}
          label="trees worth of paper"
        />
        <EcoStat
          icon={ScrollText}
          value={ecoFormat.paper(eco.paperKg)}
          label="paper not printed"
        />
        <EcoStat
          icon={Droplets}
          value={ecoFormat.water(eco.waterLiters)}
          label="water saved"
        />
        <EcoStat
          icon={Cloud}
          value={ecoFormat.co2(eco.co2Kg)}
          label="CO₂e avoided"
        />
      </CardContent>
    </Card>
  );
}
