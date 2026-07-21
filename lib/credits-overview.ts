// Pure rollup for the admin "Billing" (credits overview) page.
// Folds raw credit-ledger rows + per-org credit balances into a platform-wide
// summary. No IO here — lib/data.ts's getCreditsOverview() feeds it real rows.

export interface CreditLedgerRow {
  orgId: string;
  name: string;
  kind: "grant" | "purchase" | "hold" | "settle" | "release" | "spend";
  credits: number;
  createdAt: Date;
}

export interface CreditBalanceRow {
  orgId: string;
  name: string;
  available: number;
}

export interface CreditsOverview {
  totals: {
    granted: number;
    purchased: number;
    consumed: number;
    outstanding: number;
  };
  perTenant: {
    orgId: string;
    name: string;
    balance: number;
    consumedThisMonth: number;
    lifetimePurchased: number;
  }[];
}

/** UTC start-of-month for `now` (mirrors lib/data.ts's currentMonthStart, but pure/parameterized). */
function startOfMonthUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function rollupCredits(
  ledgerRows: CreditLedgerRow[],
  balances: CreditBalanceRow[],
  now: Date,
): CreditsOverview {
  const monthStart = startOfMonthUTC(now);

  let granted = 0;
  let purchased = 0;
  let consumed = 0;

  interface Acc {
    name: string;
    consumedThisMonth: number;
    lifetimePurchased: number;
  }
  const perOrg = new Map<string, Acc>();

  function getAcc(orgId: string, name: string): Acc {
    let acc = perOrg.get(orgId);
    if (!acc) {
      acc = { name, consumedThisMonth: 0, lifetimePurchased: 0 };
      perOrg.set(orgId, acc);
    }
    return acc;
  }

  for (const row of ledgerRows) {
    const acc = getAcc(row.orgId, row.name);
    switch (row.kind) {
      case "grant":
        granted += row.credits;
        break;
      case "purchase":
        purchased += row.credits;
        acc.lifetimePurchased += row.credits;
        break;
      case "settle":
        consumed += row.credits;
        if (row.createdAt >= monthStart) {
          acc.consumedThisMonth += row.credits;
        }
        break;
      case "hold":
      case "release":
        // Not counted in totals — transient reservations, not realized spend.
        break;
    }
  }

  let outstanding = 0;
  const balanceByOrg = new Map<string, number>();
  for (const b of balances) {
    outstanding += b.available;
    balanceByOrg.set(b.orgId, b.available);
    getAcc(b.orgId, b.name).name = b.name;
  }

  const perTenant = [...perOrg].map(([orgId, acc]) => ({
    orgId,
    name: acc.name,
    balance: balanceByOrg.get(orgId) ?? 0,
    consumedThisMonth: acc.consumedThisMonth,
    lifetimePurchased: acc.lifetimePurchased,
  }));
  perTenant.sort((a, b) => b.balance - a.balance);

  return {
    totals: { granted, purchased, consumed, outstanding },
    perTenant,
  };
}
