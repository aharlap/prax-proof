// SPDX-License-Identifier: MIT
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/screenshot",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:8787",
    httpCredentials: { username: "admin", password: "a11y-test-pw" },
    viewport: { width: 1280, height: 1560 },
  },
  webServer: {
    command:
      "pnpm exec wrangler dev --port 8787 --var ADMIN_PASSWORD:a11y-test-pw",
    url: "http://127.0.0.1:8787/xapi/about",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
