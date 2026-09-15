import { defineConfig, devices } from "@playwright/test";

// Minimal Playwright config scoped to the storefront-button regression
// suite under tests/e2e/. The dev server (npm run dev → http://127.0.0.1:5000)
// is expected to be already running when this suite is invoked from
// tests/run.sh — the same expectation that other suites in this repo
// already rely on for live integration coverage. Override with
// STORE_E2E_BASE_URL if you need to point at a different origin.

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.STORE_E2E_BASE_URL || "http://127.0.0.1:5000",
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
