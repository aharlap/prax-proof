// SPDX-License-Identifier: MIT
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("CORS on /xapi/*", () => {
  it("answers preflight for statements", async () => {
    const res = await SELF.fetch("https://proof.test/xapi/statements", {
      method: "OPTIONS",
      headers: {
        Origin: "https://learner-page.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,x-experience-api-version",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    const allowed = (res.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase();
    for (const h of ["authorization", "content-type", "x-experience-api-version"]) {
      expect(allowed).toContain(h);
    }
  });

  it("adds the allow-origin header to xapi responses", async () => {
    const res = await SELF.fetch("https://proof.test/xapi/about", {
      headers: { Origin: "https://learner-page.example" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
