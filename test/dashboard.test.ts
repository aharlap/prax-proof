// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { D1Storage } from "../src/storage/d1";
import { ingestStatements } from "../src/xapi/ingest";
import { bridgeSession } from "./fixtures/bridge-session";
import { ADMIN } from "./helpers";

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

describe("activity detail", () => {
  it("renders stats, roster, and chart for a tracked activity", async () => {
    const res = await SELF.fetch(
      `https://proof.test/dashboard/activity?iri=${encodeURIComponent(LIST_IRI)}`,
      { headers: ADMIN },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Fractions check");
    expect(html).toContain("Attempts");
    expect(html).toContain("Attempts — last 14 days");
    expect(html).toContain("Completion rate");
    expect(html).toContain("1 of 1 learners");
    expect(html).toContain("80%");        // avg scaled 0.8
    expect(html).toContain("5 min");      // median duration 312s
    expect(html).toContain("Lea R.");
    expect(html).toContain("8 / 10");
    expect(html).toContain("Completed");
  });

  it("400s without iri and 404s on unknown iri", async () => {
    expect((await SELF.fetch("https://proof.test/dashboard/activity", { headers: ADMIN })).status).toBe(400);
    expect(
      (await SELF.fetch(
        `https://proof.test/dashboard/activity?iri=${encodeURIComponent("https://example.org/ghost")}`,
        { headers: ADMIN },
      )).status,
    ).toBe(404);
  });

  it("escapes hostile learner names", async () => {
    await ingestStatements(new D1Storage(env.DB), [{
      actor: { mbox: "mailto:xss@example.org", name: "<script>alert(1)</script>" },
      verb: { id: "http://adlnet.gov/expapi/verbs/initialized" },
      object: { id: LIST_IRI },
    }]);
    const res = await SELF.fetch(
      `https://proof.test/dashboard/activity?iri=${encodeURIComponent(LIST_IRI)}`,
      { headers: ADMIN },
    );
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders completion-rate math from learners started and completed", async () => {
    const iri = "https://example.org/x/completion-rate";
    const s = new D1Storage(env.DB);
    const V = "http://adlnet.gov/expapi/verbs/";
    const actor = (name: string) => ({ account: { homePage: "https://proof.test", name } });
    await ingestStatements(s, [
      {
        actor: actor("completion-a"),
        verb: { id: `${V}initialized` },
        object: { id: iri, definition: { name: { en: "Completion Rate" } } },
        timestamp: "2026-07-04T10:00:00Z",
      },
      {
        actor: actor("completion-b"),
        verb: { id: `${V}initialized` },
        object: { id: iri },
        timestamp: "2026-07-04T10:01:00Z",
      },
      {
        actor: actor("completion-a"),
        verb: { id: `${V}completed` },
        object: { id: iri },
        result: { completion: true },
        timestamp: "2026-07-04T10:05:00Z",
      },
    ]);

    const res = await SELF.fetch(
      `https://proof.test/dashboard/activity?iri=${encodeURIComponent(iri)}`,
      { headers: ADMIN },
    );
    const html = await res.text();
    expect(html).toContain("Completion rate");
    expect(html).toContain("50%");
    expect(html).toContain("1 of 2 learners");
  });
});
