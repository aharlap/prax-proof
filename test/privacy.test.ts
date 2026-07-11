// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { D1Storage } from "../src/storage/d1";
import { runRetention } from "../src/retention";
import { ingestStatements } from "../src/xapi/ingest";
import { ADMIN } from "./helpers";

describe("privacy controls", () => {
  it("serves a public, no-store notice and dynamic llms.txt guidance", async () => {
    const notice = await SELF.fetch("https://proof.test/privacy");
    expect(notice.status).toBe(200);
    expect(notice.headers.get("Cache-Control")).toBe("no-store");
    expect(await notice.text()).toContain("Learning tracking and privacy");

    const update = await SELF.fetch("https://proof.test/dashboard/settings", {
      method: "POST",
      headers: {
        ...ADMIN,
        Origin: "https://proof.test",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        operatorName: "Example Learning Co-op",
        privacyUrl: "https://learn.example/privacy",
        privacyContact: "privacy@learn.example",
        regionLabel: "Canada",
        retentionDays: "90",
        trackingMode: "consent",
      }).toString(),
    });
    expect(update.status).toBe(200);

    const llms = await SELF.fetch("https://proof.test/llms.txt");
    const text = await llms.text();
    expect(llms.headers.get("Cache-Control")).toBe("no-store");
    expect(text).toContain('data-tracking="consent"');
    expect(text).toContain("https://learn.example/privacy");
    expect(text).toContain("Example Learning Co-op");
    expect(text).toContain("90 days in Canada");
    expect(text).toContain("Do not claim that Proof or this setup makes the page compliant");
  });

  it("drains retention backlogs larger than one batch and removes orphans", async () => {
    const storage = new D1Storage(env.DB);
    const oldIri = `https://example.org/a/${crypto.randomUUID()}`;
    const currentIri = `https://example.org/a/${crypto.randomUUID()}`;
    const actor = (name: string) => ({ account: { homePage: "https://proof.test", name } });
    await ingestStatements(storage, {
      actor: actor("current-learner"),
      verb: { id: "http://adlnet.gov/expapi/verbs/initialized" },
      object: { id: currentIri },
    });
    await env.DB.prepare("INSERT INTO activities (iri, name) VALUES (?, 'Expired activity')")
      .bind(oldIri)
      .run();
    await env.DB.prepare(
      "INSERT INTO learners (id, identity, display_name) VALUES ('expired-learner-id', 'expired-learner', NULL)",
    ).run();
    await env.DB.prepare(
      `WITH RECURSIVE sequence(n) AS (
         SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 1005
       )
       INSERT INTO statements (id, raw, verb, activity_iri, learner_id, timestamp, stored)
       SELECT printf('expired-statement-%04d', n), '{}',
              'http://adlnet.gov/expapi/verbs/initialized', ?, 'expired-learner-id',
              '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'
       FROM sequence`,
    ).bind(oldIri).run();
    const currentSettings = await storage.getSettings();
    await storage.updateSettings({ ...currentSettings, retentionDays: 1 });

    const deleted = await runRetention(env);
    expect(deleted).toBe(1005);
    expect(await env.DB.prepare("SELECT id FROM statements WHERE stored < '2021-01-01'").first()).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM learners WHERE id = 'expired-learner-id'").first()).toBeNull();
    expect(await env.DB.prepare("SELECT iri FROM activities WHERE iri = ?").bind(oldIri).first()).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM learners WHERE identity LIKE '%current-learner'").first()).not.toBeNull();
  });

  it("exports and deletes a learner through authenticated rights endpoints", async () => {
    const storage = new D1Storage(env.DB);
    const iri = `https://example.org/a/${crypto.randomUUID()}`;
    await ingestStatements(storage, {
      actor: { account: { homePage: "https://proof.test", name: "rights-learner" } },
      verb: { id: "http://adlnet.gov/expapi/verbs/initialized" },
      object: { id: iri },
    });
    const learner = await env.DB.prepare("SELECT id FROM learners WHERE identity LIKE '%rights-learner'")
      .first<{ id: string }>();

    const exported = await SELF.fetch(`https://proof.test/admin/learners/${learner?.id}`, { headers: ADMIN });
    expect(exported.status).toBe(200);
    expect((await exported.json()) as object).toHaveProperty("statements");

    const deleted = await SELF.fetch(`https://proof.test/admin/learners/${learner?.id}`, {
      method: "DELETE",
      headers: ADMIN,
    });
    expect(deleted.status).toBe(204);
    expect(await storage.getLearner(learner!.id)).toBeNull();
  });
});
