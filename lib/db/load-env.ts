// Side-effect module: load .env.local (then .env) for CLI scripts that run
// outside the Next.js runtime (seed, one-off scripts).
//
// Import this FIRST — before any module that reads env at load time (e.g.
// `../db`) — because ES module imports are hoisted and evaluated in order.
import { config } from "dotenv";

config({ path: [".env.local", ".env"] });
