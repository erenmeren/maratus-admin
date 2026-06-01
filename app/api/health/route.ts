// GET /api/health — liveness probe for uptime monitoring and deploy checks.
// Intentionally dependency-free: returns 200 as long as the server can serve a
// request. Does not touch the DB so a slow/paused database doesn't mark the app
// as down (use a separate readiness check if you need DB-aware health).

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
