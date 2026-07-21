// Publish a firmware .bin as an OTA release — the CLI equivalent of the
// publishFirmware server action (lib/actions/firmware.ts). Reuses the SAME storage
// helpers + schema so there is no drift from the admin-UI path.
//
//   npx tsx lib/db/publish-firmware.ts <version> <path-to-.bin>
//   e.g. npx tsx lib/db/publish-firmware.ts 0.8.0 \
//        /Users/eren/Projects/ditto-firmware/build/ditto-firmware.bin
//
// Writes to whatever DATABASE_URL + R2_* .env.local points at (currently PROD).
// The device's GET /api/device/firmware returns the newest-createdAt release.

import "./load-env"; // must be first: loads env before ../db / ../storage read it
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { firmwareRelease, user } from "./schema";
import { putObject, firmwareStorageKey } from "../storage";
import { id } from "../ids";

async function main() {
  const version = (process.argv[2] ?? "").trim();
  const binPath = process.argv[3] ?? "";
  if (!version || !binPath) {
    console.error("usage: tsx lib/db/publish-firmware.ts <version> <path-to-.bin>");
    process.exit(1);
  }

  const bytes = readFileSync(binPath);
  if (bytes.length === 0) throw new Error(`empty file: ${binPath}`);
  if (bytes.length > 8 * 1024 * 1024) throw new Error(`file too large (${bytes.length} > 8MB)`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const [dup] = await db
    .select({ id: firmwareRelease.id })
    .from(firmwareRelease)
    .where(eq(firmwareRelease.version, version))
    .limit(1);
  if (dup) {
    console.error(`Version ${version} is already published — nothing to do.`);
    process.exit(1);
  }

  // Attribute to a platform admin if one exists (audit only; column is nullable).
  const [admin] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.role, "platform_admin"))
    .limit(1);

  const key = firmwareStorageKey(version);
  console.log(`Uploading ${binPath} (${bytes.length} bytes, sha256 ${sha256.slice(0, 12)}…) → R2 ${key}`);
  await putObject(key, bytes, "application/octet-stream");

  await db.insert(firmwareRelease).values({
    id: id("fwr"),
    version,
    r2Key: key,
    sha256,
    sizeBytes: bytes.length,
    createdByUserId: admin?.id ?? null,
    createdAt: new Date(),
  });

  console.log(`✅ Published firmware ${version} (${bytes.length} bytes). It is now the latest OTA release.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("publish failed:", err);
  process.exit(1);
});
