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

describe("GET /llms.txt", () => {
  it("serves LLM instructions as plain text", async () => {
    const res = await SELF.fetch("https://proof.test/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("proof.start()");
    expect(body).toContain("data-activity");
    expect(body).toContain("X-Experience-API-Version");
    expect(body).toContain("Reading results back");
    expect(body).toContain("/api/activity.md");
    expect(body).not.toContain("{{PROOF_ORIGIN}}");
  });
});
