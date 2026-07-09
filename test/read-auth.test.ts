// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { readAuth, sha256Hex } from "../src/auth";
import type { Env } from "../src/env";
import { D1Storage } from "../src/storage/d1";

const basic = (user: string, pass: string) => "Basic " + btoa(`${user}:${pass}`);
const stmt = {
  actor: { mbox: "mailto:read-auth@example.org" },
  verb: { id: "http://adlnet.gov/expapi/verbs/experienced" },
  object: { id: "https://example.org/read-auth" },
};

function testApp() {
  const app = new Hono<{ Bindings: Env; Variables: { keyId: string } }>();
  app.get("/read", readAuth, (c) => c.json({ keyId: c.get("keyId") }));
  return app;
}

describe("readAuth", () => {
  it("accepts a read key via Basic and exposes keyId", async () => {
    await new D1Storage(env.DB).createKey("read-basic", await sha256Hex("secret"), "reader", "read");
    const res = await testApp().request("/read", {
      headers: { Authorization: basic("read-basic", "secret") },
    }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keyId: "read-basic" });
  });

  it("accepts a read key via Bearer id:secret", async () => {
    await new D1Storage(env.DB).createKey("read-bearer", await sha256Hex("secret"), "reader", "read");
    const res = await testApp().request("/read", {
      headers: { Authorization: "Bearer read-bearer:secret" },
    }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keyId: "read-bearer" });
  });

  it("rejects ingest keys on readAuth", async () => {
    await new D1Storage(env.DB).createKey("ingest-on-read", await sha256Hex("secret"), "ingest");
    const res = await testApp().request("/read", {
      headers: { Authorization: basic("ingest-on-read", "secret") },
    }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects a read key on the xAPI ingest endpoint", async () => {
    await new D1Storage(env.DB).createKey("read-on-ingest", await sha256Hex("secret"), "reader", "read");
    const res = await SELF.fetch("https://proof.test/xapi/statements", {
      method: "POST",
      headers: {
        Authorization: basic("read-on-ingest", "secret"),
        "X-Experience-API-Version": "1.0.3",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(stmt),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("still accepts an ingest key on the xAPI ingest endpoint", async () => {
    await new D1Storage(env.DB).createKey("ingest-still-works", await sha256Hex("secret"), "ingest");
    const res = await SELF.fetch("https://proof.test/xapi/statements", {
      method: "POST",
      headers: {
        Authorization: basic("ingest-still-works", "secret"),
        "X-Experience-API-Version": "1.0.3",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(stmt),
    });
    expect(res.status).toBe(200);
  });

  it("accepts admin Basic and exposes keyId admin", async () => {
    const res = await testApp().request("/read", {
      headers: { Authorization: basic("admin", "test-admin-pw") },
    }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keyId: "admin" });
  });

  it("rejects wrong admin passwords and fails closed on empty ADMIN_PASSWORD", async () => {
    const app = testApp();
    const wrong = await app.request("/read", {
      headers: { Authorization: basic("admin", "wrong") },
    }, env);
    expect(wrong.status).toBe(401);

    const empty = await app.request("/read", {
      headers: { Authorization: basic("admin", "test-admin-pw") },
    }, { DB: env.DB, ADMIN_PASSWORD: "" });
    expect(empty.status).toBe(401);
  });

  it("rejects malformed Bearer tokens", async () => {
    const res = await testApp().request("/read", {
      headers: { Authorization: "Bearer xyz" },
    }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});
