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
    expect(body).toContain('href="/about"');
    expect(body).toContain("This site collects learning results for activities its owner runs.");
    expect(body).toContain("Learner data stays on the owner&#39;s own Cloudflare account.");
    expect(body).not.toContain("conformant LRS");
    expect(body).toContain("<main");
  });
});

describe("GET /about", () => {
  it("serves the public about page without auth or xAPI version headers", async () => {
    const res = await SELF.fetch("https://proof.test/about");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("honest subset");
    expect(body).toContain('href="https://github.com/yetanalytics/lrsql"');
    expect(body).toContain("lrsql");
    expect(body).toContain('href="/llms.txt"');
    expect(body).toContain("<h2>Privacy</h2>");
  });
});
