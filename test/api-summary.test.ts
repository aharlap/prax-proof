// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { mintKey } from "../src/auth";
import { D1Storage } from "../src/storage/d1";
import { ingestStatements } from "../src/xapi/ingest";
import { bridgeSession } from "./fixtures/bridge-session";
import { ADMIN } from "./helpers";

const IRI = "https://proof.test/a/api-quiz";
const STEPLESS_IRI = "https://proof.test/a/api-stepless";
const V = "http://adlnet.gov/expapi/verbs/";

let readAuthz = "";
let ingestAuthz = "";

const bearer = (key: { id: string; secret: string }) => `Bearer ${key.id}:${key.secret}`;

const init = (iri: string, learner: string, timestamp = "2026-07-03T14:01:00Z") => ({
  actor: { account: { homePage: "https://proof.test", name: learner } },
  verb: { id: `${V}initialized` },
  object: { id: iri },
  timestamp,
});
const complete = (iri: string, learner: string, timestamp = "2026-07-03T14:02:00Z") => ({
  actor: { account: { homePage: "https://proof.test", name: learner } },
  verb: { id: `${V}completed` },
  object: { id: iri },
  result: { completion: true },
  timestamp,
});

async function apiGet(path: string, authz = readAuthz): Promise<Response> {
  return SELF.fetch(`https://proof.test${path}`, { headers: { Authorization: authz } });
}

beforeAll(async () => {
  const storage = new D1Storage(env.DB);
  await ingestStatements(storage, bridgeSession(IRI, "77777777-2222-4333-8444-555555555555"));
  await ingestStatements(storage, [init(IRI, "api-dev-2")]);
  await ingestStatements(storage, [init(STEPLESS_IRI, "api-stepless-1"), complete(STEPLESS_IRI, "api-stepless-1")]);

  readAuthz = bearer(await mintKey(env.DB, "api summary reader", "read"));
  ingestAuthz = bearer(await mintKey(env.DB, "api summary writer", "ingest"));
});

