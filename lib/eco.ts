// Centralized eco math for Ditto's paperless story.
//
// ⚠️ PLACEHOLDER CONSTANTS — these are rough, clearly-labeled estimates used
// for the prototype. Replace with sourced figures before any public-facing use.

/** Grams of thermal paper saved per receipt not printed. */
export const PAPER_GRAMS_PER_RECEIPT = 3.2; // PLACEHOLDER

/** Liters of water saved per receipt (pulp + production water footprint). */
export const WATER_LITERS_PER_RECEIPT = 0.012; // PLACEHOLDER

/** Grams of CO2-equivalent saved per receipt (paper + thermal printing). */
export const CO2_GRAMS_PER_RECEIPT = 4.6; // PLACEHOLDER

/** Grams of paper produced by one mature tree per year (for the "trees" stat). */
export const PAPER_GRAMS_PER_TREE = 8500; // PLACEHOLDER

export interface EcoSavings {
  receipts: number;
  paperKg: number;
  waterLiters: number;
  co2Kg: number;
  trees: number;
}

/** Compute aggregate eco savings for a given number of receipts. */
export function computeEcoSavings(receipts: number): EcoSavings {
  const paperGrams = receipts * PAPER_GRAMS_PER_RECEIPT;
  return {
    receipts,
    paperKg: paperGrams / 1000,
    waterLiters: receipts * WATER_LITERS_PER_RECEIPT,
    co2Kg: (receipts * CO2_GRAMS_PER_RECEIPT) / 1000,
    trees: paperGrams / PAPER_GRAMS_PER_TREE,
  };
}

/** Human-friendly formatting helpers for the eco module. */
export const ecoFormat = {
  paper: (kg: number) =>
    kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${kg.toFixed(0)} kg`,
  water: (l: number) =>
    l >= 1000 ? `${(l / 1000).toFixed(1)} m³` : `${l.toFixed(0)} L`,
  co2: (kg: number) =>
    kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${kg.toFixed(0)} kg`,
  trees: (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1)),
};
