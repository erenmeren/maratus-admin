import { NextResponse } from "next/server";
import openapi from "@/openapi.json";

export const runtime = "nodejs";

// Public (unauthenticated) — the schema contains no secrets and is needed by
// API consumers to import the spec into tooling / generate clients.
export async function GET() {
  return NextResponse.json(openapi);
}