describe("summary JSON API", () => {
  it("lists activities for a read key", async () => {
    const res = await apiGet("/api/activities");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const activities = (await res.json()) as {
      iri: string;
      starts: number;
      participants: number;
      completions: number;
      pageUrl: string | null;
    }[];
    const activity = activities.find((row) => row.iri === IRI);
    expect(activity).toMatchObject({ starts: 2, participants: 2, completions: 1, pageUrl: null });
    expect(activity).not.toHaveProperty("firstSeen");
  });

  it("returns a compact activity summary by iri", async () => {
    const res = await apiGet(`/api/activity?iri=${encodeURIComponent(IRI)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stats: {
        starts: number;
        participants: number;
        completions: number;
        completionRate: number;
        avgScoreScaled: number;
        medianDurationSec: number;
      };
      funnel: { step: string; learners: number; retention: number | null; dropOff: number | null }[];
      learners: {
        label: string;
        anonymous: boolean;
        completed: boolean;
        score: { raw: number; max: number | null } | null;
        responses: { question: string; label: string | null; response: string | null; correct: boolean | null }[];
      }[];
    };
    expect(body.stats).toMatchObject({
      starts: 2,
      participants: 2,
      completions: 1,
      completionRate: 0.5,
      avgScoreScaled: 0.8,
      medianDurationSec: 312,
    });
    expect(body.funnel[0]).toMatchObject({ step: "__participants__", learners: 2, retention: 1, dropOff: 1 });
    expect(body.funnel.find((row) => row.step === "q:q2")).toMatchObject({ retention: 0.5, dropOff: 0 });
    expect(body.funnel.at(-1)).toMatchObject({ step: "__finished__", learners: 1, dropOff: 0 });
    expect(body.learners).toHaveLength(2);

    const lea = body.learners.find((row) => row.label === "Lea R.")!;
    expect(lea.anonymous).toBe(false);
    expect(lea.completed).toBe(true);
    expect(lea.score).toEqual({ raw: 8, max: 10 });
    expect(lea.responses).toEqual([{ question: "q1", label: null, response: "a", correct: true }]);

    const other = body.learners.find((row) => row.label === "api-dev-2")!;
    expect(other.completed).toBe(false);
    expect(other.responses).toEqual([]);
  });

  it("reports activity-wide question counts beyond the current learner page", async () => {
    const iri = `https://proof.test/a/api-bulk-${crypto.randomUUID()}`;
    const questionIri = `${iri}/q/bulk-question`;
    await env.DB.prepare("INSERT INTO activities (iri, name) VALUES (?, ?), (?, ?)")
      .bind(iri, "Bulk activity", questionIri, "Bulk question")
      .run();
    await env.DB.prepare(
      `WITH RECURSIVE sequence(n) AS (
         SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 501
       )
       INSERT INTO learners (id, identity, display_name)
       SELECT printf('bulk-learner-%03d', n), printf('bulk-identity-%03d', n), NULL FROM sequence`,
    ).run();
    await env.DB.prepare(
      `WITH RECURSIVE sequence(n) AS (
         SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 501
       )
       INSERT INTO statements
         (id, raw, verb, activity_iri, learner_id, success, timestamp, stored, response)
       SELECT printf('bulk-statement-%03d', n), '{}',
              'http://adlnet.gov/expapi/verbs/answered', ?, printf('bulk-learner-%03d', n),
              CASE WHEN n % 2 = 0 THEN 1 ELSE 0 END,
              '2026-07-09T10:00:00.000Z', '2026-07-09T10:00:00.000Z', 'answer'
       FROM sequence`,
    ).bind(questionIri).run();

    const res = await apiGet(`/api/activity?iri=${encodeURIComponent(iri)}&page=1&perPage=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      learners: unknown[];
      questionBreakdown: { questionId: string; answered: number; correct: number; knownCorrectness: number }[];
      pagination: { totalParticipants: number; hasMore: boolean };
    };
    expect(body.learners).toHaveLength(1);
    expect(body.pagination).toEqual(expect.objectContaining({ totalParticipants: 501, hasMore: true }));
    expect(body.questionBreakdown).toEqual([{
      questionId: "bulk-question",
      questionLabel: "Bulk question",
      answered: 501,
      correct: 250,
      knownCorrectness: 501,
    }]);
  });

  it("resolves activity summaries by slug", async () => {
    const res = await apiGet("/api/activity?slug=api-quiz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { activity: { iri: string }; stats: { starts: number } };
    expect(body.activity.iri).toBe(IRI);
    expect(body.stats.starts).toBe(2);
  });

  it("returns a markdown activity report for a read key", async () => {
    const res = await apiGet(`/api/activity.md?iri=${encodeURIComponent(IRI)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("# Proof activity report");
    expect(body).toContain("Activity: Fractions check");
    expect(body).toContain("completed (");
    expect(body).toMatch(/\| Participants \| 2 \| 100% \| −1 ← biggest drop-off \|/);
    expect(body).toContain("| Learner | Status | Score | Last seen |");
    expect(body).toContain("- q1: 1 answered, 100% correct");
    expect(body).toContain("*Generated by Proof (https://proof.test) at ");
  });

  it("omits synthetic funnel rows for activities without step data", async () => {
    const res = await apiGet(`/api/activity?iri=${encodeURIComponent(STEPLESS_IRI)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { funnel: unknown[]; stats: { starts: number; participants: number; completions: number } };
    expect(body.stats).toMatchObject({ starts: 1, participants: 1, completions: 1 });
    expect(body.funnel).toEqual([]);

    const md = await apiGet(`/api/activity.md?iri=${encodeURIComponent(STEPLESS_IRI)}`);
    expect(md.status).toBe(200);
    const text = await md.text();
    expect(text).not.toContain("## Funnel");
    expect(text).toContain("## Learners");
  });

  it("resolves markdown activity reports by slug", async () => {
    const res = await apiGet("/api/activity.md?slug=api-quiz");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Activity: Fractions check");
  });

  it("flags UUID account-name learners as anonymous", async () => {
    const iri = "https://proof.test/a/api-anonymous";
    const uuid = "11111111-2222-4333-8444-555555555555";
    await ingestStatements(new D1Storage(env.DB), [
      ...bridgeSession(iri, "88888888-2222-4333-8444-555555555555"),
      init(iri, uuid, "2026-07-03T14:06:00Z"),
    ]);

    const res = await apiGet(`/api/activity?iri=${encodeURIComponent(iri)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { learners: { label: string; anonymous: boolean }[] };
    expect(body.learners.find((row) => row.label === "Lea R.")?.anonymous).toBe(false);
    const anon = body.learners.find((row) => row.anonymous);
    expect(anon?.label.startsWith("Anonymous ·")).toBe(true);
  });

  it("returns JSON errors for missing and unknown activities", async () => {
    const missing = await SELF.fetch("https://proof.test/api/activity", { headers: ADMIN });
    expect(missing.status).toBe(400);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
    expect(await missing.json()).toHaveProperty("docs");

    const unknown = await apiGet("/api/activity?slug=missing-api-quiz");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toHaveProperty("docs");

    const unknownMd = await apiGet("/api/activity.md?slug=missing-api-quiz");
    expect(unknownMd.status).toBe(404);
    expect(unknownMd.headers.get("Content-Type")).toContain("application/json");
    expect(await unknownMd.json()).toHaveProperty("docs");
  });

  it("rejects ingest keys on summary routes", async () => {
    const res = await apiGet(`/api/activity?iri=${encodeURIComponent(IRI)}`, ingestAuthz);
    expect(res.status).toBe(401);
  });

  it("sets no-store on unauthorized API responses", async () => {
    const res = await SELF.fetch("https://proof.test/api/activity");
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
