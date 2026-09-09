// Pure guard for tenant-owned R2 image keys. Mirrors imageStorageKey in
// lib/storage.ts (kept separate so this file has no S3 client at load time).
// A stored image.url that is not a direct URL MUST match this before it is
// presigned or deleted — the branding JSON is tenant input, and without the
// check a tenant could name any object in the shared bucket.
const SEGMENT = /^[A-Za-z0-9_-]+$/;

export function isTenantImageKey(organizationId: string, key: string): boolean {
  const prefix = `branding/${organizationId}/images/`;
  if (!key.startsWith(prefix)) return false;
  const assetId = key.slice(prefix.length);
  return SEGMENT.test(assetId);
}
