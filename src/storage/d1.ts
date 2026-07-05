// SPDX-License-Identifier: MIT
import type { ActivityStats, ActivitySummary, DayCount, FunnelStep, KeyRecord, RosterRow, StatementRow, Storage } from "./types";

export function likePrefix(iri: string): string {
  return iri.replace(/[\\%_]/g, (ch) => `\\${ch}`) + "/%";
}

export class D1Storage implements Storage {
  constructor(private db: D1Database) {}

  private static readonly CHILD_FILTER =
    "iri NOT LIKE '%/q/%' AND iri NOT LIKE '%/questions/%' AND iri NOT LIKE '%/steps/%'";

  async createKey(id: string, secretHash: string, label: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO keys (id, secret_hash, label) VALUES (?, ?, ?)")
      .bind(id, secretHash, label)
      .run();
  }

  async findKey(id: string): Promise<KeyRecord | null> {
    const r = await this.db
      .prepare("SELECT id, secret_hash, label FROM keys WHERE id = ?")
      .bind(id)
      .first<{ id: string; secret_hash: string; label: string }>();
    return r ? { id: r.id, secretHash: r.secret_hash, label: r.label } : null;
  }

  async upsertActivity(iri: string, name: string | null): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO activities (iri, name) VALUES (?, ?)
         ON CONFLICT(iri) DO UPDATE SET name = COALESCE(excluded.name, activities.name)`,
      )
      .bind(iri, name)
      .run();
  }

  async upsertLearner(identity: string, displayName: string | null): Promise<string> {
    const r = await this.db
      .prepare(
        `INSERT INTO learners (id, identity, display_name) VALUES (?, ?, ?)
         ON CONFLICT(identity) DO UPDATE SET
           display_name = COALESCE(excluded.display_name, learners.display_name)
         RETURNING id`,
      )
      .bind(crypto.randomUUID(), identity, displayName)
      .first<{ id: string }>();
    // RETURNING always yields the surviving row's id (inserted or pre-existing).
    return r!.id;
  }

  async insertStatements(rows: StatementRow[]): Promise<string[]> {
    if (rows.length === 0) return [];
    const stmt = this.db.prepare(
      `INSERT INTO statements
         (id, raw, verb, activity_iri, learner_id,
          score_raw, score_min, score_max, score_scaled,
          success, completion, duration_sec, timestamp, stored, registration,
          step, response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    const results = await this.db.batch(
      rows.map((s) =>
        stmt.bind(
          s.id, s.raw, s.verb, s.activityIri, s.learnerId,
          s.scoreRaw, s.scoreMin, s.scoreMax, s.scoreScaled,
          s.success, s.completion, s.durationSec, s.timestamp, s.stored, s.registration,
          s.step, s.response,
        ),
      ),
    );
    return rows.filter((_, i) => results[i].meta.changes > 0).map((s) => s.id);
  }

  async getStatement(id: string): Promise<StatementRow | null> {
    const r = await this.db
      .prepare(
        `SELECT id, raw, verb, activity_iri, learner_id,
                score_raw, score_min, score_max, score_scaled,
                success, completion, duration_sec, timestamp, stored, registration,
                step, response
         FROM statements WHERE id = ?`,
      )
      .bind(id)
      .first<Record<string, unknown>>();
    if (!r) return null;
    return {
      id: r.id as string,
      raw: r.raw as string,
      verb: r.verb as string,
      activityIri: r.activity_iri as string | null,
      learnerId: r.learner_id as string | null,
      scoreRaw: r.score_raw as number | null,
      scoreMin: r.score_min as number | null,
      scoreMax: r.score_max as number | null,
      scoreScaled: r.score_scaled as number | null,
      success: r.success as number | null,
      completion: r.completion as number | null,
      durationSec: r.duration_sec as number | null,
      timestamp: r.timestamp as string,
      stored: r.stored as string,
      registration: r.registration as string | null,
      step: r.step as string | null,
      response: r.response as string | null,
    };
  }

  async listActivities(): Promise<ActivitySummary[]> {
    const V = "http://adlnet.gov/expapi/verbs/initialized";
    const { results } = await this.db
      .prepare(
        `SELECT a.iri, a.name, a.first_seen,
           (SELECT COUNT(*) FROM statements s WHERE s.activity_iri = a.iri AND s.verb = ?1) AS attempts,
           (SELECT COUNT(DISTINCT s.learner_id) FROM statements s WHERE s.activity_iri = a.iri AND s.completion = 1) AS completions,
           (SELECT MAX(s.timestamp) FROM statements s WHERE s.activity_iri = a.iri) AS last_activity
         FROM activities a
         WHERE ${D1Storage.CHILD_FILTER}
         ORDER BY last_activity IS NULL, last_activity DESC`,
      )
      .bind(V)
      .all<Record<string, unknown>>();
    return results.map((r) => ({
      iri: r.iri as string,
      name: r.name as string | null,
      firstSeen: r.first_seen as string,
      attempts: r.attempts as number,
      completions: r.completions as number,
      lastActivity: r.last_activity as string | null,
    }));
  }

