// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parseStatements } from "../src/xapi/validate";

const valid = {
  actor: { mbox: "mailto:amara@example.org", name: "Amara O." },
  verb: { id: "http://adlnet.gov/expapi/verbs/completed", display: { en: "completed" } },
  object: { id: "https://example.org/act/fractions-quiz" },
  result: { score: { raw: 8, min: 0, max: 10, scaled: 0.8 }, success: true, completion: true, duration: "PT4M32S" },
  timestamp: "2026-07-02T10:00:00Z",
};

describe("parseStatements", () => {
  it("accepts a single valid statement", () => {
    const r = parseStatements(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.statements).toHaveLength(1);
  });

  it("accepts an array of statements", () => {
    const r = parseStatements([valid, valid]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.statements).toHaveLength(2);
  });

  it("reports the 1-based statement number when the second batch item is invalid", () => {
    const r = parseStatements([valid, { ...valid, verb: { id: "completed" } }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Statement 2");
  });

  it("accepts actors identified by account", () => {
    const r = parseStatements({
      ...valid,
      actor: { account: { homePage: "https://proof.example", name: "learner-42" } },
    });
    expect(r.ok).toBe(true);
  });

  it("accepts unknown verbs (stored, never dropped)", () => {
    const r = parseStatements({ ...valid, verb: { id: "https://example.org/verbs/pondered" } });
    expect(r.ok).toBe(true);
  });

  it("rejects an actor with no identifier", () => {
    const r = parseStatements({ ...valid, actor: { name: "No Id" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/actor/i);
  });

  it("rejects a verb id that is not an IRI", () => {
    const r = parseStatements({ ...valid, verb: { id: "completed" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/verb/i);
  });

  it("rejects a statement with no object", () => {
    const { object: _drop, ...rest } = valid;
    const r = parseStatements(rest);
    expect(r.ok).toBe(false);
  });

  it("rejects non-statement junk with a readable error", () => {
    const r = parseStatements("hello");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(typeof r.error).toBe("string");
  });

  it("rejects malformed mbox values", () => {
    for (const mbox of ["mailto:x@", "mailto:@y.com", "mailto:no-at-sign", "x@y.com"]) {
      const r = parseStatements({ ...valid, actor: { mbox } });
      expect(r.ok).toBe(false);
    }
  });

  it("rejects uppercase mbox_sha1sum hex", () => {
    const r = parseStatements({
      ...valid,
      actor: { mbox_sha1sum: "A9993E364706816ABA3E25717850C26C9CD0D89D" },
    });
    expect(r.ok).toBe(false);
  });
});
