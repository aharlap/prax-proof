// SPDX-License-Identifier: MIT
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /p.js", () => {
  it("serves the bundled snippet as JavaScript", async () => {
    const res = await SELF.fetch("https://proof.test/p.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    const body = await res.text();
    expect(body).toContain("[proof]");
    expect(body.length).toBeGreaterThan(500);
  });

  it("needs no auth and no version header", async () => {
    const res = await SELF.fetch("https://proof.test/p.js");
    expect(res.status).toBe(200);
  });
});
