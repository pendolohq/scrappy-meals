import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // `server-only` throws outside React Server Components; tests run in plain Node,
  // so they get the package's own no-op build (what the react-server condition picks).
  "server-only": fileURLToPath(
    new URL("./node_modules/server-only/empty.js", import.meta.url)
  ),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts", "src/**/*.db.test.ts"],
        },
      },
      // Needs a throwaway Postgres database: DATABASE_TEST_URL.
      {
        resolve: { alias },
        test: {
          name: "db",
          include: ["src/**/*.db.test.ts"],
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
      // Needs a running Mealie: MEALIE_TEST_URL (+ optional MEALIE_TEST_USER / MEALIE_TEST_PASSWORD).
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          testTimeout: 30_000,
          // One shared Mealie: files running at once intermittently got 401s.
          fileParallelism: false,
        },
      },
    ],
  },
});
