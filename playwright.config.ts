import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./web/e2e",
  timeout: 60_000,
  fullyParallel: true,
  workers: 2,
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    acceptDownloads: true,
  },
  webServer: {
    command: "npm run dev",
    wait: { stdout: /Local: (?<haze_test_url>http:\/\/127\.0\.0\.1:\d+\/)/ },
    timeout: 30_000,
  },
});
