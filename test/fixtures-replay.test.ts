// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth";
import { D1Storage } from "../src/storage/d1";
import { allFixtures, h5pAnswered, praxCompleted } from "./fixtures/real-statements";

const AUTH = "Basic " + btoa("fixture-key:fixture-secret");

beforeAll(async () => {
  await new D1Storage(env.DB).createKey("fixture-key", await sha256Hex("fixture-secret"), "fixtures", "ingest", {
    identityMode: "named",
  });
});

describe("real-world fixture replay", () => {
  it("accepts the full fixture batch end-to-end", async () => {
    const res = await SELF.fetch("https://proof.test/xapi/statements", {
      method: "POST",
      headers: {
        Authorization: AUTH,
        "X-Experience-API-Version": "1.0.3",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(allFixtures),
    });
    expect(res.status).toBe(200);
    const ids = (await res.json()) as string[];
    expect(ids).toHaveLength(allFixtures.length);

    const s = new D1Storage(env.DB);
    // H5P: score + duration extracted
    const h5p = await s.getStatement(ids[0]);
    expect(h5p?.scoreScaled).toBe(1);
    expect(h5p?.durationSec).toBeCloseTo(6.33);
    expect(h5p?.verb).toBe(h5pAnswered.verb.id);
    // Prax: activity registered with name, resume extension preserved in raw
    const prax = await s.getStatement(ids[3]);
    expect(prax?.activityIri).toBe(praxCompleted.object.id);
    expect(JSON.parse(prax!.raw).result.extensions["https://praxity.io/xapi/ext/resume-state"]).toEqual({ slide: 4 });
    const act = await env.DB
      .prepare("SELECT name FROM activities WHERE iri = ?")
      .bind(praxCompleted.object.id)
      .first<{ name: string }>();
    expect(act?.name).toBe("Compare demo");
  });
});
