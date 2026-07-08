// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth";
import { D1Storage } from "../src/storage/d1";
import { translateH5p } from "../src/snippet/h5p";
import type { SnippetContext } from "../src/snippet/core";
import { h5pAnswered, h5pAttemptedMain, h5pCompletedMain } from "./fixtures/real-statements";

const AUTH = "Basic " + btoa("h5p-key:snippet-secret");

beforeAll(async () => {
  await new D1Storage(env.DB).createKey("h5p-key", await sha256Hex("snippet-secret"), "h5p");
});

describe("H5P snippet bridge roundtrip", () => {
  it("translates H5P statements and lands extracted columns", async () => {
    const ctx: SnippetContext = {
      activityIri: "https://proof.test/a/h5p-quiz",
      activityName: "h5p-quiz",
      actor: { account: { homePage: "https://proof.test", name: "h5p-device-1" }, name: "Hana P." },
      registration: crypto.randomUUID(),
      page: "https://proof.test/h5p-host",
    };
    const batch = [h5pAttemptedMain, h5pAnswered, h5pCompletedMain].map((stmt) => {
      const translated = translateH5p(stmt, ctx);
      expect(translated).not.toBeNull();
      return translated!;
    });

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
    expect(ids).toHaveLength(3);

    const s = new D1Storage(env.DB);
    const initialized = await s.getStatement(ids[0]);
    expect(initialized?.activityIri).toBe(ctx.activityIri);
    expect(initialized?.registration).toBe(ctx.registration);

    const answered = await s.getStatement(ids[1]);
    expect(answered?.activityIri).toBe(`${ctx.activityIri}/q/abc-123`);
    expect(answered?.response).toBe("1");
    expect(answered?.success).toBe(1);

    const completed = await s.getStatement(ids[2]);
    expect(completed?.completion).toBe(1);
    expect(completed?.scoreScaled).toBe(0.8);

    const activity = await env.DB
      .prepare("SELECT page_url, name FROM activities WHERE iri = ?")
      .bind(ctx.activityIri)
      .first<{ page_url: string; name: string }>();
    expect(activity?.page_url).toBe("https://proof.test/h5p-host");
    expect(activity?.name).toBe("Fractions check");
  });
});
