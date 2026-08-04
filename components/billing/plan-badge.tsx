const LABELS: Record<string, string> = {
  credits: "Credits",
  flat: "Flat",
  base_usage: "Base + Usage",
};

export function planLabel(plan: string): string {
  return LABELS[plan] ?? plan;
}

export function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {planLabel(plan)}
    </span>
  );
}
