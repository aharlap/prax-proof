// SPDX-License-Identifier: MIT
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /", () => {
  it("serves the public landing page without auth or xAPI version headers", async () => {
    const res = await SELF.fetch("https://proof.test/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain('href="/dashboard"');
    expect(body).toContain('href="/llms.txt"');
    expect(body).toContain("github.com/aharlap/prax-proof");
    expect(body).toContain("<main");
  });
});
