// lib/actions/device-commands.ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand } from "@/lib/db/schema";
import { getContext } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";
import { isManualCommandType } from "@/lib/device-commands";
import { id as genId } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";
import { publishCommand } from "@/lib/mqtt";
import { publishOtaCommand } from "@/lib/mqtt-push";

type Result = { ok: true } | { ok: false; error: string };

export async function enqueueDeviceCommand(deviceId: string, type: string): Promise<Result> {
  if (!isManualCommandType(type)) return { ok: false, error: "Invalid command." };
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
  const canCommand = isPlatformAdmin || canManageTenant(orgRole);
  if (!canCommand) return { ok: false, error: "Not allowed." };

  const commandId = genId("cmd");
  await db.insert(deviceCommand).values({
    id: commandId,
    deviceId: dev.id,
    organizationId: dev.organizationId,
    type,
    createdByUserId: ctx.user.id,
  });
  // Row first (payload NULL — a firmware manifest carries a short-lived presigned
  // URL that must never be persisted), then publish. If the publish fails or the
  // device is offline the row stays pending and the heartbeat republish retries it.
  if (type === "firmware-update") {
    await publishOtaCommand(dev.id, commandId);
  } else {
    await publishCommand(dev.id, { commandId, type, action: null, payload: null });
  }
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
