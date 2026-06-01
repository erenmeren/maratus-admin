// Route protection. Optimistic cookie check at the edge: unauthenticated users
// hitting /admin or /tenant are bounced to /login. Fine-grained role checks
// (platform_admin for /admin, org membership for /tenant) run in the route-group
// layouts via requirePlatformAdmin / requireTenant, where the DB is available.

import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = new URL("/login", request.url);
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/admin/:path*", "/tenant/:path*"],
};
