// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { activityName, extractColumns, learnerIdentity, parseDuration } from "../src/xapi/extract";
import type { ValidStatement } from "../src/xapi/validate";

const base: ValidStatement = {
  actor: { mbox: "mailto:amara@example.org", name: "Amara O." },
  verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
  object: { id: "https://example.org/act/fractions-quiz", definition: { name: { en: "Fractions Quiz", fr: "Quiz fractions" } } },
  result: { score: { raw: 8, min: 0, max: 10, scaled: 0.8 }, success: true, completion: true, duration: "PT4M32S" },
  timestamp: "2026-07-02T10:00:00Z",
};

describe("learnerIdentity", () => {
  it("uses mbox with actor name as display", () => {
    expect(learnerIdentity(base.actor)).toEqual({
      identity: "mailto:amara@example.org",
      displayName: "Amara O.",
    });
  });
  it("uses homePage|name for accounts, falling back to account name for display", () => {
    expect(learnerIdentity({ account: { homePage: "https://proof.example", name: "learner-42" } })).toEqual({
      identity: "https://proof.example|learner-42",
      displayName: "learner-42",
    });
  });
  it("uses mbox_sha1sum with null display when no name", () => {
    expect(learnerIdentity({ mbox_sha1sum: "a9993e364706816aba3e25717850c26c9cd0d89d" })).toEqual({
      identity: "sha1:a9993e364706816aba3e25717850c26c9cd0d89d",
      displayName: null,
    });
  });
});

describe("parseDuration", () => {
  it("parses PT4M32S", () => expect(parseDuration("PT4M32S")).toBe(272));
  it("parses PT1H30M", () => expect(parseDuration("PT1H30M")).toBe(5400));
  it("parses PT0.5S fractional seconds", () => expect(parseDuration("PT0.5S")).toBe(0.5));
  it("parses P1DT2H", () => expect(parseDuration("P1DT2H")).toBe(93600));
  it("returns null for garbage", () => expect(parseDuration("4 minutes")).toBeNull());
});

describe("extractColumns", () => {
  it("extracts verb, activity, score, flags, duration, timestamps", () => {
    const c = extractColumns(base, "11111111-1111-4111-8111-111111111111", "2026-07-02T10:00:01.000Z");
    expect(c).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      verb: "http://adlnet.gov/expapi/verbs/completed",
      activityIri: "https://example.org/act/fractions-quiz",
      scoreRaw: 8, scoreMin: 0, scoreMax: 10, scoreScaled: 0.8,
      success: 1, completion: 1, durationSec: 272,
      timestamp: "2026-07-02T10:00:00Z",
      stored: "2026-07-02T10:00:01.000Z",
      registration: null,
      step: null,
      response: null,
    });
  });
  it("uses stored time as timestamp when statement has none, null activity for StatementRef", () => {
    const s: ValidStatement = {
      actor: base.actor,
      verb: { id: "https://example.org/verbs/pondered" },
      object: { objectType: "StatementRef", id: "22222222-2222-4222-8222-222222222222" } as never,
    };
    const c = extractColumns(s, "33333333-3333-4333-8333-333333333333", "2026-07-02T11:00:00.000Z");
    expect(c.activityIri).toBeNull();
    expect(c.timestamp).toBe("2026-07-02T11:00:00.000Z");
    expect(c.scoreRaw).toBeNull();
    expect(c.success).toBeNull();
  });
});

describe("activityName", () => {
  it("prefers the en name", () => expect(activityName(base)).toBe("Fractions Quiz"));
  it("uses an en-* name when there is no exact en name", () =>
    expect(
      activityName({
        ...base,
        object: {
          id: "https://example.org/a",
          definition: { name: { fr: "Quiz fractions", "en-US": "Fractions Quiz US" } },
        },
      }),
    ).toBe("Fractions Quiz US"));
  it("uses the first name when there are only non-en names", () =>
    expect(
      activityName({
        ...base,
        object: {
          id: "https://example.org/a",
          definition: { name: { fr: "Quiz fractions" } },
        },
      }),
    ).toBe("Quiz fractions"));
  it("returns null when object has no definition", () =>
    expect(activityName({ ...base, object: { id: "https://example.org/a" } })).toBeNull());
});
