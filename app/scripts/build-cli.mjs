// Bundles the admin CLI and the migration runner into single files for the
// production image, which has no dev dependencies or TypeScript.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

/**
 * Also used by src/cli/bundle.test.ts to list what goes into the bundle.
 * @type {import("esbuild").BuildOptions}
 */
export const options = {
  entryPoints: { cli: "src/cli/index.ts", migrate: "src/cli/migrate.ts" },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node26",
  format: "cjs",
  // The CLI runs only on the server, so server-only modules resolve to their no-op build.
  conditions: ["react-server"],
  // Native module, shipped in the standalone node_modules; pg-native is optional and unused.
  external: ["@node-rs/argon2", "pg-native"],
  logLevel: "info",
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build(options);
}
