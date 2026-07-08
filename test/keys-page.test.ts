// SPDX-License-Identifier: MIT
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ADMIN } from "./helpers";

describe("keys page", () => {
  it("explains what ingest keys are for", async () => {
    const res = await SELF.fetch("https://proof.test/dashboard/keys", { headers: ADMIN });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Ingest keys let a page or app send learning events into Proof");
    expect(html).toContain("Keys can write activity data only");
  });

  it("mints a key via the form and shows the secret once", async () => {
    const res = await SELF.fetch("https://proof.test/dashboard/keys", {
      method: "POST",
      headers: { ...ADMIN, "Content-Type": "application/x-www-form-urlencoded", Origin: "https://proof.test" },
      body: "label=Form+minted",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/[0-9a-f]{64}/);          // one-time secret shown
    expect(html).toContain("Form minted");
    expect(html).toContain("data-key=");            // embed sample

    const list = await SELF.fetch("https://proof.test/dashboard/keys", { headers: ADMIN });
    const listHtml = await list.text();
    expect(listHtml).toContain("Form minted");
    expect(listHtml).not.toMatch(/>[0-9a-f]{64}</); // secrets never listed
  });

  it("rejects cross-origin form posts", async () => {
    const res = await SELF.fetch("https://proof.test/dashboard/keys", {
      method: "POST",
      headers: { ...ADMIN, "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example" },
      body: "label=x",
    });
    expect(res.status).toBe(403);
  });

  it("400s on empty label", async () => {
    const res = await SELF.fetch("https://proof.test/dashboard/keys", {
      method: "POST",
      headers: { ...ADMIN, "Content-Type": "application/x-www-form-urlencoded", Origin: "https://proof.test" },
      body: "label=++",
    });
    expect(res.status).toBe(400);
  });
});
