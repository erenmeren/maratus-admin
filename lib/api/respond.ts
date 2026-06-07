import { NextResponse } from "next/server";

/** Consistent error body: { error: { code, message } }. */
export function apiError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function apiJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
