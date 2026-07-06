// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { D1Storage } from "../src/storage/d1";
import { ingestStatements } from "../src/xapi/ingest";
import { bridgeSession } from "./fixtures/bridge-session";
import { ADMIN } from "./helpers";

const IRI = "https://example.org/x/learner-quiz";
let learnerId: string;

beforeAll(async () => {
  const s = new D1Storage(env.DB);
  await ingestStatements(s, bridgeSession(IRI, "bbbbbbb1-2222-4333-8444-bbbbbbbbbbb1"));
  const row = await env.DB
    .prepare("SELECT id FROM learners WHERE identity = ?")
    .bind("https://lms.example|learner-77")
    .first<{ id: string }>();
  learnerId = row!.id;
});

describe("learner detail", () => {
  it("renders the attempt timeline in order with friendly labels", async () => {
    const res = await SELF.fetch(
      `https://proof.test/dashboard/learner?id=${learnerId}&iri=${encodeURIComponent(IRI)}`,
      { headers: ADMIN },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Lea R.");
    expect(html).toContain("Started");
    expect(html).toContain("Answered");
    expect(html).toContain("q1");            // question id from /q/q1
    expect(html).toContain("✓ correct");
    expect(html).toContain("Passed");
    expect(html).toContain("8 / 10");
    expect(html).toContain("Completed");
    expect(html.indexOf("Started")).toBeLessThan(html.indexOf("Completed")); // ascending
  });

  it("roster links to the learner page", async () => {
    const res = await SELF.fetch(
      `https://proof.test/dashboard/activity?iri=${encodeURIComponent(IRI)}`,
      { headers: ADMIN },
    );
    const html = await res.text();
    expect(html).toContain(`/dashboard/learner?id=${learnerId}`);
  });

  it("400s without params and 404s for unknown learner", async () => {
    expect((await SELF.fetch("https://proof.test/dashboard/learner", { headers: ADMIN })).status).toBe(400);
    expect(
      (await SELF.fetch(
        `https://proof.test/dashboard/learner?id=nope&iri=${encodeURIComponent(IRI)}`,
        { headers: ADMIN },
      )).status,
    ).toBe(404);
  });

  it("does not render correct or incorrect markers when success is absent", async () => {
    const iri = "https://example.org/x/no-success-progress";
    const s = new D1Storage(env.DB);
    await ingestStatements(s, {
      id: "ccccccc1-2222-4333-8444-ccccccccccc1",
      actor: {
        account: { homePage: "https://lms.example", name: "learner-no-success" },
        name: "No Success",
      },
      verb: { id: "http://adlnet.gov/expapi/verbs/progressed" },
      object: { id: iri, definition: { name: { en: "No Success Activity" } } },
      timestamp: "2026-07-02T12:00:00Z",
    });
    const row = await env.DB
      .prepare("SELECT id FROM learners WHERE identity = ?")
      .bind("https://lms.example|learner-no-success")
      .first<{ id: string }>();
    const res = await SELF.fetch(
      `https://proof.test/dashboard/learner?id=${row!.id}&iri=${encodeURIComponent(iri)}`,
      { headers: ADMIN },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Progressed");
    expect(html).not.toContain("✓ correct");
    expect(html).not.toContain("✗ incorrect");
  });
});
