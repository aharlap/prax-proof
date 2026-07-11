// SPDX-License-Identifier: MIT
import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";

// Best-effort, per-isolate token bucket. Workers isolates don't share memory,
// so this bounds abuse per isolate only; platform-level limits do the rest.
let buckets = new Map<string, { tokens: number; refilledAt: number }>();

export function resetRateLimiter(): void {
  buckets = new Map();
}

export function platformRateLimit(
  binding: "INGEST_RATE_LIMITER" | "ADMIN_RATE_LIMITER",
  keyFor: (c: Parameters<MiddlewareHandler<{ Bindings: Env; Variables: { keyId: string } }>>[0]) => string,
): MiddlewareHandler<{ Bindings: Env; Variables: { keyId: string } }> {
  return async (c, next) => {
    const limiter = c.env[binding];
    if (limiter) {
      const outcome = await limiter.limit({ key: keyFor(c) });
      if (!outcome.success) {
        return c.json({ error: "Rate limited. Try again shortly." }, 429, { "Retry-After": "60" });
      }
    }
    await next();
  };
}

export function rateLimit(
  limitPerMinute: number,
): MiddlewareHandler<{ Variables: { keyId: string } }> {
  return async (c, next) => {
    const key = c.get("keyId") ?? "anonymous";
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: limitPerMinute, refilledAt: now };
    const refill = ((now - bucket.refilledAt) / 60000) * limitPerMinute;
    bucket.tokens = Math.min(limitPerMinute, bucket.tokens + refill);
    bucket.refilledAt = now;
    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      return c.json({ error: "Rate limited. Try again shortly." }, 429);
    }
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    await next();
  };
}
