// SPDX-License-Identifier: MIT
export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  INGEST_RATE_LIMITER?: RateLimit;
  ADMIN_RATE_LIMITER?: RateLimit;
}
