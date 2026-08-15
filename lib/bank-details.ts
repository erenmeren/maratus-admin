// Bank transfer coordinates shown to every tenant. Platform-wide, identical
// for all customers, so they are a constant rather than a database row.
export const BANK_DETAILS = {
  accountName: "TODO: company legal name",
  bankName: "TODO: bank name",
  iban: "TODO: IBAN",
  currencyNote: "Prices are in USD; transfer the TRY equivalent at the day's rate.",
} as const;
