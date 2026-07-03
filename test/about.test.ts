// SPDX-License-Identifier: MIT
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /xapi/about", () => {
  it("reports supported xAPI version without auth", async () => {
    const res = await SELF.fetch("https://proof.test/xapi/about");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: ["1.0.3"] });
  });
});
