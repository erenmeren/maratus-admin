// Pure mapper for trigger-usage analytics.
// Accepts raw device_command rows (acked triggers) and groups them by device.
// Counts rows rather than summing credits — a trigger is one unit.

export function rollupTriggersByDevice(rows: { deviceId: string | null }[]) {
  const m = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    total += 1;
    const k = r.deviceId ?? "unknown";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return { total, byDevice: [...m].map(([deviceId, count]) => ({ deviceId, count })) };
}
