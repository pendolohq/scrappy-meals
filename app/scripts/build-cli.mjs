// Bundles the admin CLI and the migration runner into single files for the
// production image, which has no dev dependencies or TypeScript.
import { build } from "esbuild";

await build({
  entryPoints: { cli: "src/cli/index.ts", migrate: "src/cli/migrate.ts" },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // The CLI runs only on the server, so server-only modules resolve to their no-op build.
  conditions: ["react-server"],
  // Native module, shipped in the standalone node_modules; pg-native is optional and unused.
  external: ["@node-rs/argon2", "pg-native"],
  logLevel: "info",
});
