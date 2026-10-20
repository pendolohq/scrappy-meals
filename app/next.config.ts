import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // Up to 4 screenshots of 4 MB each, the caption and multipart overhead.
    serverActions: { bodySizeLimit: "18mb" },
    // src/proxy.ts buffers request bodies; its 10 MB default would truncate
    // the upload before the action sees it.
    proxyClientMaxBodySize: "18mb",
  },
  // Native module; loaded from node_modules at runtime instead of bundled.
  serverExternalPackages: ["@node-rs/argon2"],
};

export default nextConfig;
