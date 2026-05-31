// ID + token generation helpers.

import { customAlphabet, nanoid } from "nanoid";
import { createHash } from "node:crypto";

/** Prefixed entity id, e.g. id("dev") → "dev_V1StGXR8_Z5jdHi6B-myT". */
export function id(prefix: string): string {
  return `${prefix}_${nanoid(21)}`;
}

/** Long, unguessable capability token for public receipt URLs. */
export function receiptToken(): string {
  return nanoid(40);
}

// Human-friendly pairing code (no ambiguous chars), e.g. "7K3F-9QXM".
const pairingAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);
export function pairingCode(): string {
  const c = pairingAlphabet();
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** Raw device key (shown once) + its SHA-256 hash (stored). */
export function generateDeviceKey(): { key: string; hash: string } {
  const key = `dvk_${nanoid(40)}`;
  return { key, hash: hashDeviceKey(key) };
}

export function hashDeviceKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
