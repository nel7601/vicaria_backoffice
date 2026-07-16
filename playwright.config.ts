import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config (spec §15). Runs the critical-flow specs against a
 * seeded staging/preview URL. Set E2E_BASE_URL (and seed a test org/users)
 * before running: `E2E_BASE_URL=https://preview... npx playwright test`.
 * Specs skip themselves when E2E_BASE_URL is unset so CI stays green until a
 * seeded environment is wired up.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "on-first-retry",
    // Use the pre-installed Chromium in this environment.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
