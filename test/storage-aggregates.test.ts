// SPDX-License-Identifier: MIT
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { D1Storage } from "../src/storage/d1";
import { ingestStatements } from "../src/xapi/ingest";
import { bridgeSession } from "./fixtures/bridge-session";

const IRI = "https://example.org/x/agg-quiz";
const V = "http://adlnet.gov/expapi/verbs/";

const stmt = (actorName: string, verb: string, over: Record<string, unknown> = {}) => ({
  actor: { account: { homePage: "https://proof.test", name: actorName } },
  verb: { id: `${V}${verb}` },
  object: { id: IRI }, // no definition.name — must not rename the activity (latest-non-null-wins semantics)
  timestamp: "2026-07-01T10:00:00Z",
  ...over,
});

beforeAll(async () => {
  const s = new D1Storage(env.DB);
  // Learner A: full bridge session (initialized..completed) on a separate IRI namespace
  await ingestStatements(s, bridgeSession(IRI, "11111111-2222-4333-8444-555555555555"));
  // Learner B: started, never finished
  await ingestStatements(s, [stmt("dev-b", "initialized")]);
  // Learner B: a step statement (child IRI) later — must count into lastSeen, not activities list
  await ingestStatements(s, [
    stmt("dev-b", "progressed", {
      object: { id: `${IRI}/steps/intro` },
      timestamp: "2026-07-02T09:00:00Z",
    }),
  ]);
});

