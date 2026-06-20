import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "path";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // Load .env.local so tests can import env-validated modules (e.g. lib/storage.ts,
    // which calls getEnv() at module load). Vitest doesn't pick this up by default.
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
