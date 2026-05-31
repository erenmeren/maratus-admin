// Drizzle database client over Neon's serverless HTTP driver.
//
// neon-http is the right fit for serverless/edge request handlers: one round
// trip per query, no connection pool to manage. Import `db` anywhere server-side.

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getEnv } from "./env";
import { schema } from "./db/schema";
import * as relations from "./db/relations";

const sql = neon(getEnv().DATABASE_URL);

export const db = drizzle(sql, { schema: { ...schema, ...relations } });

export type DB = typeof db;
