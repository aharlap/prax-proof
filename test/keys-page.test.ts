// SPDX-License-Identifier: MIT
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { KeysPage } from "../src/dashboard/routes";
import { ADMIN } from "./helpers";

describe("keys page", () => {
  it("explains what ingest keys are for", async () => {
    const res = await SELF.fetch("https://proof.test/dashboard/keys", { headers: ADMIN });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Ingest keys let a page or app send learning events into Proof");
    expect(html).toContain("Keys can write activity data only");
  });

  it("shows the first-key hint when no keys are present", () => {
    const html = KeysPage({ keys: [], origin: "https://proof.test" }).toString();
    expect(html).toContain("create your first key below");
    expect(html).toContain("Proof hands you everything to paste into your page or AI builder");
    expect(html).not.toContain("No keys yet.</p>");
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
    expect(html).toContain("data-name=");
    expect(html).toContain("Or paste this prompt into your AI builder (Claude, ChatGPT, Gemini):");
    expect(html).toContain("Fetch https://proof.test/llms.txt and follow its instructions exactly");
    expect(html).toContain("and pick a short kebab-case data-activity slug plus a human data-name");
    const keyId = html.match(/id: <code>([^<]+)<\/code>/)?.[1];
    expect(keyId).toBeTruthy();
    expect(html).toContain(`Use data-key=&quot;${keyId}:`);

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
