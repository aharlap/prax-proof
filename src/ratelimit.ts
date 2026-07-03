// SPDX-License-Identifier: MIT
import type { MiddlewareHandler } from "hono";

// Best-effort, per-isolate token bucket. Workers isolates don't share memory,
// so this bounds abuse per isolate only; platform-level limits do the rest.
let buckets = new Map<string, { tokens: number; refilledAt: number }>();

export function resetRateLimiter(): void {
  buckets = new Map();
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
