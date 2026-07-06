// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  buildAnswer, buildFinish, buildStart, buildStep, resolveIdentity,
  type IdentityAdapters, type SnippetContext,
} from "../src/snippet/core";

function fakeAdapters(over: Partial<IdentityAdapters> = {}): IdentityAdapters & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getStored: (k) => store.get(k) ?? null,
    setStored: (k, v) => void store.set(k, v),
    ask: () => null,
    urlParam: () => null,
    randomId: () => "device-uuid-1",
    origin: "https://proof.example",
    ...over,
  };
}

const ctx: SnippetContext = {
  activityIri: "https://proof.example/a/fractions-quiz",
  activityName: "fractions-quiz",
  actor: { account: { homePage: "https://proof.example", name: "device-uuid-1" } },
  registration: "11111111-1111-4111-8111-111111111111",
};

describe("resolveIdentity", () => {
  it("anonymous mints and persists a device id", () => {
    const a = fakeAdapters();
    const actor = resolveIdentity("anonymous", a);
    expect(actor).toEqual({ account: { homePage: "https://proof.example", name: "device-uuid-1" } });
    expect(a.store.get("proof:device")).toBe("device-uuid-1");
    expect(resolveIdentity("anonymous", a)).toEqual(actor); // stable on re-run
  });

  it("ask stores the entered name and reuses it", () => {
    const a = fakeAdapters({ ask: () => "Amara O." });
    const actor = resolveIdentity("ask", a);
    expect(actor.name).toBe("Amara O.");
    expect(actor.account.name).toBe("device-uuid-1");
    expect(a.store.get("proof:name")).toBe("Amara O.");
    const again = resolveIdentity("ask", { ...a, ask: () => "SHOULD NOT BE CALLED" });
    expect(again.name).toBe("Amara O.");
  });

  it("ask degrades to anonymous on cancel or blank", () => {
    for (const answer of [null, "", "   "]) {
      const a = fakeAdapters({ ask: () => answer });
      const actor = resolveIdentity("ask", a);
      expect(actor.name).toBeUndefined();
      expect(a.store.has("proof:name")).toBe(false);
    }
  });

  it("token uses the plearner URL param and degrades to anonymous without it", () => {
    const withToken = resolveIdentity("token", fakeAdapters({ urlParam: (n) => (n === "plearner" ? "tok-7f3a" : null) }));
    expect(withToken.account.name).toBe("tok-7f3a");
    const without = resolveIdentity("token", fakeAdapters());
    expect(without.account.name).toBe("device-uuid-1");
  });

  it("token mode does not store a device id when the URL token is present", () => {
    const a = fakeAdapters({ urlParam: (n) => (n === "plearner" ? "tok-7f3a" : null) });
    resolveIdentity("token", a);
    expect(a.store.has("proof:device")).toBe(false);
  });
});

describe("statement builders", () => {
  it("buildStart emits initialized against the activity with registration", () => {
    const s = buildStart(ctx) as Record<string, any>;
    expect(s.verb.id).toBe("http://adlnet.gov/expapi/verbs/initialized");
    expect(s.object.id).toBe(ctx.activityIri);
    expect(s.object.definition.name.en).toBe("fractions-quiz");
    expect(s.context.registration).toBe(ctx.registration);
    expect(s.actor).toEqual(ctx.actor);
    expect(typeof s.timestamp).toBe("string");
  });

  it("buildStep emits progressed against a step child IRI", () => {
    const s = buildStep(ctx, "section-2") as Record<string, any>;
    expect(s.verb.id).toBe("http://adlnet.gov/expapi/verbs/progressed");
    expect(s.object.id).toBe("https://proof.example/a/fractions-quiz/steps/section-2");
  });

  it("buildAnswer emits answered with success and response", () => {
    const s = buildAnswer(ctx, "q1", { response: "B", correct: true }) as Record<string, any>;
    expect(s.verb.id).toBe("http://adlnet.gov/expapi/verbs/answered");
    expect(s.object.id).toBe("https://proof.example/a/fractions-quiz/q/q1");
    expect(s.result).toEqual({ success: true, response: "B" });
  });

  it("buildAnswer omits result fields not supplied", () => {
    const s = buildAnswer(ctx, "q2") as Record<string, any>;
    expect(s.result).toBeUndefined();
  });

  it("buildFinish emits completed with completion and a scaled score", () => {
    const s = buildFinish(ctx, { score: 8, max: 10 }) as Record<string, any>;
    expect(s.verb.id).toBe("http://adlnet.gov/expapi/verbs/completed");
    expect(s.result.completion).toBe(true);
    expect(s.result.score).toEqual({ raw: 8, min: 0, max: 10, scaled: 0.8 });
  });

  it("buildFinish without a score still marks completion", () => {
    const s = buildFinish(ctx) as Record<string, any>;
    expect(s.result).toEqual({ completion: true });
  });

  it("special characters in ids are URI-encoded in child IRIs", () => {
    const s = buildStep(ctx, "part 2/α") as Record<string, any>;
    expect(s.object.id).toBe(`https://proof.example/a/fractions-quiz/steps/${encodeURIComponent("part 2/α")}`);
  });
});
