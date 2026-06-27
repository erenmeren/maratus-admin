import "../lib/db/load-env";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  device,
  invoice,
  member,
  organization,
  document,
  store,
  tenantSettings,
  user,
} from "../lib/db/schema";

async function count(t: Parameters<typeof db.select>[0] extends never ? never : any) {
  const r: any = await db.select({ n: sql<number>`count(*)` }).from(t);
  return Number(r[0].n);
}

async function main() {
  const out = {
    users: await count(user),
    orgs: await count(organization),
    members: await count(member),
    tenant_settings: await count(tenantSettings),
    stores: await count(store),
    devices: await count(device),
    documents: await count(document),
    invoices: await count(invoice),
    roles: await db.select({ email: user.email, role: user.role }).from(user),
    deviceStatuses: await db.select({ s: device.status }).from(device),
  };
  console.log("VERIFY_JSON_START");
  console.log(JSON.stringify(out, null, 2));
  console.log("VERIFY_JSON_END");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
