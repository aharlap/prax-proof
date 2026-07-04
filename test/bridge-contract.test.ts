// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth";
import { D1Storage } from "../src/storage/d1";
import { bridgeSession } from "./fixtures/bridge-session";

const AUTH = "Basic " + btoa("bridge-key:bridge-secret");
const IRI = "https://example.org/x/fractions";
const REG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

beforeAll(async () => {
  await new D1Storage(env.DB).createKey("bridge-key", await sha256Hex("bridge-secret"), "bridge");
});

describe("block-roadmap §2.4 bridge session", () => {
  it("replays end-to-end with correct extraction", async () => {
    const res = await SELF.fetch("https://proof.test/xapi/statements", {
      method: "POST",
      headers: {
        Authorization: AUTH,
        "Content-Type": "application/json",
        "X-Experience-API-Version": "1.0.3",
      },
      body: JSON.stringify(bridgeSession(IRI, REG)),
    });
    expect(res.status).toBe(200);
    const ids = (await res.json()) as string[];
    expect(ids).toHaveLength(5);

    const s = new D1Storage(env.DB);
    const passed = await s.getStatement(ids[3]);
    expect(passed?.verb).toBe("http://adlnet.gov/expapi/verbs/passed");
    expect(passed?.success).toBe(1);
    expect(passed?.scoreScaled).toBe(0.8);
    expect(passed?.registration).toBe(REG);

    const answered = await s.getStatement(ids[2]);
    expect(answered?.activityIri).toBe(`${IRI}/q/q1`);

    const completed = await s.getStatement(ids[4]);
    expect(completed?.completion).toBe(1);
    expect(completed?.durationSec).toBe(312);

    const act = await env.DB.prepare("SELECT name FROM activities WHERE iri = ?")
      .bind(IRI).first<{ name: string }>();
    expect(act?.name).toBe("Fractions check");
  });
});
