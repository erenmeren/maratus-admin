// view-model → public API JSON (snake_case, integer cents). Pure.

export interface ApiUsage {
  credits: { available: number; held: number };
  creditsConsumedThisMonth: number;
  activationsThisMonth: number;
  period: { start: string; end: string };
}

export function serializeUsage(u: ApiUsage) {
  return {
    credits: { available: u.credits.available, held: u.credits.held },
    credits_consumed_this_month: u.creditsConsumedThisMonth,
    activations_this_month: u.activationsThisMonth,
    period: { start: u.period.start, end: u.period.end },
  };
}
