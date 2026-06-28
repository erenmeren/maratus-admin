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

/** Should this device's STORED status be reconciled to "offline"? True only for
 * an "online" row whose lastSeenAt is older than the threshold (or never seen).
 * Never flips "paused" or an already-"offline" row. Mirrors effectiveDeviceStatus
 * but operates on the raw stored status for the daily reconcile sweep. */
export function shouldMarkOffline(
  d: { status: string; lastSeenAt: Date | null },
  now: Date,
  offlineMinutes = OFFLINE_MINUTES,
): boolean {
  if (d.status !== "online") return false;
  if (!d.lastSeenAt) return true;
  return now.getTime() - d.lastSeenAt.getTime() > offlineMinutes * 60_000;
}

/** Is a newer firmware available? False when there is no latest release. */
export function firmwareUpdateAvailable(
  deviceVersion: string | null,
  latestVersion: string | null,
): boolean {
  return latestVersion != null && deviceVersion !== latestVersion;
}
