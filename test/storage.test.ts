// SPDX-License-Identifier: MIT
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { D1Storage } from "../src/storage/d1";
import type { StatementRow } from "../src/storage/types";

const row = (id: string, over: Partial<StatementRow> = {}): StatementRow => ({
  id,
  raw: `{"id":"${id}"}`,
  verb: "http://adlnet.gov/expapi/verbs/completed",
  activityIri: "https://example.org/act/1",
  learnerId: null,
  scoreRaw: 8, scoreMin: 0, scoreMax: 10, scoreScaled: 0.8,
  success: 1, completion: 1, durationSec: 272,
  timestamp: "2026-07-02T10:00:00.000Z",
  stored: "2026-07-02T10:00:01.000Z",
  registration: null,
  step: null,
  response: null,
  ...over,
});

describe("D1Storage", () => {
  it("creates and finds keys", async () => {
    const s = new D1Storage(env.DB);
    await s.createKey("key-1", "hash-abc", "classroom");
    const found = await s.findKey("key-1");
    expect(found).toMatchObject({ id: "key-1", secretHash: "hash-abc", label: "classroom" });
    expect(await s.findKey("nope")).toBeNull();
  });

  it("upserts activities without clobbering an existing name with null", async () => {
    const s = new D1Storage(env.DB);
    await s.upsertActivity("https://example.org/act/1", "Fractions Quiz");
    await s.upsertActivity("https://example.org/act/1", null);
    const r = await env.DB.prepare("SELECT name FROM activities WHERE iri = ?")
      .bind("https://example.org/act/1").first<{ name: string }>();
    expect(r?.name).toBe("Fractions Quiz");
  });

  it("upsertLearner returns a stable id per identity", async () => {
    const s = new D1Storage(env.DB);
    const a = await s.upsertLearner("mailto:amara@example.org", "Amara O.");
    const b = await s.upsertLearner("mailto:amara@example.org", "Amara O.");
    expect(a).toBe(b);
  });

  it("upsertLearner preserves an existing display name when a later call passes null", async () => {
    const s = new D1Storage(env.DB);
    await s.upsertLearner("mailto:real-name@example.org", "Real Name");
    await s.upsertLearner("mailto:real-name@example.org", null);
    const r = await env.DB.prepare("SELECT display_name FROM learners WHERE identity = ?")
      .bind("mailto:real-name@example.org").first<{ display_name: string }>();
    expect(r?.display_name).toBe("Real Name");
  });

  it("insertStatements is idempotent per statement id", async () => {
    const s = new D1Storage(env.DB);
    const first = await s.insertStatements([row("11111111-1111-4111-8111-111111111111")]);
    const second = await s.insertStatements([row("11111111-1111-4111-8111-111111111111")]);
    expect(first).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(second).toEqual([]);
    const got = await s.getStatement("11111111-1111-4111-8111-111111111111");
    expect(got?.verb).toBe("http://adlnet.gov/expapi/verbs/completed");
    expect(got?.scoreScaled).toBe(0.8);
  });

  it("upsertActivity lets a later non-null name correct the stored one", async () => {
    const s = new D1Storage(env.DB);
    await s.upsertActivity("https://example.org/act/rename", "Typo'd Titel");
    await s.upsertActivity("https://example.org/act/rename", "Typo'd Title (fixed)");
    const r = await env.DB.prepare("SELECT name FROM activities WHERE iri = ?")
      .bind("https://example.org/act/rename").first<{ name: string }>();
    expect(r?.name).toBe("Typo'd Title (fixed)");
  });
});
