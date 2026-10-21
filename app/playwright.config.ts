import { defineConfig, devices } from "@playwright/test";

// The critical journeys against a running production build, a real Mealie
// and a throwaway planner database. See e2e/global-setup.ts for what it needs.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Pixel 7"],
    baseURL,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  // Starts the standalone server unless E2E_BASE_URL points at one already running.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "node .next/standalone/server.js",
        url: `${baseURL}/api/health`,
        timeout: 60_000,
      },
});
