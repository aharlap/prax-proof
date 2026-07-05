// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { D1Storage } from "../src/storage/d1";
import { ingestStatements } from "../src/xapi/ingest";
import { bridgeSession } from "./fixtures/bridge-session";
import { ADMIN } from "./helpers";

const IRI = "https://example.org/x/funnel-quiz";
const V = "http://adlnet.gov/expapi/verbs/";

const learner = (name: string) => ({ account: { homePage: "https://p.test", name } });
const init = (who: string) => ({
  actor: learner(who), verb: { id: `${V}initialized` }, object: { id: IRI },
  timestamp: "2026-07-03T10:00:00Z",
});
const step = (who: string, id: string, ts: string) => ({
  actor: learner(who), verb: { id: `${V}progressed` },
  object: { id: `${IRI}/steps/${id}` }, timestamp: ts,
});

beforeAll(async () => {
  const s = new D1Storage(env.DB);
  // bridge session contributes: 1 learner, ext-step "q:q2", completion
  await ingestStatements(s, bridgeSession(IRI, "aaaaaaa1-1111-4111-8111-aaaaaaaaaaa1"));
  // three more learners: all start; two reach intro; one reaches wrap-up
  for (const who of ["d1", "d2", "d3"]) await ingestStatements(s, [init(who)]);
  await ingestStatements(s, [step("d1", "intro", "2026-07-03T10:01:00Z"), step("d2", "intro", "2026-07-03T10:02:00Z")]);
  await ingestStatements(s, [step("d1", "wrap-up", "2026-07-03T10:05:00Z")]);
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
});

describe("funnel section on activity detail", () => {
  it("renders Started, steps, Finished with counts and the biggest drop marker", async () => {
    const res = await SELF.fetch(
      `https://proof.test/dashboard/activity?iri=${encodeURIComponent(IRI)}`,
      { headers: ADMIN },
    );
    const html = await res.text();
    expect(html).toContain("Drop-off funnel");
    expect(html).toContain("Started");
    expect(html).toContain("Finished");
    expect(html).toContain("intro");
    expect(html).toContain("biggest drop-off");
  });
});