  async getActivity(iri: string) {
    const r = await this.db
      .prepare("SELECT iri, name, first_seen FROM activities WHERE iri = ?")
      .bind(iri)
      .first<{ iri: string; name: string | null; first_seen: string }>();
    return r ? { iri: r.iri, name: r.name, firstSeen: r.first_seen } : null;
  }

  async getActivityStats(iri: string): Promise<ActivityStats> {
    const V = "http://adlnet.gov/expapi/verbs/initialized";
    const head = await this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM statements WHERE activity_iri = ?1 AND verb = ?2) AS attempts,
           (SELECT COUNT(DISTINCT learner_id) FROM statements WHERE activity_iri = ?1 AND completion = 1) AS completions,
           (SELECT AVG(score_scaled) FROM statements WHERE activity_iri = ?1 AND score_scaled IS NOT NULL) AS avg_scaled`,
      )
      .bind(iri, V)
      .first<{ attempts: number; completions: number; avg_scaled: number | null }>();
    const { results } = await this.db
      .prepare(
        "SELECT duration_sec FROM statements WHERE activity_iri = ?1 AND duration_sec IS NOT NULL ORDER BY duration_sec",
      )
      .bind(iri)
      .all<{ duration_sec: number }>();
    return {
      attempts: head?.attempts ?? 0,
      completions: head?.completions ?? 0,
      avgScoreScaled: head?.avg_scaled ?? null,
      durationsSec: results.map((r) => r.duration_sec),
    };
  }

  async listRoster(iri: string): Promise<RosterRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT l.id, COALESCE(l.display_name, l.identity) AS label,
           MAX(CASE WHEN s.completion = 1 AND s.activity_iri = ?1 THEN 1 ELSE 0 END) AS completed,
           MAX(CASE WHEN s.activity_iri = ?1 THEN s.score_raw END) AS score_raw,
           MAX(CASE WHEN s.activity_iri = ?1 THEN s.score_max END) AS score_max,
           MAX(s.timestamp) AS last_seen
         FROM statements s JOIN learners l ON l.id = s.learner_id
         WHERE s.activity_iri = ?1 OR s.activity_iri LIKE ?2 ESCAPE '\\'
         GROUP BY l.id, label
         ORDER BY last_seen DESC`,
      )
      .bind(iri, likePrefix(iri))
      .all<Record<string, unknown>>();
    return results.map((r) => ({
      learnerId: r.id as string,
      label: r.label as string,
      completed: (r.completed as number) === 1,
      scoreRaw: r.score_raw as number | null,
      scoreMax: r.score_max as number | null,
      lastSeen: r.last_seen as string,
    }));
  }

  async attemptsPerDay(iri: string, days: number): Promise<DayCount[]> {
    const V = "http://adlnet.gov/expapi/verbs/initialized";
    const { results } = await this.db
      .prepare(
        `SELECT substr(timestamp, 1, 10) AS day, COUNT(*) AS count
         FROM statements
         WHERE activity_iri = ?1 AND verb = ?2 AND timestamp >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?3)
         GROUP BY day ORDER BY day`,
      )
      .bind(iri, V, `-${Math.max(1, Math.floor(days))} days`)
      .all<{ day: string; count: number }>();
    return results.map((r) => ({ day: r.day, count: r.count }));
  }

  async stepFunnel(iri: string): Promise<FunnelStep[]> {
    const { results } = await this.db
      .prepare(
        `SELECT step, COUNT(DISTINCT learner_id) AS learners, MIN(timestamp) AS first_seen
         FROM statements
         WHERE (activity_iri = ?1 OR activity_iri LIKE ?2 ESCAPE '\\') AND step IS NOT NULL
         GROUP BY step ORDER BY first_seen`,
      )
      .bind(iri, likePrefix(iri))
      .all<{ step: string; learners: number; first_seen: string }>();
    return results.map((r) => ({ step: r.step, learners: r.learners, firstSeen: r.first_seen }));
  }

  async startedLearners(iri: string): Promise<number> {
    const r = await this.db
      .prepare(
        `SELECT COUNT(DISTINCT learner_id) AS n FROM statements
         WHERE activity_iri = ?1 AND verb = 'http://adlnet.gov/expapi/verbs/initialized'`,
      )
      .bind(iri)
      .first<{ n: number }>();
    return r?.n ?? 0;
  }
}
