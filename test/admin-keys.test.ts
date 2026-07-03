// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth";
import { D1Storage } from "../src/storage/d1";

const adminHeaders = {
  Authorization: "Basic " + btoa("admin:test-admin-pw"),
  "Content-Type": "application/json",
};

describe("POST /admin/keys", () => {
  it("mints a key whose secret authenticates ingest", async () => {
    const res = await SELF.fetch("https://proof.test/admin/keys", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ label: "my classroom" }),
    });
    expect(res.status).toBe(201);
    const key = (await res.json()) as { id: string; secret: string; label: string };
    expect(key.label).toBe("my classroom");
    expect(key.secret).toMatch(/^[0-9a-f]{64}$/);

    // Stored hashed, not in plaintext
    const stored = await new D1Storage(env.DB).findKey(key.id);
    expect(stored?.secretHash).toBe(await sha256Hex(key.secret));
    expect(stored?.secretHash).not.toBe(key.secret);

    // And it authenticates the ingest endpoint
    const ingest = await SELF.fetch("https://proof.test/xapi/statements", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${key.id}:${key.secret}`),
        "X-Experience-API-Version": "1.0.3",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        actor: { mbox: "mailto:dev@example.org" },
        verb: { id: "http://adlnet.gov/expapi/verbs/experienced" },
        object: { id: "https://example.org/act/page" },
      }),
    });
    expect(ingest.status).toBe(200);
  });

  it("requires admin auth", async () => {
    const res = await SELF.fetch("https://proof.test/admin/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("400s on a missing label", async () => {
    const res = await SELF.fetch("https://proof.test/admin/keys", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("rate limiting", () => {
  it("429s after the per-key limit within a minute", async () => {
    const { rateLimit, resetRateLimiter } = await import("../src/ratelimit");
    const { Hono } = await import("hono");
    resetRateLimiter();
    const app = new Hono<{ Variables: { keyId: string } }>();
    app.use("*", async (c, next) => {
      c.set("keyId", "k1");
      await next();
    });
    app.get("/x", rateLimit(3), (c) => c.json({ ok: true }));
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await app.request("/x")).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });
});
