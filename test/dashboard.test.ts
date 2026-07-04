// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { D1Storage } from "../src/storage/d1";
import { ingestStatements } from "../src/xapi/ingest";
import { bridgeSession } from "./fixtures/bridge-session";

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

const LIST_IRI = "https://example.org/x/list-quiz";

describe("activity list", () => {
  it("lists parent activities with counts and links, excluding children", async () => {
    await ingestStatements(
      new D1Storage(env.DB),
      bridgeSession(LIST_IRI, "22222222-3333-4444-8555-666666666666"),
    );
    const res = await SELF.fetch("https://proof.test/dashboard", { headers: ADMIN });
    const html = await res.text();
    expect(html).toContain("Fractions check");
    expect(html).toContain(`/dashboard/activity?iri=${encodeURIComponent(LIST_IRI)}`);
    expect(html).not.toContain("/q/q1</");     // child IRIs never listed as rows
    expect(html).not.toContain("prax-empty");  // empty state replaced by the table
  });
});
