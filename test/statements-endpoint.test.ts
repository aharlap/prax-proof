// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth";
import { D1Storage } from "../src/storage/d1";

const AUTH = "Basic " + btoa("test-key:test-secret");
const VERSION = { "X-Experience-API-Version": "1.0.3" };
const stmt = (over: Record<string, unknown> = {}) => ({
  actor: { mbox: "mailto:cleo@example.org", name: "Cléo D." },
  verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
  object: { id: "https://example.org/act/quiz/q1" },
  ...over,
});

const post = (body: unknown, headers: Record<string, string> = { Authorization: AUTH, ...VERSION }) =>
  SELF.fetch("https://proof.test/xapi/statements", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await new D1Storage(env.DB).createKey("test-key", await sha256Hex("test-secret"), "test");
});

describe("POST /xapi/statements", () => {
  it("stores statements and returns ids in order", async () => {
    const res = await post([stmt(), stmt()]);
    expect(res.status).toBe(200);
    const ids = (await res.json()) as string[];
    expect(ids).toHaveLength(2);
    expect(await new D1Storage(env.DB).getStatement(ids[0])).not.toBeNull();
  });

  it("requires the version header", async () => {
    const res = await post(stmt(), { Authorization: AUTH });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/X-Experience-API-Version/);
  });

  it("rejects a bad version value", async () => {
    const res = await post(stmt(), { Authorization: AUTH, "X-Experience-API-Version": "0.9" });
    expect(res.status).toBe(400);
    const prefixOnly = await post(stmt(), {
      Authorization: AUTH,
      "X-Experience-API-Version": "1.0-not-a-version",
    });
    expect(prefixOnly.status).toBe(400);
  });

  it("rejects invalid statements with a readable reason and docs link", async () => {
    const res = await post({ hello: "world" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; docs: string };
    expect(body.error).toMatch(/statement/i);
    expect(body.docs).toContain("github.com/Praxity/prax-proof");
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await SELF.fetch("https://proof.test/xapi/statements", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: AUTH, ...VERSION },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("requires auth", async () => {
    const res = await post(stmt(), { ...VERSION });
    expect(res.status).toBe(401);
  });
});

describe("PUT /xapi/statements", () => {
  const put = (id: string | null, body: unknown) =>
    SELF.fetch(
      `https://proof.test/xapi/statements${id ? `?statementId=${id}` : ""}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: AUTH, ...VERSION },
        body: JSON.stringify(body),
      },
    );

  it("stores a single statement under the given id and returns 204", async () => {
    const id = "77777777-7777-4777-8777-777777777777";
    const res = await put(id, stmt());
    expect(res.status).toBe(204);
    expect(await new D1Storage(env.DB).getStatement(id)).not.toBeNull();
  });

  it("is idempotent: repeating the PUT returns 204 and keeps one row", async () => {
    const id = "88888888-8888-4888-8888-888888888888";
    await put(id, stmt());
    const res = await put(id, stmt());
    expect(res.status).toBe(204);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM statements WHERE id = ?")
      .bind(id).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("400s without statementId, on body/query id mismatch, and on array bodies", async () => {
    expect((await put(null, stmt())).status).toBe(400);
    expect(
      (await put("99999999-9999-4999-8999-999999999999", stmt({ id: "77777777-7777-4777-8777-777777777777" }))).status,
    ).toBe(400);
    expect((await put("99999999-9999-4999-8999-999999999999", [stmt()])).status).toBe(400);
  });
});
