"use server";

import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { firmwareRelease } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { id } from "@/lib/ids";
import { firmwareStorageKey, putObject } from "@/lib/storage";

type Result = { ok: true; version: string } | { ok: false; error: string };

export async function publishFirmware(formData: FormData): Promise<Result> {
  const ctx = await requirePlatformAdmin();

  const version = String(formData.get("version") ?? "").trim();
  const file = formData.get("file");
  if (!version) {
    return {
      ok: false,
      error: "Enter a version (must match the build's CONFIG_DITTO_FW_VERSION).",
    };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a firmware .bin file." };
  }
  if (file.size > 8 * 1024 * 1024) {
    return { ok: false, error: "File too large (>8MB)." };
  }

  const [dup] = await db
    .select({ id: firmwareRelease.id })
    .from(firmwareRelease)
    .where(eq(firmwareRelease.version, version))
    .limit(1);
  if (dup) return { ok: false, error: `Version ${version} is already published.` };

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const key = firmwareStorageKey(version);
  await putObject(key, bytes, "application/octet-stream");

  await db.insert(firmwareRelease).values({
    id: id("fwr"),
    version,
    r2Key: key,
    sha256,
    sizeBytes: bytes.length,
    createdByUserId: ctx.user.id,
    createdAt: new Date(),
  });

  revalidatePath("/admin/firmware");
  return { ok: true, version };
}
