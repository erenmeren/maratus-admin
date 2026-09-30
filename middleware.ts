// Route protection. Optimistic cookie check at the edge: unauthenticated users
// hitting /admin or /tenant are bounced to /login. Fine-grained role checks
// (platform_admin for /admin, org membership for /tenant) run in the route-group
// layouts via requirePlatformAdmin / requireTenant, where the DB is available.

import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { CONSOLE_ORIGIN, isDocsHost } from "@/lib/docs-host";

export function middleware(request: NextRequest) {
  // docs.maratus.co is the same deployment, but the console lives elsewhere.
  if (isDocsHost(request.headers.get("host"))) {
    const { pathname, search } = request.nextUrl;
    return NextResponse.redirect(new URL(pathname + search, CONSOLE_ORIGIN));
  }
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = new URL("/login", request.url);
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/tenant/:path*"],
};
