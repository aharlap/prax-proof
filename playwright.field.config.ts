// SPDX-License-Identifier: MIT
import { defineConfig } from "@playwright/test";

// Manual field-test rig (not part of pnpm test). Boots a real wrangler dev
// instance and drives the H5P demo page through a real browser to prove the
// data-h5p bridge end to end: real p.js bundle → real H5P dispatcher →
// translate → POST → ingest → dashboard.
export default defineConfig({
  testDir: "./test/field",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:8787",
    httpCredentials: { username: "admin", password: "field-test-pw" },
  },
  webServer: {
    command: "pnpm exec wrangler dev --port 8787 --var ADMIN_PASSWORD:field-test-pw",
    url: "http://127.0.0.1:8787/xapi/about",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
