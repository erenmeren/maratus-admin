import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
