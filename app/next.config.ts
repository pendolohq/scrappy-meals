import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Native module; loaded from node_modules at runtime instead of bundled.
  serverExternalPackages: ["@node-rs/argon2"],
};

export default nextConfig;
