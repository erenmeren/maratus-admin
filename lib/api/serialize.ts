// view-model → public API JSON (snake_case, integer cents). Pure.

export interface ApiUsage {
  unitPriceCents: number;
  documentsThisMonth: number;
  currentPeriod: { start: string; end: string; documentCount: number; amountDueCents: number };
  daily: { date: string; documents: number }[];
  monthly: { month: string; documents: number }[];
}

export function serializeUsage(u: ApiUsage) {
  return {
    unit_price_cents: u.unitPriceCents,
    documents_this_month: u.documentsThisMonth,
    current_period: {
      start: u.currentPeriod.start,
      end: u.currentPeriod.end,
      document_count: u.currentPeriod.documentCount,
      amount_due_cents: u.currentPeriod.amountDueCents,
    },
    daily: u.daily,
    monthly: u.monthly,
  };
}
