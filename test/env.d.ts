// SPDX-License-Identifier: MIT
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      ADMIN_PASSWORD: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
