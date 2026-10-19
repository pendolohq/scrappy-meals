import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // `server-only` throws outside React Server Components; tests run in plain Node.
  "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      { resolve: { alias }, test: { name: "unit", include: ["src/**/*.test.ts"], exclude: ["src/**/*.int.test.ts"] } },
      // Needs a running Mealie: MEALIE_TEST_URL (+ optional MEALIE_TEST_USER / MEALIE_TEST_PASSWORD).
      { resolve: { alias }, test: { name: "integration", include: ["src/**/*.int.test.ts"], testTimeout: 30_000 } },
    ],
  },
});
