// Small formatting helpers shared across screens.

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** "3m ago", "2h ago", "just now" from an ISO timestamp. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/**
 * USD integer cents → "$1,234.56". Money is stored as cents everywhere;
 * this is the display edge — never do arithmetic on the formatted string.
 */
export function formatUsdCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** TRY integer kuruş → "₺1.234,56" — frozen bank-transfer amounts. */
export function formatTryKurus(kurus: number): string {
  return (kurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

/** Calendar date, e.g. "Aug 15, 2026". */
export function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
