// IO that drives the pure alert lifecycle (lib/alerts.ts). Called by the cron
// endpoint. Never throws on email failure — sendEmail is best-effort.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { alert as alertTable, user as userTable, device as deviceTable, store as storeTable } from "./db/schema";
import { getOrgEmailContext } from "./billing/invoice-emails";
import { deviceOfflineEmail } from "./devices/device-emails";
import { shouldMarkOffline } from "./device-status";
import { recordAudit, AUDIT } from "./audit";
import { computeAlerts } from "./health";
import { getAlertInputs } from "./data";
import { diffAlerts, alertEmail, type OpenAlert } from "./alerts";
import { sendEmail } from "./email";
import { purgeStaleRateLimitRows } from "./rate-limit";
import { id } from "./ids";

/** Reconcile stored device status: flip "online" rows that have gone stale to
 * "offline" (never touches "paused"/"offline"), and audit each flip. Idempotent.
 * Folded into the daily health sweep so no separate cron is needed. */
export async function reconcileOfflineDevices(now: Date): Promise<number> {
  const onlineRows = await db
    .select({
      id: deviceTable.id,
      organizationId: deviceTable.organizationId,
      status: deviceTable.status,
      lastSeenAt: deviceTable.lastSeenAt,
      name: deviceTable.name,
      storeName: storeTable.name,
    })
    .from(deviceTable)
    .leftJoin(storeTable, eq(storeTable.id, deviceTable.storeId))
    .where(eq(deviceTable.status, "online"));

  const toFlip = onlineRows.filter((r) => shouldMarkOffline(r, now));
  if (toFlip.length === 0) return 0;

  await db
    .update(deviceTable)
    .set({ status: "offline" })
    .where(inArray(deviceTable.id, toFlip.map((r) => r.id)));

  for (const r of toFlip) {
    await recordAudit({
      organizationId: r.organizationId,
      actor: { type: "system" },
      action: AUDIT.deviceWentOffline,
      target: { type: "device", id: r.id },
      metadata: { lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null },
    });
  }

  // Notify each affected org's owner once, listing the devices that dropped.
  const byOrg = new Map<string, typeof toFlip>();
  for (const r of toFlip) {
    const arr = byOrg.get(r.organizationId) ?? [];
    arr.push(r);
    byOrg.set(r.organizationId, arr);
  }
  for (const [orgId, devs] of byOrg) {
    const { ownerEmail, orgName } = await getOrgEmailContext(orgId);
    if (!ownerEmail) continue;
    const mail = deviceOfflineEmail({
      orgName,
      devices: devs.map((d) => ({
        name: d.name,
        storeName: d.storeName ?? "—",
        lastSeenLabel: d.lastSeenAt
          ? `${d.lastSeenAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
          : "never",
      })),
    });
    await sendEmail(ownerEmail, mail.subject, mail.html);
  }

  return toFlip.length;
}

export async function evaluateAndPersistAlerts(): Promise<{
  opened: number;
  resolved: number;
  stillOpen: number;
  purgedRateLimitRows: number;
}> {
  await reconcileOfflineDevices(new Date());
  const current = computeAlerts(await getAlertInputs());

  const openRows = await db
    .select({ key: alertTable.key, message: alertTable.message })
    .from(alertTable)
    .where(eq(alertTable.status, "open"));
  const open: OpenAlert[] = openRows.map((r) => ({ key: r.key, message: r.message }));

  const diff = diffAlerts(current, open);
  const now = new Date();

  if (diff.toResolve.length > 0) {
    await db
      .update(alertTable)
      .set({ status: "resolved", resolvedAt: now })
      .where(
        and(
          eq(alertTable.status, "open"),
          inArray(alertTable.key, diff.toResolve.map((a) => a.key)),
        ),
      );
  }

  for (const s of diff.stillOpen) {
    await db
      .update(alertTable)
      .set({ message: s.message, lastSeenAt: now })
      .where(and(eq(alertTable.status, "open"), eq(alertTable.key, s.key)));
  }

  if (diff.toOpen.length > 0) {
    await db
      .insert(alertTable)
      .values(
        diff.toOpen.map((a) => ({
          id: id("alt"),
          key: a.key,
          severity: a.severity,
          message: a.message,
          status: "open" as const,
          firstSeenAt: now,
          lastSeenAt: now,
        })),
      )
      .onConflictDoNothing();

    const mail = alertEmail(diff.toOpen);
    if (mail) {
      const admins = await db
        .select({ email: userTable.email })
        .from(userTable)
        .where(eq(userTable.role, "platform_admin"));
      const results = await Promise.all(
        admins.map((adm) => sendEmail(adm.email, mail.subject, mail.html)),
      );
      // Only mark notified if at least one email actually delivered (best-effort;
      // sendEmail returns false when RESEND_API_KEY is unset or Resend rejects).
      if (results.some(Boolean)) {
        await db
          .update(alertTable)
          .set({ notifiedAt: now })
          .where(
            and(
              eq(alertTable.status, "open"),
              inArray(alertTable.key, diff.toOpen.map((a) => a.key)),
            ),
          );
      }
    }
  }

  // Housekeeping, not health evaluation — run after alerts so a purge failure
  // (best-effort, fails to 0) never affects the alert diff above.
  const purgedRateLimitRows = await purgeStaleRateLimitRows();

  return {
    opened: diff.toOpen.length,
    resolved: diff.toResolve.length,
    stillOpen: diff.stillOpen.length,
    purgedRateLimitRows,
  };
}
