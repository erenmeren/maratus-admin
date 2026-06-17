import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Better Auth pulls in optional adapter dialects (e.g. kysely's bun:sqlite)
  // that must not be bundled — keep it external so Node resolves it at runtime.
  // sharp is a native (libvips) module and must likewise stay unbundled.
  serverExternalPackages: ["better-auth", "@better-auth/kysely-adapter", "sharp"],
};

export default nextConfig;
