// view-model → public API JSON (snake_case, integer cents). Pure.

export interface ApiUsage {
  activationsThisMonth: number;
  period: { start: string; end: string };
}

export function serializeUsage(u: ApiUsage) {
  return {
    activations_this_month: u.activationsThisMonth,
    period: { start: u.period.start, end: u.period.end },
  };
}
