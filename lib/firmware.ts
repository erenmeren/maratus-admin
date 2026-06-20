// Pure OTA-manifest shaping, DB-free for unit-testing. The route does the DB
// lookup + R2 presign, then calls this.

export interface FirmwareManifest {
  version: string;
  url: string;
  sha256: string;
  size: number;
}

/** Shape the device-facing manifest from the latest release row + a presigned URL. */
export function latestFirmwareManifest(
  release: { version: string; sha256: string; sizeBytes: number } | null,
  url: string | null,
): FirmwareManifest | null {
  if (!release || !url) return null;
  return { version: release.version, url, sha256: release.sha256, size: release.sizeBytes };
}
