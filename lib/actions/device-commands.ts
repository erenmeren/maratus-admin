// lib/actions/device-commands.ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand } from "@/lib/db/schema";
import { getContext } from "@/lib/session";
import { isValidCommandType } from "@/lib/device-commands";
import { id as genId } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };

export async function enqueueDeviceCommand(deviceId: string, type: string): Promise<Result> {
  if (!isValidCommandType(type)) return { ok: false, error: "Invalid command." };
  const ctx = await getContext();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const [dev] = await db
    .select({ id: deviceTable.id, organizationId: deviceTable.organizationId })
    .from(deviceTable)
    .where(eq(deviceTable.id, deviceId))
    .limit(1);
  if (!dev) return { ok: false, error: "Device not found." };

  const isPlatformAdmin = ctx.user.role === "platform_admin";
  const orgRole = ctx.organizations.find((o) => o.id === dev.organizationId)?.role;
  const canCommand = isPlatformAdmin || orgRole === "owner" || orgRole === "admin";
  if (!canCommand) return { ok: false, error: "Not allowed." };

  await db.insert(deviceCommand).values({
    id: genId("cmd"),
    deviceId: dev.id,
    organizationId: dev.organizationId,
    type,
    createdByUserId: ctx.user.id,
  });
  await recordAudit({
    organizationId: dev.organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.deviceCommandEnqueued,
    target: { type: "device", id: dev.id },
    metadata: { type },
  });
  revalidatePath("/tenant/stores");
  revalidatePath("/admin/devices");
  return { ok: true };
}