describe("storage aggregates", () => {
  it("listActivities excludes child pseudo-activities and counts starts/participants/completions", async () => {
    const s = new D1Storage(env.DB);
    const all = await s.listActivities();
    const iris = all.map((a) => a.iri);
    expect(iris).toContain(IRI);
    expect(iris.some((i) => i.includes("/q/") || i.includes("/steps/"))).toBe(false);
    const agg = all.find((a) => a.iri === IRI)!;
    expect(agg.name).toBe("Fractions check"); // bridge session named it; later statements carry no name, so latest-non-null-wins leaves it unchanged
    expect(agg.starts).toBe(2);               // two initialized
    expect(agg.participants).toBe(2);
    expect(agg.completions).toBe(1);          // learner A only
  });

  it("getActivityStats returns starts, participants, completions, latest scores and durations", async () => {
    const s = new D1Storage(env.DB);
    const stats = await s.getActivityStats(IRI);
    expect(stats.starts).toBe(2);
    expect(stats.participants).toBe(2);
    expect(stats.completions).toBe(1);
    expect(stats.avgScoreScaled).toBeCloseTo(0.8);
    expect(stats.durationsSec).toEqual([312]);
  });

  it("listRoster labels learners, flags completion, includes child statements in lastSeen", async () => {
    const s = new D1Storage(env.DB);
    const roster = await s.listRoster(IRI);
    expect(roster).toHaveLength(2);
    const lea = roster.find((r) => r.label === "Lea R.")!;
    expect(lea.completed).toBe(true);
    expect(lea.scoreRaw).toBe(8);
    expect(lea.scoreMax).toBe(10);
    const devB = roster.find((r) => r.label.includes("dev-b"))!;
    expect(devB.completed).toBe(false);
    expect(devB.lastSeen.startsWith("2026-07-02")).toBe(true); // child step statement counted
  });

  it("startsPerDay buckets initialized statements by day", async () => {
    const s = new D1Storage(env.DB);
    const days = await s.startsPerDay(IRI, 3650);
    const total = days.reduce((n, d) => n + d.count, 0);
    expect(total).toBe(2);
    for (const d of days) expect(d.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getActivity returns the row or null", async () => {
    const s = new D1Storage(env.DB);
    expect((await s.getActivity(IRI))?.iri).toBe(IRI);
    expect(await s.getActivity("https://example.org/nope")).toBeNull();
  });

  it("listRoster picks score_raw and score_max from the same (latest) scored statement", async () => {
    // Use a fresh IRI so there is no interference from beforeAll data.
    const SCORE_IRI = "https://example.org/x/same-row-scores";
    const s = new D1Storage(env.DB);

    // Attempt 1 (earlier): 2/10
    await ingestStatements(s, [
      {
        actor: { account: { homePage: "https://proof.test", name: "score-learner-x" } },
        verb: { id: `${V}passed` },
        object: { id: SCORE_IRI },
        result: { score: { raw: 2, max: 10 } },
        timestamp: "2026-06-01T10:00:00Z",
      },
    ]);

    // Attempt 2 (later): 8/8
    await ingestStatements(s, [
      {
        actor: { account: { homePage: "https://proof.test", name: "score-learner-x" } },
        verb: { id: `${V}passed` },
        object: { id: SCORE_IRI },
        result: { score: { raw: 8, max: 8 } },
        timestamp: "2026-06-02T10:00:00Z",
      },
    ]);

    const roster = await s.listRoster(SCORE_IRI);
    expect(roster).toHaveLength(1);
    // Both values must come from the same (latest) statement: 8/8, not a mix of 8/10.
    expect(roster[0].scoreRaw).toBe(8);
    expect(roster[0].scoreMax).toBe(8);
  });

  it("orders offset timestamps by instant and stores them in UTC", async () => {
    const iri = `https://example.org/x/offset-${crypto.randomUUID()}`;
    const actor = { account: { homePage: "https://proof.test", name: "offset-learner" } };
    const s = new D1Storage(env.DB);
    await ingestStatements(s, [
      {
        actor,
        verb: { id: `${V}scored` },
        object: { id: iri },
        result: { score: { raw: 1, max: 10, scaled: 0.1 } },
        timestamp: "2026-07-09T12:00:00+14:00",
      },
      {
        actor,
        verb: { id: `${V}scored` },
        object: { id: iri },
        result: { score: { raw: 9, max: 10, scaled: 0.9 } },
        timestamp: "2026-07-09T01:00:00Z",
      },
    ]);

    const roster = await s.listRoster(iri);
    expect(roster[0]).toMatchObject({ scoreRaw: 9, scoreMax: 10, lastSeen: "2026-07-09T01:00:00.000Z" });
    expect((await s.getActivityStats(iri)).avgScoreScaled).toBeCloseTo(0.9);
    const timestamps = await env.DB.prepare(
      "SELECT timestamp FROM statements WHERE activity_iri = ? ORDER BY timestamp",
    ).bind(iri).all<{ timestamp: string }>();
    expect(timestamps.results.map((row) => row.timestamp)).toEqual([
      "2026-07-08T22:00:00.000Z",
      "2026-07-09T01:00:00.000Z",
    ]);
  });

  it("does not let later child-question scores or durations replace parent results", async () => {
    const iri = `https://example.org/x/parent-metrics-${crypto.randomUUID()}`;
    const actor = { account: { homePage: "https://proof.test", name: "parent-metric-learner" } };
    const s = new D1Storage(env.DB);
    await ingestStatements(s, [
      {
        actor,
        verb: { id: `${V}completed` },
        object: { id: iri },
        result: { completion: true, score: { scaled: 0.8 }, duration: "PT80S" },
        timestamp: "2026-07-09T10:00:00Z",
      },
      {
        actor,
        verb: { id: `${V}answered` },
        object: { id: `${iri}/q/final` },
        result: { success: true, score: { scaled: 1 }, duration: "PT5S" },
        timestamp: "2026-07-09T10:01:00Z",
      },
    ]);

    const stats = await s.getActivityStats(iri);
    expect(stats.avgScoreScaled).toBeCloseTo(0.8);
    expect(stats.durationsSec).toEqual([80]);
  });

  it("paginates deterministically when learners share the same last-seen instant", async () => {
    const iri = `https://example.org/x/tied-page-${crypto.randomUUID()}`;
    const s = new D1Storage(env.DB);
    await ingestStatements(s, ["a", "b", "c"].map((name) => ({
      actor: { account: { homePage: "https://proof.test", name: `tie-${name}` } },
      verb: { id: `${V}initialized` },
      object: { id: iri },
      timestamp: "2026-07-09T10:00:00Z",
    })));

    const all = await s.listRoster(iri, 3, 0);
    const paged = [
      ...(await s.listRoster(iri, 2, 0)),
      ...(await s.listRoster(iri, 2, 2)),
    ];
    expect(paged.map((row) => row.learnerId)).toEqual(all.map((row) => row.learnerId));
    expect(new Set(paged.map((row) => row.learnerId)).size).toBe(3);
  });

  it("includes child statements for URL-shaped parent activity IRIs", async () => {
    const parent = "https://prax-proof.aharlap.workers.dev/a/local-url-parent";
    const actor = { account: { homePage: "https://proof.test", name: "url-parent-learner" } };
    const s = new D1Storage(env.DB);

    await ingestStatements(s, [
      {
        actor,
        verb: { id: `${V}initialized` },
        object: { id: parent, definition: { name: { en: "URL Parent" } } },
        timestamp: "2026-07-04T10:00:00Z",
      },
      {
        actor,
        verb: { id: `${V}progressed` },
        object: { id: `${parent}/steps/scenario` },
        timestamp: "2026-07-04T10:01:00Z",
      },
      {
        actor,
        verb: { id: `${V}answered` },
        object: { id: `${parent}/q/realities` },
        result: { response: "constraints" },
        timestamp: "2026-07-04T10:02:00Z",
      },
    ]);

    const roster = await s.listRoster(parent);
    expect(roster).toHaveLength(1);
    expect(roster[0].lastSeen.startsWith("2026-07-04T10:02")).toBe(true);

    const funnel = await s.stepFunnel(parent);
    expect(funnel.map((row) => row.step)).toContain("scenario");

    const raws = await s.rawStatements(parent);
    expect(raws).toHaveLength(3);

    const timeline = await s.learnerTimeline(parent, roster[0].learnerId);
    expect(timeline.map((row) => row.activityIri)).toContain(`${parent}/q/realities`);
  });
});
