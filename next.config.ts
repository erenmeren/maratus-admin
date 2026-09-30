import type { NextConfig } from "next";

// CORS for the public API, so the browser-based "Try it" console on the docs
// site (Scalar at docs.maratus.co) can call it. Applied via headers() so it
// also lands on the OPTIONS preflight, which Next answers automatically for
// route handlers that don't export OPTIONS. Each allowed origin gets its own
// rule gated on the request's Origin header (`has` values are anchored
// regexes), so Access-Control-Allow-Origin echoes one exact origin — never `*`
// and never credentials (the API authenticates with a bearer key, not cookies).
const API_CORS_ORIGINS = [
  "https://docs.maratus.co",
  ...(process.env.NODE_ENV !== "production" ? ["http://localhost:3000"] : []),
];
const API_CORS_HEADERS = [
  { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Authorization, Content-Type, Idempotency-Key" },
  { key: "Access-Control-Expose-Headers", value: "Retry-After" },
  { key: "Access-Control-Max-Age", value: "600" },
];
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const nextConfig: NextConfig = {
  // Public API alias: https://api.maratus.co/v1/... serves /api/v1/... (the
  // documented base URL). The /api/v1 paths keep working unchanged.
  async rewrites() {
    return {
      // docs.maratus.co is this same deployment: its root serves the API
      // reference. beforeFiles, because app/page.tsx would otherwise claim "/".
      // /login, /api/* and assets pass through; middleware bounces the console
      // sections (/admin, /tenant) back to console.maratus.co.
      beforeFiles: [
        { source: "/", has: [{ type: "host" as const, value: "docs.maratus.co" }], destination: "/docs" },
      ],
      afterFiles: [{ source: "/v1/:path*", destination: "/api/v1/:path*" }],
      fallback: [],
    };
  },
  async headers() {
    // Headers match the ORIGINAL request path (before rewrites), so both the
    // canonical /api/v1 prefix and the /v1 alias need a rule.
    return ["/api/v1/:path*", "/v1/:path*"].flatMap((source) => [
      // Caches must key on Origin since the allow-origin value depends on it.
      { source, headers: [{ key: "Vary", value: "Origin" }] },
      ...API_CORS_ORIGINS.map((origin) => ({
        source,
        has: [{ type: "header" as const, key: "origin", value: escapeRegex(origin) }],
        headers: [{ key: "Access-Control-Allow-Origin", value: origin }, ...API_CORS_HEADERS],
      })),
    ]);
  },
  // Better Auth pulls in optional adapter dialects (e.g. kysely's bun:sqlite)
  // that must not be bundled — keep it external so Node resolves it at runtime.
  // sharp is a native (libvips) module and must likewise stay unbundled.
  serverExternalPackages: ["better-auth", "@better-auth/kysely-adapter", "sharp"],
  // sharp loads its native binary from an OPTIONAL platform-sibling package
  // (@img/sharp-linux-x64 + @img/sharp-libvips-linux-x64). Next's file tracer
  // doesn't follow that dynamic, platform-gated require, so the binary is left
  // out of the serverless function and sharp throws "Could not load the sharp
  // module using the linux-x64 runtime" at request time on Vercel. Force-include
  // the glibc linux-x64 binaries for the only route that uses sharp — the tenant
  // branding logo/icon upload action. (Vercel functions are glibc x64, so the
  // *linux-x64* glob deliberately excludes darwin/arm/musl variants.)
  outputFileTracingIncludes: {
    "/tenant/branding": ["./node_modules/@img/*linux-x64*/**/*"],
  },
  experimental: {
    // Firmware .bin uploads go through the publishFirmware server action as
    // multipart FormData. Server Actions default to a 1MB request-body cap;
    // real firmware images are ~1.6MB (OTA app partitions are 2MB), so the
    // upload 400s before the action runs. Raise the cap above the partition
    // size. Safe here: publishFirmware is platform-admin-only.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
