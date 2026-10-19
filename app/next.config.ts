import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Linting runs as its own CI step (oxlint), not inside next build.
  eslint: { ignoreDuringBuilds: true },
  // Native module; loaded from node_modules at runtime instead of bundled.
  serverExternalPackages: ["@node-rs/argon2"],
};

export default nextConfig;
