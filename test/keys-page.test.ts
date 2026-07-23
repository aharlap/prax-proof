// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { KeysPage } from "../src/dashboard/routes";
import { ADMIN } from "./helpers";

describe("keys page", () => {
  it("explains what ingest keys are for", async () => {
    const res = await SELF.fetch("https://proof.test/dashboard/keys", { headers: ADMIN });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Keys</h1>");
    expect(html).toContain("Ingest keys let a page or app send learning events into Proof");
    expect(html).toContain("they cannot read anything back");
    expect(html).toContain("Read keys let scripts and AI tools read results; they cannot write");
    expect(html).toContain("Use one key per site, course, or tool so results can be traced and rotated later");
  });

  it("shows the first-key hint when no keys are present", () => {
    const html = KeysPage({ keys: [], origin: "https://proof.test" }).toString();
    expect(html).toContain("create your first key below");
    expect(html).toContain("Proof hands you everything to paste into your page or AI builder");
    expect(html).not.toContain("No keys yet.</p>");
  });

  it("separates legacy unattributed statements from per-key usage", async () => {
    await env.DB.prepare(
      `INSERT INTO statements (id, raw, verb, timestamp, stored, key_id)
       VALUES (?, '{}', 'http://adlnet.gov/expapi/verbs/initialized', ?, ?, NULL)`,
    ).bind(
      crypto.randomUUID(),
      "2026-07-09T10:00:00.000Z",
      "2026-07-09T10:00:00.000Z",
    ).run();

    const res = await SELF.fetch("https://proof.test/dashboard/keys", { headers: ADMIN });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("1 legacy statement predates key attribution");
    expect(html).toContain("cannot be assigned to a key accurately");
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
    expect(html).toContain('id="minted-key"');
    expect(html).toContain('<h2 id="minted-key-heading" tabindex="-1">Key created</h2>');
    expect(html.indexOf("<h1>Keys</h1>")).toBeLessThan(html.indexOf('id="minted-key"'));
    expect(html.indexOf('id="minted-key"')).toBeLessThan(html.indexOf("Activity title"));
    expect(html).toContain("data-key=");            // embed sample
    expect(html).toContain("data-name=");
    expect(html).toContain("Or paste this prompt into your AI builder (Claude, ChatGPT, Gemini):");
    expect(html).toContain("Fetch https://proof.test/llms.txt and follow its instructions exactly");
    expect(html).toContain('data-activity=&quot;form-minted&quot;');
    const keyId = html.match(/id: <code>([^<]+)<\/code>/)?.[1];
    expect(keyId).toBeTruthy();
    expect(html).toContain(`Use data-key=&quot;${keyId}:`);

    const list = await SELF.fetch("https://proof.test/dashboard/keys", { headers: ADMIN });
    const listHtml = await list.text();
    expect(listHtml).toContain("Form minted");
    expect(listHtml).toContain("<th scope=\"col\">Kind</th>");
    expect(listHtml).toContain("<td>ingest</td>");
    expect(listHtml).not.toMatch(/>[0-9a-f]{64}</); // secrets never listed
  });

  it("mints a read key via the form and shows read-only examples", async () => {
    const res = await SELF.fetch("https://proof.test/dashboard/keys", {
      method: "POST",
      headers: { ...ADMIN, "Content-Type": "application/x-www-form-urlencoded", Origin: "https://proof.test" },
      body: "label=Read+minted&kind=read",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Use this key to read results (it cannot write):");
    expect(html).toContain("/api/activities");
    expect(html).toContain("/api/activity.md?slug=my-activity");
    expect(html).not.toContain("&lt;script src=");
    expect(html).toContain("<th scope=\"col\">Kind</th>");
    expect(html).toContain("<td>read</td>");
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

  it("re-renders invalid submissions with instructions, values, and an associated error", async () => {
    const res = await SELF.fetch("https://proof.test/dashboard/keys", {
      method: "POST",
      headers: { ...ADMIN, "Content-Type": "application/x-www-form-urlencoded", Origin: "https://proof.test" },
      body: new URLSearchParams({
        label: "Preserved title",
        activitySlug: "Not Valid",
        kind: "ingest",
        allowedOrigin: "",
        identityMode: "anonymous",
        dailyLimit: "10000",
      }).toString(),
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Key not created");
    expect(html).toContain('value="Preserved title"');
    expect(html).toContain('value="Not Valid" aria-invalid="true"');
    expect(html).toContain('aria-describedby="activitySlug-help key-form-error-message"');
    expect(html).toContain("Use lowercase letters and numbers separated by single hyphens");
    expect(html).toContain('data-focus-id="key-form-error"');
  });

  it("requires a review screen before revoking a specifically named key", async () => {
    const mint = await SELF.fetch("https://proof.test/admin/keys", {
      method: "POST",
      headers: { ...ADMIN, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Review target" }),
    });
    const key = (await mint.json()) as { id: string };
    const confirm = await SELF.fetch(
      `https://proof.test/dashboard/keys/revoke/confirm?id=${encodeURIComponent(key.id)}`,
      { headers: ADMIN },
    );
    expect(confirm.status).toBe(200);
    const html = await confirm.text();
    expect(html).toContain("<h1>Revoke this key?</h1>");
    expect(html).toContain("Review target");
    expect(html).toContain(key.id.slice(-8));
    expect(html.indexOf("Cancel and return to keys")).toBeLessThan(
      html.indexOf("Permanently revoke Review target"),
    );

    const unconfirmed = await SELF.fetch("https://proof.test/dashboard/keys/revoke", {
      method: "POST",
      headers: { ...ADMIN, "Content-Type": "application/x-www-form-urlencoded", Origin: "https://proof.test" },
      body: new URLSearchParams({ id: key.id }).toString(),
      redirect: "manual",
    });
    expect(unconfirmed.status).toBe(303);
    expect(unconfirmed.headers.get("Location")).toContain("/dashboard/keys/revoke/confirm");
  });
});
