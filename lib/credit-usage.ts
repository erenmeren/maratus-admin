// Pure mapper for credit-usage analytics.
// Accepts raw ledger rows (settle kind) and groups them by device.

export function rollupByDevice(rows: { deviceId: string | null; credits: number }[]) {
  const m = new Map<string, { credits: number; count: number }>();
  let total = 0;
  for (const r of rows) {
    total += r.credits;
    const k = r.deviceId ?? "unknown";
    const cur = m.get(k) ?? { credits: 0, count: 0 };
    m.set(k, { credits: cur.credits + r.credits, count: cur.count + 1 });
  }
  return { total, byDevice: [...m].map(([deviceId, v]) => ({ deviceId, ...v })) };
}
