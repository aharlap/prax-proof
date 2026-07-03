// SPDX-License-Identifier: MIT
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { D1Storage } from "../src/storage/d1";
import { ingestStatements } from "../src/xapi/ingest";

const stmt = (over: Record<string, unknown> = {}) => ({
  actor: { mbox: "mailto:ben@example.org", name: "Ben T." },
  verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
  object: { id: "https://example.org/act/quiz", definition: { name: { en: "Quiz" } } },
  result: { score: { raw: 7, max: 10 }, completion: true, duration: "PT2M" },
  timestamp: "2026-07-02T10:00:00Z",
  ...over,
});

describe("ingestStatements", () => {
  it("stores a statement and registers activity and learner", async () => {
    const s = new D1Storage(env.DB);
    const r = await ingestStatements(s, stmt());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ids).toHaveLength(1);
    const row = await s.getStatement(r.ids[0]);
    expect(row?.activityIri).toBe("https://example.org/act/quiz");
    expect(row?.durationSec).toBe(120);
    const act = await env.DB.prepare("SELECT name FROM activities WHERE iri = ?")
      .bind("https://example.org/act/quiz").first<{ name: string }>();
    expect(act?.name).toBe("Quiz");
    const learner = await env.DB.prepare("SELECT display_name FROM learners WHERE identity = ?")
      .bind("mailto:ben@example.org").first<{ display_name: string }>();
    expect(learner?.display_name).toBe("Ben T.");
  });

  it("preserves a client-supplied id and is idempotent on resend", async () => {
    const s = new D1Storage(env.DB);
    const id = "44444444-4444-4444-8444-444444444444";
    const first = await ingestStatements(s, stmt({ id }));
    const again = await ingestStatements(s, stmt({ id }));
    expect(first.ok && first.ids[0]).toBe(id);
    expect(again.ok && again.ids[0]).toBe(id);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM statements WHERE id = ?")
      .bind(id).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("handles a batch and keeps request order in returned ids", async () => {
    const s = new D1Storage(env.DB);
    const a = "55555555-5555-4555-8555-555555555555";
    const b = "66666666-6666-4666-8666-666666666666";
    const r = await ingestStatements(s, [stmt({ id: a }), stmt({ id: b })]);
    expect(r.ok && r.ids).toEqual([a, b]);
  });

  it("returns the validation error for invalid input", async () => {
    const s = new D1Storage(env.DB);
    const r = await ingestStatements(s, { nope: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/statement/i);
  });
});
