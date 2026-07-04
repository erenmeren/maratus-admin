// Seed script: `npm run db:seed`.
//
// Inserts realistic sample data so the existing UI keeps working end-to-end:
//   • 1 platform_admin user (Ditto staff)
//   • 1 coffee-chain organization with an owner user
//   • ~3 stores, ~6 devices (mixed status)
//
// Users + the organization are created through the Better Auth server API so
// password hashing and membership wiring exactly match what auth expects.
// App tables (stores/devices) are inserted with Drizzle.

import "./load-env"; // must be first: loads env before ../db reads it
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auth } from "../auth";
import { grantCredits, STARTER_CREDITS } from "../credits";
import {
  device,
  member,
  organization,
  store,
  tenantSettings,
  user,
} from "./schema";
import { generateDeviceKey, id, pairingCode } from "../ids";

const PLATFORM_ADMIN = {
  name: "Ditto Staff",
  email: "admin@ditto.app",
  password: "123456",
};

const OWNER = {
  name: "Dana Okafor",
  email: "dana@roastwell.co",
  password: "123456",
};

const ORG = { name: "Roastwell Coffee", slug: "roastwell" };

const STORES = [
  { name: "Downtown Flagship", address: "412 Market St, San Francisco, CA", devices: 3 },
  { name: "Mission District", address: "2190 Valencia St, San Francisco, CA", devices: 2 },
  { name: "SoMa Roastery", address: "85 Bluxome St, San Francisco, CA", devices: 1 },
];

// Deterministic PRNG so reseeds are stable.
function seeded(seedValue: number) {
  let s = seedValue % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const rand = seeded(42);
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

async function ensureUser(u: typeof OWNER): Promise<string> {
  const existing = await db.query.user.findFirst({
    where: eq(user.email, u.email),
  });
  if (existing) {
    console.log(`  • user ${u.email} already exists`);
    return existing.id;
  }
  const res = await auth.api.signUpEmail({
    body: { name: u.name, email: u.email, password: u.password },
  });
  // Email verification is required for sign-in, but seeded accounts have no
  // inbox — mark them verified so they can log in immediately.
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.id, res.user.id));
  console.log(`  • created user ${u.email}`);
  return res.user.id;
}

async function main() {
  console.log("Seeding Ditto…");

  // --- Users --------------------------------------------------------------
  await ensureUser(PLATFORM_ADMIN);
  const ownerId = await ensureUser(OWNER);

  // Set roles explicitly by email so each is isolated (admin = platform staff,
  // owner = a normal tenant user whose tenant access comes from membership).
  await db
    .update(user)
    .set({ role: "platform_admin" })
    .where(eq(user.email, PLATFORM_ADMIN.email));
  await db
    .update(user)
    .set({ role: "user" })
    .where(eq(user.email, OWNER.email));
  console.log("  • set roles (admin=platform_admin, owner=user)");

  // --- Organization (tenant) ---------------------------------------------
  let org = await db.query.organization.findFirst({
    where: eq(organization.slug, ORG.slug),
  });
  if (!org) {
    const created = await auth.api.createOrganization({
      body: { name: ORG.name, slug: ORG.slug, userId: ownerId },
    });
    org = await db.query.organization.findFirst({
      where: eq(organization.id, created!.id),
    });
    console.log(`  • created organization ${ORG.name}`);
  } else {
    console.log(`  • organization ${ORG.name} already exists`);
  }
  if (!org) throw new Error("Failed to create organization");
  const orgId = org.id;

  // Ensure owner membership exists (createOrganization usually adds it).
  const ownerMember = await db.query.member.findFirst({
    where: eq(member.organizationId, orgId),
  });
  if (!ownerMember) {
    await db.insert(member).values({
      id: id("mem"),
      organizationId: orgId,
      userId: ownerId,
      role: "owner",
      createdAt: new Date(),
    });
  }

  // Starter credits: prepaid is the only payment path, so a brand-new org
  // needs an allotment or its first trigger 402s. Idempotent by org id, so
  // re-seeding is safe.
  await grantCredits({
    organizationId: orgId,
    credits: STARTER_CREDITS,
    kind: "grant",
    idempotencyKey: `starter-grant:${orgId}`,
    note: "starter grant",
  });

  // --- Tenant settings ----------------------------------------------------
  await db
    .insert(tenantSettings)
    .values({
      organizationId: orgId,
      brandColor: "#B4541F",
      logoUrl: null,
      staffPin: "4827",
      status: "active",
    })
    .onConflictDoNothing();

  // --- Stores + devices ---------------------------------------------------
  // Clear prior app data for this org so reseeds are idempotent.
  await db.delete(device).where(eq(device.organizationId, orgId));
  await db.delete(store).where(eq(store.organizationId, orgId));

  const statuses = ["online", "online", "online", "paused", "offline"] as const;
  const allDeviceIds: { deviceId: string; storeId: string }[] = [];

  for (const s of STORES) {
    const storeId = id("str");
    await db.insert(store).values({
      id: storeId,
      organizationId: orgId,
      name: s.name,
      address: s.address,
      timezone: "America/Los_Angeles",
      createdAt: new Date(),
    });

    for (let i = 0; i < s.devices; i++) {
      const deviceId = id("dev");
      const { hash } = generateDeviceKey();
      await db.insert(device).values({
        id: deviceId,
        organizationId: orgId,
        storeId,
        name: `Printer ${i + 1}`,
        status: pick([...statuses]),
        ipAddress: `10.0.${Math.floor(rand() * 40) + 1}.${Math.floor(rand() * 200) + 10}`,
        connectionType: rand() > 0.45 ? "ethernet" : "wifi",
        firmwareVersion: pick(["2.4.1", "2.4.0", "2.3.7"]),
        lastSeenAt: new Date(Date.now() - Math.floor(rand() * 9) * 60_000),
        // Claimed devices have a key hash and no pairing code (code is consumed
        // at claim time).
        pairingCode: null,
        deviceKeyHash: hash,
        claimedAt: new Date(),
        createdAt: new Date(),
      });
      allDeviceIds.push({ deviceId, storeId });
    }
  }
  console.log(`  • created ${STORES.length} stores, ${allDeviceIds.length} devices`);

  // --- Unclaimed devices (awaiting provisioning) --------------------------
  // These have a pairing code, no store, no key — ready to be claimed in the UI.
  const unclaimedCodes: string[] = [];
  for (let i = 0; i < 3; i++) {
    const code = pairingCode();
    unclaimedCodes.push(code);
    await db.insert(device).values({
      id: id("dev"),
      organizationId: orgId,
      storeId: null,
      name: `Unprovisioned Printer ${i + 1}`,
      status: "offline",
      connectionType: "wifi",
      firmwareVersion: "2.4.1",
      pairingCode: code,
      deviceKeyHash: null,
      claimedAt: null,
      createdAt: new Date(),
    });
  }
  console.log(`  • created 3 unclaimed devices (pairing codes: ${unclaimedCodes.join(", ")})`);

  console.log("\n✅ Seed complete.");
  console.log(`   platform admin: ${PLATFORM_ADMIN.email} / ${PLATFORM_ADMIN.password}`);
  console.log(`   tenant owner:   ${OWNER.email} / ${OWNER.password}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
