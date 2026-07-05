// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { extractStep } from "../src/xapi/extract";
import type { ValidStatement } from "../src/xapi/validate";

const base = (over: Partial<ValidStatement>): ValidStatement =>
  ({
    actor: { mbox: "mailto:x@example.org" },
    verb: { id: "http://adlnet.gov/expapi/verbs/progressed" },
    object: { id: "https://p.test/a/quiz" },
    ...over,
  }) as ValidStatement;

describe("extractStep", () => {
  it("reads the step from a /steps/ child IRI (decoded)", () => {
    expect(extractStep(base({ object: { id: "https://p.test/a/quiz/steps/section%202" } as never })))
      .toBe("section 2");
  });
  it("reads the step from the result extension", () => {
    expect(
      extractStep(
        base({
          result: { extensions: { "https://praxity.io/xapi/ext/step": "q:q2" } } as never,
        }),
      ),
    ).toBe("q:q2");
  });
  it("prefers the child IRI when both are present", () => {
    expect(
      extractStep(
        base({
          object: { id: "https://p.test/a/quiz/steps/intro" } as never,
          result: { extensions: { "https://praxity.io/xapi/ext/step": "other" } } as never,
        }),
      ),
    ).toBe("intro");
  });
  it("returns null when neither shape is present", () => {
    expect(extractStep(base({}))).toBeNull();
  });
  it("ignores non-string extension values", () => {
    expect(
      extractStep(base({ result: { extensions: { "https://praxity.io/xapi/ext/step": 7 } } as never })),
    ).toBeNull();
  });
});
