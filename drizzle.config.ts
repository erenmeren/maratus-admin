import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// CLI tooling runs outside Next.js, so load .env.local (then .env) ourselves.
config({ path: [".env.local", ".env"] });

// drizzle-kit reads env directly (it runs outside the Next.js runtime).
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required (set it in .env.local).");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
