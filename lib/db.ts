// Drizzle database client over Neon's serverless HTTP driver.
//
// neon-http is the right fit for serverless/edge request handlers: one round
// trip per query, no connection pool to manage. Import `db` anywhere server-side.

import { neon, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import { getEnv } from "./env";
import { schema } from "./db/schema";
import * as relations from "./db/relations";

const sql = neon(getEnv().DATABASE_URL);

export const db = drizzle(sql, { schema: { ...schema, ...relations } });

export type DB = typeof db;

// Second client, backed by Neon's websocket Pool, exists ONLY for interactive
// transactions. The neon-http driver above is one round-trip per query and
// cannot run `BEGIN ... COMMIT`, so multi-write server actions that must commit
// atomically (e.g. self-serve signup seeding membership + tenant settings) use
// `dbTx.transaction(async (tx) => { ... })`. Everything else keeps using `db`.
const pool = new Pool({ connectionString: getEnv().DATABASE_URL });

export const dbTx = drizzlePool(pool, { schema: { ...schema, ...relations } });

export type DBTx = typeof dbTx;
