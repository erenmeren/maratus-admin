// lib/device-status.ts
// Pure: derive a device's effective online/offline status from lastSeenAt.

export const OFFLINE_MINUTES = 15;
export type DeviceStatus = "online" | "offline" | "paused";

/** Paused wins; else offline if never/too-long since seen; else online. */
export function effectiveDeviceStatus(
  storedStatus: string,
  lastSeenAt: Date | null,
  now: Date,
  offlineMinutes = OFFLINE_MINUTES,
): DeviceStatus {
  if (storedStatus === "paused") return "paused";
  if (!lastSeenAt) return "offline";
  return now.getTime() - lastSeenAt.getTime() > offlineMinutes * 60_000
    ? "offline"
    : "online";
}
