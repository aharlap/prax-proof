// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth";
import { D1Storage } from "../src/storage/d1";
import {
  buildAnswer, buildFinish, buildStart, buildStep,
  type SnippetContext,
} from "../src/snippet/core";

const AUTH = "Basic " + btoa("snippet-key:snippet-secret");
const ctx: SnippetContext = {
  activityIri: "https://proof.test/a/roundtrip-quiz",
  activityName: "roundtrip-quiz",
  actor: { account: { homePage: "https://proof.test", name: "device-rt-1" }, name: "Rita T." },
  registration: "99999999-9999-4999-8999-999999999999",
};

beforeAll(async () => {
  await new D1Storage(env.DB).createKey("snippet-key", await sha256Hex("snippet-secret"), "snippet");
});

describe("snippet → server roundtrip", () => {
  it("full attempt lands with correct extraction", async () => {
    const batch = [
      buildStart(ctx),
      buildStep(ctx, "section-2"),
      buildAnswer(ctx, "q1", { response: "B", correct: true }),
      buildFinish(ctx, { score: 8, max: 10 }),
    ];
    const res = await SELF.fetch("https://proof.test/xapi/statements", {
      method: "POST",
      headers: {
        Authorization: AUTH,
        "Content-Type": "application/json",
        "X-Experience-API-Version": "1.0.3",
      },
      body: JSON.stringify(batch),
    });
    expect(res.status).toBe(200);
    const ids = (await res.json()) as string[];
    expect(ids).toHaveLength(4);

    const s = new D1Storage(env.DB);
    const start = await s.getStatement(ids[0]);
    expect(start?.verb).toBe("http://adlnet.gov/expapi/verbs/initialized");
    expect(start?.registration).toBe(ctx.registration);
    expect(start?.activityIri).toBe(ctx.activityIri);

    const step = await s.getStatement(ids[1]);
    expect(step?.verb).toBe("http://adlnet.gov/expapi/verbs/progressed");
    expect(step?.activityIri).toBe(`${ctx.activityIri}/steps/section-2`);

    const answer = await s.getStatement(ids[2]);
    expect(answer?.activityIri).toBe(`${ctx.activityIri}/q/q1`);
    expect(answer?.success).toBe(1);

    const finish = await s.getStatement(ids[3]);
    expect(finish?.completion).toBe(1);
    expect(finish?.scoreScaled).toBe(0.8);

    const learner = await env.DB
      .prepare("SELECT display_name FROM learners WHERE identity = ?")
      .bind("https://proof.test|device-rt-1")
      .first<{ display_name: string }>();
    expect(learner?.display_name).toBe("Rita T.");
  });
});
