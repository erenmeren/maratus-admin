// IO that drives the pure alert lifecycle (lib/alerts.ts). Called by the cron
// endpoint. Never throws on email failure — sendEmail is best-effort.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { alert as alertTable, user as userTable } from "./db/schema";
import { computeAlerts } from "./health";
import { getAlertInputs } from "./data";
import { diffAlerts, alertEmail, type OpenAlert } from "./alerts";
import { sendEmail } from "./email";
import { id } from "./ids";

export async function evaluateAndPersistAlerts(): Promise<{
  opened: number;
  resolved: number;
  stillOpen: number;
}> {
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
    await db.insert(alertTable).values(
      diff.toOpen.map((a) => ({
        id: id("alt"),
        key: a.key,
        severity: a.severity,
        message: a.message,
        status: "open" as const,
        firstSeenAt: now,
        lastSeenAt: now,
      })),
    );

    const mail = alertEmail(diff.toOpen);
    if (mail) {
      const admins = await db
        .select({ email: userTable.email })
        .from(userTable)
        .where(eq(userTable.role, "platform_admin"));
      for (const adm of admins) await sendEmail(adm.email, mail.subject, mail.html);
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

  return {
    opened: diff.toOpen.length,
    resolved: diff.toResolve.length,
    stillOpen: diff.stillOpen.length,
  };
}
