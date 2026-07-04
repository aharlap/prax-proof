// SPDX-License-Identifier: MIT
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

export const ADMIN = { Authorization: "Basic " + btoa("admin:test-admin-pw") };

describe("dashboard shell", () => {
  it("requires admin auth", async () => {
    const res = await SELF.fetch("https://proof.test/dashboard");
    expect(res.status).toBe(401);
  });

  it("serves the activity list page to the admin", async () => {
    const res = await SELF.fetch("https://proof.test/dashboard", { headers: ADMIN });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<main");
    expect(html).toContain("Proof");
    expect(html).toContain("/dashboard.css");
  });

  it("serves the stylesheet without auth", async () => {
    const res = await SELF.fetch("https://proof.test/dashboard.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(await res.text()).toContain("--prax-color-bg");
  });
});
