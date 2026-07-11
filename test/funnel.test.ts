// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { humanizeStep } from "../src/dashboard/routes";
import { D1Storage } from "../src/storage/d1";
import { ingestStatements } from "../src/xapi/ingest";
import { bridgeSession } from "./fixtures/bridge-session";
import { ADMIN } from "./helpers";

const IRI = "https://example.org/x/funnel-quiz";
const PERCENT_IRI = "https://example.org/x/percentage-drop-quiz";
const V = "http://adlnet.gov/expapi/verbs/";

const learner = (name: string) => ({ account: { homePage: "https://p.test", name } });
const init = (who: string, iri = IRI) => ({
  actor: learner(who), verb: { id: `${V}initialized` }, object: { id: iri },
  timestamp: "2026-07-03T10:00:00Z",
});
const step = (who: string, id: string, ts: string, iri = IRI) => ({
  actor: learner(who), verb: { id: `${V}progressed` },
  object: { id: `${iri}/steps/${id}` }, timestamp: ts,
});
const complete = (who: string, ts: string, iri = IRI) => ({
  actor: learner(who), verb: { id: `${V}completed` },
  object: { id: iri }, result: { completion: true }, timestamp: ts,
});

beforeAll(async () => {
  const s = new D1Storage(env.DB);
  // bridge session contributes: 1 learner, ext-step "q:q2", completion
  await ingestStatements(s, bridgeSession(IRI, "aaaaaaa1-1111-4111-8111-aaaaaaaaaaa1"));
  // three more learners: all start; two reach intro; one reaches wrap-up
  for (const who of ["d1", "d2", "d3"]) await ingestStatements(s, [init(who)]);
  await ingestStatements(s, [step("d1", "intro", "2026-07-03T10:01:00Z"), step("d2", "intro", "2026-07-03T10:02:00Z")]);
  await ingestStatements(s, [step("d1", "wrap-up", "2026-07-03T10:05:00Z")]);

  for (let i = 1; i <= 10; i++) await ingestStatements(s, [init(`p${i}`, PERCENT_IRI)]);
  for (let i = 1; i <= 5; i++) {
    await ingestStatements(s, [step(`p${i}`, "broad-start", `2026-07-04T10:0${i}:00Z`, PERCENT_IRI)]);
  }
  await ingestStatements(s, [step("p1", "filter-review", "2026-07-04T10:07:00Z", PERCENT_IRI)]);
  await ingestStatements(s, [complete("p1", "2026-07-04T10:08:00Z", PERCENT_IRI)]);
});

describe("stepFunnel", () => {
  it("counts distinct learners per step ordered by first appearance", async () => {
    const funnel = await new D1Storage(env.DB).stepFunnel(IRI);
    const labels = funnel.map((f) => f.step);
    // intro first-seen at 10:01Z, wrap-up at 10:05Z, q:q2 (bridge ext-step) at 14:02Z
    expect(labels).toEqual(["intro", "wrap-up", "q:q2"]);
    const byStep = Object.fromEntries(funnel.map((f) => [f.step, f.learners]));
    expect(byStep["intro"]).toBe(2);
    expect(byStep["wrap-up"]).toBe(1);
    expect(byStep["q:q2"]).toBe(1);
  });

  it("does not count an earlier out-of-order visit as forward progress", async () => {
    const iri = `https://example.org/x/chronology-${crypto.randomUUID()}`;
    const s = new D1Storage(env.DB);
    await ingestStatements(s, [
      init("ordered", iri),
      step("ordered", "first", "2026-07-03T10:01:00Z", iri),
      step("ordered", "second", "2026-07-03T10:02:00Z", iri),
      complete("ordered", "2026-07-03T10:03:00Z", iri),
      init("out-of-order", iri),
      step("out-of-order", "second", "2026-07-03T10:04:00Z", iri),
      step("out-of-order", "first", "2026-07-03T10:05:00Z", iri),
    ]);

    const funnel = await s.stepFunnel(iri);
    expect(funnel.map((row) => row.step)).toEqual(["first", "second"]);
    expect(funnel.find((row) => row.step === "first")).toMatchObject({ learners: 2, dropOff: 1 });
    expect(funnel.find((row) => row.step === "second")).toMatchObject({ learners: 2, dropOff: 1 });
  });
});

describe("humanizeStep", () => {
  it("humanizes punctuation-delimited step ids", () => {
    expect(humanizeStep("q:q2")).toBe("Q q2");
    expect(humanizeStep("wrap-up")).toBe("Wrap up");
  });
});

describe("funnel section on activity detail", () => {
  it("renders a table with retention, definition copy, and the biggest drop marker", async () => {
    const res = await SELF.fetch(
      `https://proof.test/dashboard/activity?iri=${encodeURIComponent(IRI)}`,
      { headers: ADMIN },
    );
    const html = await res.text();
    expect(html).toContain("Drop-off funnel");
    expect(html).toContain("Retention");
    expect(html).toContain("Participants are distinct learner records with any event for this activity. Drop-off counts participants who reached a row but no later row.");
    expect(html).toContain("Participants");
    expect(html).toContain("Finished");
    expect(html).toContain("Intro");
    expect(html).toContain("▼ biggest drop-off");
    expect(html).toMatch(/<tr class="prax-drop-row">\s*<td title="wrap-up">Wrap up<\/td>[\s\S]*?▼ biggest drop-off/);
  });

  it("marks the largest percentage drop, even when a larger absolute loss appears earlier", async () => {
    const res = await SELF.fetch(
      `https://proof.test/dashboard/activity?iri=${encodeURIComponent(PERCENT_IRI)}`,
      { headers: ADMIN },
    );
    const html = await res.text();
    expect(html).toContain("Broad start");
    expect(html).toContain("−5 (50%)");
    expect(html).toContain("Filter review");
    expect(html).toContain("−4 (80%)");
    expect(html).toMatch(/<tr class="prax-drop-row">\s*<td title="broad-start">Broad start<\/td>[\s\S]*?−4 \(80%\)[\s\S]*?▼ biggest drop-off/);
  });

  it("uses identical fixed-track percentages for equal-count steps", async () => {
    const res = await SELF.fetch(
      `https://proof.test/dashboard/activity?iri=${encodeURIComponent(IRI)}`,
      { headers: ADMIN },
    );
    const html = await res.text();
    const widthFor = (label: string) => {
      const row = new RegExp(`<tr[^>]*>\\s*<td[^>]*>${label}</td>[\\s\\S]*?<div class="prax-track-fill" style="([^"]+)"`).exec(html);
      return row?.[1];
    };
    expect(widthFor("Wrap up")).toBe("width:25%");
    expect(widthFor("Q q2")).toBe(widthFor("Wrap up"));
  });
});
