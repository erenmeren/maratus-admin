import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Better Auth pulls in optional adapter dialects (e.g. kysely's bun:sqlite)
  // that must not be bundled — keep it external so Node resolves it at runtime.
  serverExternalPackages: ["better-auth", "@better-auth/kysely-adapter"],
};

export default nextConfig;
