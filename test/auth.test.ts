// SPDX-License-Identifier: MIT
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { adminAuth, keyAuth, parseBasicAuth, sha256Hex } from "../src/auth";
import type { Env } from "../src/env";
import { D1Storage } from "../src/storage/d1";

const basic = (user: string, pass: string) => "Basic " + btoa(`${user}:${pass}`);

function testApp() {
  const app = new Hono<{ Bindings: Env; Variables: { keyId: string } }>();
  app.get("/keyed", keyAuth, (c) => c.json({ keyId: c.get("keyId") }));
  app.get("/admin", adminAuth, (c) => c.json({ ok: true }));
  return app;
}

describe("parseBasicAuth", () => {
  it("parses a valid header", () =>
    expect(parseBasicAuth(basic("u", "p:with:colons"))).toEqual({ user: "u", pass: "p:with:colons" }));
  it("returns null for missing/garbage headers", () => {
    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth("Bearer abc")).toBeNull();
    expect(parseBasicAuth("Basic not-base64!!!")).toBeNull();
  });
});

describe("keyAuth", () => {
  it("accepts a valid key and exposes keyId", async () => {
    const s = new D1Storage(env.DB);
    await s.createKey("key-a", await sha256Hex("secret-a"), "test");
    const res = await testApp().request("/keyed", { headers: { Authorization: basic("key-a", "secret-a") } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keyId: "key-a" });
  });

  it("rejects a wrong secret, unknown key, and missing header with 401", async () => {
    const s = new D1Storage(env.DB);
    await s.createKey("key-b", await sha256Hex("secret-b"), "test");
    const app = testApp();
    const headersList: Record<string, string>[] = [
      { Authorization: basic("key-b", "wrong") },
      { Authorization: basic("ghost", "secret-b") },
    ];
    for (const headers of headersList) {
      const res = await app.request("/keyed", { headers }, env);
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
    // Test missing header separately
    const resNoHeader = await app.request("/keyed", {}, env);
    expect(resNoHeader.status).toBe(401);
    expect(resNoHeader.headers.get("WWW-Authenticate")).toContain("Basic");
    expect(await resNoHeader.json()).toEqual({ error: "Unauthorized" });
  });
});

describe("adminAuth", () => {
  it("accepts admin with ADMIN_PASSWORD", async () => {
    const res = await testApp().request("/admin", { headers: { Authorization: basic("admin", "test-admin-pw") } }, env);
    expect(res.status).toBe(200);
  });
  it("rejects wrong password", async () => {
    const res = await testApp().request("/admin", { headers: { Authorization: basic("admin", "nope") } }, env);
    expect(res.status).toBe(401);
  });

  it.each([
    ["empty", ""],
    ["unset", undefined],
  ])("rejects when ADMIN_PASSWORD is %s", async (_label, adminPassword) => {
    const next = vi.fn();
    const c = {
      req: { header: () => basic("admin", "undefined") },
      env: adminPassword === undefined ? {} : { ADMIN_PASSWORD: adminPassword },
      json: (body: unknown, status: number, headers: Record<string, string>) =>
        new Response(JSON.stringify(body), { status, headers }),
    };

    const res = (await adminAuth(c as never, next)) as Response;

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});
