// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { mintKey, sha256Hex } from "../src/auth";
import { D1Storage } from "../src/storage/d1";
import type { Storage } from "../src/storage/types";
import { ingestStatements } from "../src/xapi/ingest";

const V = "http://adlnet.gov/expapi/verbs/";

function statement(id: string, iri: string, learner = "learner-a") {
  return {
    id,
    actor: {
      mbox: `${"mailto:"}${learner}@example.org`,
      name: "Learner Name",
    },
    verb: { id: `${V}initialized` },
    object: { id: iri, definition: { name: { en: "Scoped activity" } } },
    timestamp: "2026-07-09T12:00:00Z",
  };
}

function request(
  key: { id: string; secret: string },
  body: unknown,
  origin?: string,
  extraHeaders: Record<string, string> = {},
) {
  return SELF.fetch("https://proof.test/xapi/statements", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${key.id}:${key.secret}`)}`,
      "Content-Type": "application/json",
      "X-Experience-API-Version": "1.0.3",
      ...(origin ? { Origin: origin } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe("atomic and idempotent ingestion", () => {
  it("accepts an exact replay without creating duplicate side effects", async () => {
    const storage = new D1Storage(env.DB);
    const iri = `https://example.org/a/${crypto.randomUUID()}`;
    const input = statement(crypto.randomUUID(), iri);

    const first = await ingestStatements(storage, input);
    const replay = await ingestStatements(storage, input);
    expect(first).toMatchObject({ ok: true, inserted: 1 });
    expect(replay).toMatchObject({ ok: true, inserted: 0 });

    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM statements WHERE id = ?) AS statements, " +
      "(SELECT COUNT(*) FROM activities WHERE iri = ?) AS activities",
    ).bind(input.id, iri).first<{ statements: number; activities: number }>();
    expect(counts).toEqual({ statements: 1, activities: 1 });
  });

  it("ignores a client-supplied stored field for exact replay comparison", async () => {
    const storage = new D1Storage(env.DB);
    const input = {
      ...statement(crypto.randomUUID(), `https://example.org/a/${crypto.randomUUID()}`),
      stored: "2001-01-01T00:00:00Z",
    };
    const serverTime = new Date("2026-07-09T16:00:00Z");

    expect(await ingestStatements(storage, input, serverTime)).toMatchObject({ ok: true, inserted: 1 });
    expect(await ingestStatements(storage, input, new Date("2026-07-09T17:00:00Z"))).toMatchObject({
      ok: true,
      inserted: 0,
    });
    const stored = JSON.parse((await storage.getStatement(input.id))!.raw) as { stored: string };
    expect(stored.stored).toBe(serverTime.toISOString());
  });

  it("accepts an exact replay of a pre-upgrade statement after an anonymous key is introduced", async () => {
    const storage = new D1Storage(env.DB);
    const id = crypto.randomUUID();
    const iri = `https://example.org/a/${crypto.randomUUID()}`;
    const input = statement(id, iri, "legacy-person");
    await env.DB.prepare(
      `INSERT INTO statements
         (id, raw, verb, activity_iri, timestamp, stored, key_id, canonical_hash)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).bind(
      id,
      JSON.stringify({ ...input, stored: "2026-07-09T12:00:01Z" }),
      input.verb.id,
      iri,
      input.timestamp,
      "2026-07-09T12:00:01Z",
    ).run();
    const key = await mintKey(env.DB, "upgraded anonymous key", "ingest", {
      activityScope: iri,
      identityMode: "anonymous",
    });

    expect(await ingestStatements(storage, input, new Date(), {
      keyId: key.id,
      activityScope: iri,
      identityMode: "anonymous",
    })).toMatchObject({ ok: true, inserted: 0 });
  });

  it("accepts an exact replay written by the previous shallow anonymizer", async () => {
    const storage = new D1Storage(env.DB);
    const id = crypto.randomUUID();
    const iri = `https://example.org/a/${crypto.randomUUID()}`;
    const key = await mintKey(env.DB, "previous anonymous key", "ingest", {
      activityScope: iri,
      identityMode: "anonymous",
    });
    const input = {
      ...statement(id, iri, "shallow-person"),
      authority: { mbox: "mailto:old-authority@example.org" },
    };
    const pseudonym = `anonymous:${await sha256Hex(`${key.id}\0${input.actor.mbox}`)}`;
    const shallowRaw = {
      ...input,
      actor: {
        objectType: "Agent",
        account: { homePage: "https://praxity.io/proof/anonymous", name: pseudonym.slice(10) },
      },
      stored: "2026-07-09T12:00:01Z",
    };
    await env.DB.prepare(
      `INSERT INTO statements
         (id, raw, verb, activity_iri, timestamp, stored, key_id, canonical_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      id,
      JSON.stringify(shallowRaw),
      input.verb.id,
      iri,
      input.timestamp,
      shallowRaw.stored,
      key.id,
    ).run();

    expect(await ingestStatements(storage, input, new Date(), {
      keyId: key.id,
      activityScope: iri,
      identityMode: "anonymous",
    })).toMatchObject({ ok: true, inserted: 0 });
  });

  it("rejects a conflicting id without creating ghost activities or learners", async () => {
    const storage = new D1Storage(env.DB);
    const id = crypto.randomUUID();
    const existingIri = `https://example.org/a/${crypto.randomUUID()}`;
    const ghostIri = `https://example.org/a/${crypto.randomUUID()}`;
    await ingestStatements(storage, statement(id, existingIri, "conflict-original"));

    const result = await ingestStatements(storage, [
      statement(crypto.randomUUID(), ghostIri, "would-be-new"),
      statement(id, ghostIri, "conflict-new"),
    ]);
    expect(result).toMatchObject({ ok: false, status: 409 });

    const ghost = await env.DB.prepare("SELECT iri FROM activities WHERE iri = ?").bind(ghostIri).first();
    const newLearner = await env.DB.prepare("SELECT id FROM learners WHERE identity LIKE ?")
      .bind("%would-be-new%")
      .first();
    expect(ghost).toBeNull();
    expect(newLearner).toBeNull();
  });
});

describe("response hardening", () => {
  it("sets HSTS globally and no-store on authenticated API surfaces", async () => {
    const root = await SELF.fetch("https://proof.test/");
    expect(root.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");

    const xapi = await SELF.fetch("https://proof.test/xapi/about");
    expect(xapi.headers.get("Cache-Control")).toBe("no-store");
    const api = await SELF.fetch("https://proof.test/api/activities");
    expect(api.headers.get("Cache-Control")).toBe("no-store");
    const admin = await SELF.fetch("https://proof.test/admin/learners/missing");
    expect(admin.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("key policy enforcement", () => {
  it("enforces origin, scope, quota, anonymization, and revocation", async () => {
    const scope = `https://proof.test/a/${crypto.randomUUID()}`;
    const key = await mintKey(env.DB, "hardening key", "ingest", {
      activityScope: scope,
      allowedOrigin: "https://learn.example",
      dailyLimit: 1,
      identityMode: "anonymous",
    });
    const acceptedId = crypto.randomUUID();
    const accepted = await request(key, statement(acceptedId, scope), "https://learn.example");
    expect(accepted.status).toBe(200);

    const stored = await new D1Storage(env.DB).getStatement(acceptedId);
    expect(stored?.keyId).toBe(key.id);
    expect(stored?.raw).not.toContain("learner-a@example.org");
    expect(stored?.raw).not.toContain("Learner Name");
    const learner = await env.DB.prepare("SELECT identity, display_name FROM learners WHERE id = ?")
      .bind(stored?.learnerId)
      .first<{ identity: string; display_name: string | null }>();
    expect(learner?.identity).toMatch(/^anonymous:[0-9a-f]{64}$/);
    expect(learner?.display_name).toBeNull();

    const wrongOrigin = await request(
      key,
      statement(crypto.randomUUID(), scope),
      "https://other.example",
    );
    expect(wrongOrigin.status).toBe(403);

    const wrongScope = await request(
      key,
      statement(crypto.randomUUID(), `${scope}-lookalike`),
      "https://learn.example",
    );
    expect(wrongScope.status).toBe(403);

    const learnersBeforeQuotaFailure = await env.DB.prepare("SELECT COUNT(*) AS count FROM learners")
      .first<{ count: number }>();
    const overQuota = await request(
      key,
      statement(crypto.randomUUID(), `${scope}/steps/quota-ghost`, "quota-ghost"),
      "https://learn.example",
    );
    expect(overQuota.status).toBe(429);
    const quotaState = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM statements WHERE activity_iri = ?) AS statements,
         (SELECT COUNT(*) FROM activities WHERE iri = ?) AS activities,
         (SELECT COUNT(*) FROM learners) AS learners,
         (SELECT statement_count FROM ingest_usage WHERE key_id = ?) AS usage`,
    ).bind(`${scope}/steps/quota-ghost`, `${scope}/steps/quota-ghost`, key.id)
      .first<{ statements: number; activities: number; learners: number; usage: number }>();
    expect(quotaState).toMatchObject({ statements: 0, activities: 0, usage: 1 });
    expect(quotaState?.learners).toBe(learnersBeforeQuotaFailure?.count);

    expect(await new D1Storage(env.DB).revokeKey(key.id)).toBe(true);
    const revoked = await request(
      key,
      statement(crypto.randomUUID(), scope),
      "https://learn.example",
    );
    expect(revoked.status).toBe(401);
  });

  it("removes nested identity-bearing fields in anonymous mode", async () => {
    const scope = `https://proof.test/a/${crypto.randomUUID()}`;
    const key = await mintKey(env.DB, "deep privacy", "ingest", {
      activityScope: scope,
      identityMode: "anonymous",
    });
    const id = crypto.randomUUID();
    const pii = "private-person@example.org";
    const accepted = await request(key, {
      ...statement(id, scope),
      authority: { mbox: `mailto:${pii}`, name: "Private authority" },
      context: {
        instructor: { mbox: `mailto:${pii}`, name: "Private instructor" },
        team: { name: "Private team", member: [{ mbox: `mailto:${pii}` }] },
        extensions: {
          "https://praxity.io/xapi/ext/page": `https://learn.example/course?email=${pii}`,
          "https://example.org/private": { email: pii },
        },
      },
      result: { extensions: { "https://example.org/private": { email: pii } } },
      attachments: [{ display: { en: pii }, contentType: "text/plain", length: 1, sha2: "0".repeat(64) }],
      privateMetadata: { email: pii },
    });
    expect(accepted.status).toBe(200);

    const raw = (await new D1Storage(env.DB).getStatement(id))!.raw;
    expect(raw).not.toContain(pii);
    expect(raw).not.toContain("authority");
    expect(raw).not.toContain("instructor");
    expect(raw).not.toContain("attachments");
    expect(raw).not.toContain("privateMetadata");
    const activity = await env.DB.prepare("SELECT page_url FROM activities WHERE iri = ?")
      .bind(scope)
      .first<{ page_url: string | null }>();
    expect(activity?.page_url).toBeNull();
  });

  it("keeps the strictest identity policy for an activity across keys", async () => {
    const scope = `https://proof.test/a/${crypto.randomUUID()}`;
    const named = await mintKey(env.DB, "named first", "ingest", {
      activityScope: scope,
      identityMode: "named",
    });
    const namedId = crypto.randomUUID();
    expect((await request(named, statement(namedId, scope, "named-before"))).status).toBe(200);
    expect((await new D1Storage(env.DB).getStatement(namedId))!.raw).toContain("named-before@example.org");

    await mintKey(env.DB, "anonymous policy", "ingest", {
      activityScope: scope,
      identityMode: "anonymous",
    });
    const afterId = crypto.randomUUID();
    expect((await request(named, statement(afterId, scope, "named-after"))).status).toBe(200);
    const after = (await new D1Storage(env.DB).getStatement(afterId))!.raw;
    expect(after).not.toContain("named-after@example.org");
    expect(after).not.toContain("Learner Name");

    await mintKey(env.DB, "later named key", "ingest", {
      activityScope: scope,
      identityMode: "named",
    });
    const modes = await env.DB.prepare(
      `SELECT
         (SELECT identity_mode FROM activity_policies WHERE activity_iri = ?) AS policy_mode,
         (SELECT identity_mode FROM activities WHERE iri = ?) AS activity_mode`,
    ).bind(scope, scope).first<{ policy_mode: string; activity_mode: string }>();
    expect(modes).toEqual({ policy_mode: "anonymous", activity_mode: "anonymous" });
  });

  it("rebuilds a stale named write when the database policy is already anonymous", async () => {
    const scope = `https://proof.test/a/${crypto.randomUUID()}`;
    await mintKey(env.DB, "anonymous policy owner", "ingest", {
      activityScope: scope,
      identityMode: "anonymous",
    });
    const named = await mintKey(env.DB, "stale named writer", "ingest", {
      activityScope: scope,
      identityMode: "named",
    });
    const storage = new D1Storage(env.DB);
    let policyReads = 0;
    const staleOnce = new Proxy(storage, {
      get(target, property) {
        if (property === "activityIdentityModes") {
          return async (iris: string[]) => {
            policyReads += 1;
            return policyReads === 1 ? new Map<string, string>() : target.activityIdentityModes(iris);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Storage;
    const id = crypto.randomUUID();

    const result = await ingestStatements(staleOnce, statement(id, scope, "stale-private"), new Date(), {
      keyId: named.id,
      activityScope: scope,
      identityMode: "named",
    });
    expect(result).toMatchObject({ ok: true, inserted: 1 });
    expect(policyReads).toBe(2);
    const raw = (await storage.getStatement(id))!.raw;
    expect(raw).not.toContain("stale-private@example.org");
    expect(raw).not.toContain("Learner Name");
  });

  it("requires the consent declaration header when consent mode is configured", async () => {
    const storage = new D1Storage(env.DB);
    const current = await storage.getSettings();
    await storage.updateSettings({ ...current, trackingMode: "consent" });
    const scope = `https://proof.test/a/${crypto.randomUUID()}`;
    const key = await mintKey(env.DB, "consent key", "ingest", { activityScope: scope });
    const input = statement(crypto.randomUUID(), scope);

    try {
      expect((await request(key, input)).status).toBe(403);
      expect((await request(key, input, undefined, { "X-Proof-Consent": "granted" })).status).toBe(200);
    } finally {
      await storage.updateSettings({ ...current, trackingMode: "notice" });
    }
  });

  it("rejects oversized batches and request bodies", async () => {
    const scope = `https://proof.test/a/${crypto.randomUUID()}`;
    const key = await mintKey(env.DB, "limits key", "ingest", { activityScope: scope });
    const batch = Array.from({ length: 11 }, () => statement(crypto.randomUUID(), scope));
    expect((await request(key, batch)).status).toBe(400);

    const oversized = statement(crypto.randomUUID(), scope) as ReturnType<typeof statement> & {
      result: { response: string };
    };
    oversized.result = { response: "x".repeat(260 * 1024) };
    expect((await request(key, oversized)).status).toBe(413);
  });

  it("stops an oversized chunked body without relying on Content-Length", async () => {
    const scope = `https://proof.test/a/${crypto.randomUUID()}`;
    const key = await mintKey(env.DB, "chunked limits key", "ingest", { activityScope: scope });
    const chunk = new TextEncoder().encode("x".repeat(70 * 1024));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const response = await SELF.fetch(new Request("https://proof.test/xapi/statements", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${key.id}:${key.secret}`)}`,
        "Content-Type": "application/json",
        "X-Experience-API-Version": "1.0.3",
      },
      body,
    }));
    expect(response.status).toBe(413);
  });

  it("requires and normalizes opaque identities for token-mode keys", async () => {
    const scope = `https://proof.test/a/${crypto.randomUUID()}`;
    const key = await mintKey(env.DB, "token key", "ingest", {
      activityScope: scope,
      identityMode: "token",
    });
    expect((await request(key, statement(crypto.randomUUID(), scope))).status).toBe(400);

    const id = crypto.randomUUID();
    const accepted = await request(key, {
      id,
      actor: {
        account: { homePage: "https://untrusted.example/private/path", name: "token_92c4b6817f3a" },
        name: "Should not persist",
      },
      verb: { id: `${V}initialized` },
      object: { id: scope },
    });
    expect(accepted.status).toBe(200);
    const stored = await new D1Storage(env.DB).getStatement(id);
    expect(stored?.raw).toContain("https://praxity.io/proof/token");
    expect(stored?.raw).not.toContain("untrusted.example");
    expect(stored?.raw).not.toContain("Should not persist");
  });

  it("limits scoped read keys to their configured activity", async () => {
    const storage = new D1Storage(env.DB);
    const allowed = `https://proof.test/a/${crypto.randomUUID()}`;
    const denied = `https://proof.test/a/${crypto.randomUUID()}`;
    await ingestStatements(storage, [
      statement(crypto.randomUUID(), allowed, "read-allowed"),
      statement(crypto.randomUUID(), denied, "read-denied"),
    ]);
    const key = await mintKey(env.DB, "scoped reader", "read", { activityScope: allowed });
    const headers = { Authorization: `Bearer ${key.id}:${key.secret}` };

    const list = await SELF.fetch("https://proof.test/api/activities", { headers });
    const activities = (await list.json()) as { iri: string }[];
    expect(activities.map((activity) => activity.iri)).toEqual([allowed]);
    const other = await SELF.fetch(
      `https://proof.test/api/activity?iri=${encodeURIComponent(denied)}`,
      { headers },
    );
    expect(other.status).toBe(403);
  });

  it("does not double-charge concurrent exact replays", async () => {
    const scope = `https://proof.test/a/${crypto.randomUUID()}`;
    const key = await mintKey(env.DB, "concurrent replay", "ingest", {
      activityScope: scope,
      dailyLimit: 1,
    });
    const input = statement(crypto.randomUUID(), scope, "concurrent");
    const responses = await Promise.all([request(key, input), request(key, input)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const usage = await env.DB.prepare(
      "SELECT statement_count FROM ingest_usage WHERE key_id = ?",
    ).bind(key.id).first<{ statement_count: number }>();
    expect(usage?.statement_count).toBe(1);
  });

  it("handles the maximum-size exact-replay precheck without double charging", async () => {
    const scope = `https://proof.test/a/${crypto.randomUUID()}`;
    const key = await mintKey(env.DB, "ten statement replay", "ingest", {
      activityScope: scope,
      dailyLimit: 10,
    });
    const batch = Array.from({ length: 10 }, (_, index) =>
      statement(crypto.randomUUID(), scope, `batch-${index}`));

    expect((await request(key, batch)).status).toBe(200);
    expect((await request(key, batch)).status).toBe(200);
    const usage = await env.DB.prepare(
      "SELECT statement_count FROM ingest_usage WHERE key_id = ?",
    ).bind(key.id).first<{ statement_count: number }>();
    expect(usage?.statement_count).toBe(10);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM statements WHERE key_id = ?",
    ).bind(key.id).first<{ count: number }>();
    expect(count?.count).toBe(10);
  });
});

describe("participant reporting", () => {
  it("keeps completion at or below 100% and averages each participant's latest score", async () => {
    const storage = new D1Storage(env.DB);
    const iri = `https://example.org/a/${crypto.randomUUID()}`;
    const actor = (name: string) => ({ account: { homePage: "https://proof.test", name } });
    await ingestStatements(storage, [
      { actor: actor("one"), verb: { id: `${V}initialized` }, object: { id: iri } },
      { actor: actor("two"), verb: { id: `${V}initialized` }, object: { id: iri } },
      { actor: actor("one"), verb: { id: `${V}scored` }, object: { id: iri }, result: { score: { scaled: 0.2 } }, timestamp: "2026-07-09T12:01:00Z" },
      { actor: actor("one"), verb: { id: `${V}scored` }, object: { id: iri }, result: { score: { scaled: 0.8 } }, timestamp: "2026-07-09T12:02:00Z" },
      { actor: actor("two"), verb: { id: `${V}scored` }, object: { id: iri }, result: { score: { scaled: 0.4 } }, timestamp: "2026-07-09T12:03:00Z" },
      { actor: actor("one"), verb: { id: `${V}completed` }, object: { id: iri }, result: { completion: true } },
      { actor: actor("two"), verb: { id: `${V}completed` }, object: { id: iri }, result: { completion: true } },
      { actor: actor("completion-only"), verb: { id: `${V}completed` }, object: { id: iri }, result: { completion: true } },
    ]);

    const stats = await storage.getActivityStats(iri);
    expect(stats).toMatchObject({ starts: 2, participants: 3, completions: 3 });
    expect(stats.completions / stats.participants).toBe(1);
    expect(stats.avgScoreScaled).toBeCloseTo(0.6);
  });
});
