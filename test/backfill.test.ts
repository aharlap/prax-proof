// SPDX-License-Identifier: MIT
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// These are the exact SQL strings from migrations/0003_backfill_step_response.sql,
// run inline to prove the backfill logic works on rows with NULL step/response.
// On fresh test DBs the migration file itself is applied automatically and is a no-op
// (all rows ingested after 0002 already have the columns populated at ingest time).

const SQL_BACKFILL_RESPONSE = `
  UPDATE statements SET response = json_extract(raw, '$.result.response')
    WHERE response IS NULL AND json_extract(raw, '$.result.response') IS NOT NULL
`.trim();

const SQL_BACKFILL_STEP_EXT = `
  UPDATE statements SET step = json_extract(raw, '$.result.extensions."https://praxity.io/xapi/ext/step"')
    WHERE step IS NULL AND json_extract(raw, '$.result.extensions."https://praxity.io/xapi/ext/step"') IS NOT NULL
`.trim();

const SQL_BACKFILL_STEP_IRI = `
  UPDATE statements SET step = substr(activity_iri, instr(activity_iri, '/steps/') + 7)
    WHERE step IS NULL AND activity_iri LIKE '%/steps/%'
`.trim();

describe("migration 0003 backfill SQL", () => {
  it("backfills response and step from raw JSON and activity_iri", async () => {
    const db = env.DB;

    // We need a learner row to satisfy FK-like constraints (learner_id).
    // Use a direct insert with a generated id.
    const learnerId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO learners (id, identity, display_name) VALUES (?, ?, ?)",
      )
      .bind(learnerId, `backfill-test-learner@example.org`, "Backfill Tester")
      .run();

    // Row 1: NULL step and NULL response, but raw carries result.response and ext/step.
    const id1 = crypto.randomUUID();
    const raw1 = JSON.stringify({
      id: id1,
      result: {
        response: "B",
        extensions: {
          "https://praxity.io/xapi/ext/step": "q:q9",
        },
      },
    });
    await db
      .prepare(
        `INSERT INTO statements
           (id, raw, verb, activity_iri, learner_id,
            score_raw, score_min, score_max, score_scaled,
            success, completion, duration_sec, timestamp, stored, registration,
            step, response)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL)`,
      )
      .bind(
        id1, raw1,
        "http://adlnet.gov/expapi/verbs/answered",
        "https://example.org/backfill-quiz",
        learnerId,
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:01Z",
      )
      .run();

    // Row 2: NULL step, activity_iri contains /steps/outro.
    const id2 = crypto.randomUUID();
    const raw2 = JSON.stringify({ id: id2 });
    await db
      .prepare(
        `INSERT INTO statements
           (id, raw, verb, activity_iri, learner_id,
            score_raw, score_min, score_max, score_scaled,
            success, completion, duration_sec, timestamp, stored, registration,
            step, response)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL)`,
      )
      .bind(
        id2, raw2,
        "http://adlnet.gov/expapi/verbs/progressed",
        "https://example.org/backfill-quiz/steps/outro",
        learnerId,
        "2026-01-01T00:01:00Z",
        "2026-01-01T00:01:01Z",
      )
      .run();

    // Run the three backfill UPDATE statements (same SQL as 0003_backfill_step_response.sql).
    await db.prepare(SQL_BACKFILL_RESPONSE).run();
    await db.prepare(SQL_BACKFILL_STEP_EXT).run();
    await db.prepare(SQL_BACKFILL_STEP_IRI).run();

    const row1 = await db
      .prepare("SELECT step, response FROM statements WHERE id = ?")
      .bind(id1)
      .first<{ step: string | null; response: string | null }>();
    const row2 = await db
      .prepare("SELECT step, response FROM statements WHERE id = ?")
      .bind(id2)
      .first<{ step: string | null; response: string | null }>();

    expect(row1?.response).toBe("B");
    expect(row1?.step).toBe("q:q9");
    expect(row2?.step).toBe("outro");
  });
});
