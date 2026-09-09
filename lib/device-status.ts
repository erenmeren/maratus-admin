// lib/device-status.ts
// Pure: derive a device's effective online/offline status from lastSeenAt.

export const OFFLINE_MINUTES = 15;
/** How long a device may have been dark and still be worth an email. Past this
 * it is not news — it is the fleet's known-dead tail (and on the first sweep
 * after a deploy it would be every legacy device at once). */
export const OFFLINE_NOTIFY_WINDOW_DAYS = 7;
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

/** Should the owner be told this device is offline? True when it is stale
 * (not paused, seen at least once, silent past the threshold) and no
 * notification exists for THIS offline episode — i.e. none since lastSeenAt.
 * The presence webhook flips status instantly, so stored status is not a
 * signal here; staleness is. Bounded on the far side too: a device dark longer
 * than `windowMs` is not a new outage. */
export function shouldNotifyOffline(
  d: { status: string; lastSeenAt: Date | null },
  lastNotifiedAt: Date | null,
  now: Date,
  offlineMinutes = OFFLINE_MINUTES,
  windowMs = OFFLINE_NOTIFY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
): boolean {
  if (d.status === "paused" || !d.lastSeenAt) return false;
  const darkMs = now.getTime() - d.lastSeenAt.getTime();
  if (darkMs <= offlineMinutes * 60_000) return false;
  if (darkMs > windowMs) return false;
  return lastNotifiedAt === null || lastNotifiedAt.getTime() <= d.lastSeenAt.getTime();
}

/** Is a newer firmware available? False when there is no latest release. */
export function firmwareUpdateAvailable(
  deviceVersion: string | null,
  latestVersion: string | null,
): boolean {
  return latestVersion != null && deviceVersion !== latestVersion;
}
