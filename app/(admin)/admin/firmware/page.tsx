import { desc } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { firmwareRelease } from "@/lib/db/schema";
import { PublishForm } from "./publish-form";

export default async function FirmwarePage() {
  await requirePlatformAdmin();
  const releases = await db
    .select()
    .from(firmwareRelease)
    .orderBy(desc(firmwareRelease.createdAt))
    .limit(50);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">Firmware</h1>
        <p className="text-sm text-muted-foreground">
          Upload a build (its version must match the binary&apos;s CONFIG_DITTO_FW_VERSION). The newest
          release is what devices fetch via the OTA manifest.
        </p>
      </div>
      <PublishForm />
      <table className="text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-6">Version</th><th className="py-1 pr-6">Size</th>
            <th className="py-1 pr-6">SHA-256</th><th className="py-1">Published</th>
          </tr>
        </thead>
        <tbody>
          {releases.map((r, i) => (
            <tr key={r.id} className="border-t">
              <td className="py-1 pr-6">{r.version}{i === 0 ? " (latest)" : ""}</td>
              <td className="py-1 pr-6">{(r.sizeBytes / 1024).toFixed(0)} KB</td>
              <td className="py-1 pr-6 font-mono text-xs">{r.sha256.slice(0, 12)}…</td>
              <td className="py-1">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
            </tr>
          ))}
          {releases.length === 0 && (
            <tr><td colSpan={4} className="py-2 text-muted-foreground">No releases yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
