// SPDX-License-Identifier: MIT
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/a11y",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:8787",
    httpCredentials: { username: "admin", password: "a11y-test-pw" },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { browserName: "chromium", viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
    {
      name: "desktop-webkit",
      use: { browserName: "webkit", viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
  webServer: {
    command:
      "pnpm exec wrangler dev --port 8787 --var ADMIN_PASSWORD:a11y-test-pw",
    url: "http://127.0.0.1:8787/xapi/about",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
