// SPDX-License-Identifier: MIT
import type {
  ActivityStats,
  ActivitySummary,
  AnswerRow,
  DayCount,
  ExistingStatement,
  FunnelStep,
  IngestRecord,
  InstanceSettings,
  KeyRecord,
  QuestionStat,
  RosterRow,
  StatementRow,
  Storage,
  TimelineRow,
} from "./types";

function childPrefix(iri: string): string {
  return `${iri}/`;
}

export class D1Storage implements Storage {
  constructor(private db: D1Database) {}

  private static readonly CHILD_FILTER =
    "iri NOT LIKE '%/q/%' AND iri NOT LIKE '%/questions/%' AND iri NOT LIKE '%/steps/%'";

  async createKey(
    id: string,
    secretHash: string,
    label: string,
    kind = "ingest",
    options: {
      activityScope?: string | null;
      allowedOrigin?: string | null;
      dailyLimit?: number;
      identityMode?: string;
    } = {},
  ): Promise<void> {
    const statements = [
      this.db.prepare(
        `INSERT INTO keys
           (id, secret_hash, label, kind, activity_scope, allowed_origin, daily_limit, identity_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        secretHash,
        label,
        kind,
        options.activityScope ?? null,
        options.allowedOrigin ?? null,
        options.dailyLimit ?? 10000,
        options.identityMode ?? "anonymous",
      ),
    ];
    if (kind === "ingest" && options.activityScope) {
      statements.push(
        this.db.prepare(
          `INSERT INTO activity_policies (activity_iri, identity_mode) VALUES (?, ?)
           ON CONFLICT(activity_iri) DO UPDATE SET identity_mode = CASE
             WHEN activity_policies.identity_mode = 'anonymous' OR excluded.identity_mode = 'anonymous'
               THEN 'anonymous'
             WHEN activity_policies.identity_mode = 'token' OR excluded.identity_mode = 'token'
               THEN 'token'
             ELSE 'named'
           END`,
        ).bind(options.activityScope, options.identityMode ?? "anonymous"),
      );
    }
    await this.db.batch(statements);
  }

  async listKeys(): Promise<{
    id: string;
    label: string;
    createdAt: string;
    kind: string;
    revokedAt: string | null;
    activityScope: string | null;
    allowedOrigin: string | null;
    lastUsedAt: string | null;
    identityMode: string;
    statementCount: number;
  }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT k.id, k.label, k.created_at, k.kind, k.revoked_at,
                k.activity_scope, k.allowed_origin, k.last_used_at, k.identity_mode,
                COUNT(s.id) AS statement_count
         FROM keys k LEFT JOIN statements s ON s.key_id = k.id
         GROUP BY k.id
         ORDER BY k.created_at DESC, k.id ASC`,
      )
      .all<{
        id: string;
        label: string;
        created_at: string;
        kind: string;
        revoked_at: string | null;
        activity_scope: string | null;
        allowed_origin: string | null;
        last_used_at: string | null;
        identity_mode: string;
        statement_count: number;
      }>();
    return results.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.created_at,
      kind: r.kind,
      revokedAt: r.revoked_at,
      activityScope: r.activity_scope,
      allowedOrigin: r.allowed_origin,
      lastUsedAt: r.last_used_at,
      identityMode: r.identity_mode,
      statementCount: r.statement_count,
    }));
  }

  async legacyStatementCount(): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM statements WHERE key_id IS NULL")
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  async findKey(id: string): Promise<KeyRecord | null> {
    const r = await this.db
      .prepare(
        `SELECT id, secret_hash, label, kind, revoked_at, activity_scope,
                allowed_origin, last_used_at, daily_limit, identity_mode,
                (SELECT tracking_mode FROM instance_settings WHERE id = 1) AS tracking_mode
         FROM keys WHERE id = ?`,
      )
      .bind(id)
      .first<{
        id: string;
        secret_hash: string;
        label: string;
        kind: string;
        revoked_at: string | null;
        activity_scope: string | null;
        allowed_origin: string | null;
        last_used_at: string | null;
        daily_limit: number;
        identity_mode: string;
        tracking_mode: "notice" | "consent";
      }>();
    return r ? {
      id: r.id,
      secretHash: r.secret_hash,
      label: r.label,
      kind: r.kind,
      revokedAt: r.revoked_at,
      activityScope: r.activity_scope,
      allowedOrigin: r.allowed_origin,
      lastUsedAt: r.last_used_at,
      dailyLimit: r.daily_limit,
      identityMode: r.identity_mode,
      trackingMode: r.tracking_mode,
    } : null;
  }

  async revokeKey(id: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND revoked_at IS NULL",
      )
      .bind(id)
      .run();
    return result.meta.changes > 0;
  }

  async touchKey(id: string, usedAt: string): Promise<void> {
    await this.db.prepare("UPDATE keys SET last_used_at = ? WHERE id = ?").bind(usedAt, id).run();
  }

  async upsertActivity(iri: string, name: string | null, pageUrl?: string | null): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO activities (iri, name, page_url) VALUES (?, ?, ?)
         ON CONFLICT(iri) DO UPDATE SET
           name = COALESCE(excluded.name, activities.name),
           page_url = COALESCE(excluded.page_url, activities.page_url)`,
      )
      .bind(iri, name, pageUrl ?? null)
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
          step, response, key_id, canonical_hash, policy_iri, identity_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    const results = await this.db.batch(
      rows.map((s) =>
        stmt.bind(
          s.id, s.raw, s.verb, s.activityIri, s.learnerId,
          s.scoreRaw, s.scoreMin, s.scoreMax, s.scoreScaled,
          s.success, s.completion, s.durationSec, s.timestamp, s.stored, s.registration,
          s.step, s.response, s.keyId ?? null,
          s.canonicalHash ?? null,
          null, null,
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
                step, response, key_id, canonical_hash
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
      keyId: r.key_id as string | null,
      canonicalHash: r.canonical_hash as string | null,
    };
  }

  async existingStatements(ids: string[]): Promise<Map<string, ExistingStatement>> {
    const out = new Map<string, ExistingStatement>();
    if (ids.length === 0) return out;
    const stmt = this.db.prepare("SELECT id, raw, key_id, canonical_hash FROM statements WHERE id = ?");
    const rows = await this.db.batch(ids.map((id) => stmt.bind(id)));
    for (const result of rows) {
      const row = result.results[0] as {
        id?: string;
        raw?: string;
        key_id?: string | null;
        canonical_hash?: string | null;
      } | undefined;
      if (row?.id && row.raw) {
        out.set(row.id, {
          raw: row.raw,
          keyId: row.key_id ?? null,
          canonicalHash: row.canonical_hash ?? null,
        });
      }
    }
    return out;
  }

  async activityIdentityModes(iris: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (iris.length === 0) return out;
    const statement = this.db.prepare(
      "SELECT activity_iri AS iri, identity_mode FROM activity_policies WHERE activity_iri = ?",
    );
    const rows = await this.db.batch(iris.map((iri) => statement.bind(iri)));
    for (const result of rows) {
      const row = result.results[0] as { iri?: string; identity_mode?: string } | undefined;
      if (row?.iri && row.identity_mode) out.set(row.iri, row.identity_mode);
    }
    return out;
  }

  async insertIngestRecords(records: IngestRecord[], keyId: string | null): Promise<number> {
    if (records.length === 0) return 0;
    const statements: D1PreparedStatement[] = [];
    const statementIndexes: number[] = [];

    for (const record of records) {
      const s = record.statement;
      if (record.policyIri) {
        statements.push(
          this.db.prepare(
            `INSERT INTO activity_policies (activity_iri, identity_mode) VALUES (?, ?)
             ON CONFLICT(activity_iri) DO UPDATE SET identity_mode = CASE
               WHEN activity_policies.identity_mode = 'anonymous' OR excluded.identity_mode = 'anonymous'
                 THEN 'anonymous'
               WHEN activity_policies.identity_mode = 'token' OR excluded.identity_mode = 'token'
                 THEN 'token'
               ELSE 'named'
             END`,
          ).bind(record.policyIri, record.identityMode),
        );
      }
      if (s.activityIri) {
        statements.push(
          this.db.prepare(
            `INSERT INTO activities (iri, name, page_url, identity_mode) VALUES (?, ?, ?, ?)
             ON CONFLICT(iri) DO UPDATE SET
               name = COALESCE(excluded.name, activities.name),
               page_url = COALESCE(excluded.page_url, activities.page_url),
               identity_mode = CASE
                 WHEN activities.identity_mode = 'anonymous' OR excluded.identity_mode = 'anonymous'
                   THEN 'anonymous'
                 WHEN activities.identity_mode = 'token' OR excluded.identity_mode = 'token'
                   THEN 'token'
                 ELSE 'named'
               END`,
          ).bind(s.activityIri, record.activityName, record.pageUrl, record.identityMode),
        );
      }

      statements.push(
        this.db.prepare(
          `INSERT INTO learners (id, identity, display_name) VALUES (?, ?, ?)
           ON CONFLICT(identity) DO UPDATE SET
             display_name = COALESCE(excluded.display_name, learners.display_name)`,
        ).bind(record.learnerId, record.identity, record.displayName),
      );

      statementIndexes.push(statements.length);
      statements.push(
        this.db.prepare(
          `INSERT INTO statements
             (id, raw, verb, activity_iri, learner_id,
              score_raw, score_min, score_max, score_scaled,
              success, completion, duration_sec, timestamp, stored, registration,
              step, response, key_id, canonical_hash, policy_iri, identity_mode)
           SELECT ?, ?, ?, ?, l.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           FROM learners l WHERE l.identity = ?
           ON CONFLICT(id) DO NOTHING`,
        ).bind(
          s.id,
          s.raw,
          s.verb,
          s.activityIri,
          s.scoreRaw,
          s.scoreMin,
          s.scoreMax,
          s.scoreScaled,
          s.success,
          s.completion,
          s.durationSec,
          s.timestamp,
          s.stored,
          s.registration,
          s.step,
          s.response,
          keyId,
          s.canonicalHash ?? null,
          record.policyIri,
          record.identityMode,
          record.identity,
        ),
      );
    }

    const results = await this.db.batch(statements);
    return statementIndexes.reduce((count, index) => count + (results[index].meta.changes > 0 ? 1 : 0), 0);
  }

  async listActivities(limit = 100, offset = 0, scope: string | null = null): Promise<ActivitySummary[]> {
    const V = "http://adlnet.gov/expapi/verbs/initialized";
    const { results } = await this.db
      .prepare(
        `SELECT a.iri, a.name, a.page_url, a.first_seen,
           (SELECT COUNT(*) FROM statements s WHERE s.activity_iri = a.iri AND s.verb = ?1) AS starts,
           (SELECT COUNT(DISTINCT s.learner_id) FROM statements s
              WHERE s.activity_iri = a.iri OR substr(s.activity_iri, 1, length(a.iri) + 1) = a.iri || '/') AS participants,
           (SELECT COUNT(DISTINCT s.learner_id) FROM statements s WHERE s.activity_iri = a.iri AND s.completion = 1) AS completions,
           (SELECT s.timestamp FROM statements s
              WHERE s.activity_iri = a.iri OR substr(s.activity_iri, 1, length(a.iri) + 1) = a.iri || '/'
              ORDER BY julianday(s.timestamp) DESC, s.stored DESC, s.id DESC LIMIT 1) AS last_activity
         FROM activities a
         WHERE ${D1Storage.CHILD_FILTER} AND (?4 IS NULL OR a.iri = ?4)
         ORDER BY last_activity IS NULL, julianday(last_activity) DESC, a.iri ASC
         LIMIT ?2 OFFSET ?3`,
      )
      .bind(
        V,
        Math.max(1, Math.min(500, Math.floor(limit))),
        Math.max(0, Math.floor(offset)),
        scope,
      )
      .all<Record<string, unknown>>();
    return results.map((r) => ({
      iri: r.iri as string,
      name: r.name as string | null,
      pageUrl: r.page_url as string | null,
      firstSeen: r.first_seen as string,
      starts: r.starts as number,
      participants: r.participants as number,
      completions: r.completions as number,
      lastActivity: r.last_activity as string | null,
    }));
  }

  async getActivity(iri: string) {
    const r = await this.db
      .prepare("SELECT iri, name, page_url, first_seen FROM activities WHERE iri = ?")
      .bind(iri)
      .first<{ iri: string; name: string | null; page_url: string | null; first_seen: string }>();
    return r ? { iri: r.iri, name: r.name, pageUrl: r.page_url, firstSeen: r.first_seen } : null;
  }

  async getActivityStats(iri: string): Promise<ActivityStats> {
    const V = "http://adlnet.gov/expapi/verbs/initialized";
    const head = await this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM statements WHERE activity_iri = ?1 AND verb = ?2) AS starts,
           (SELECT COUNT(DISTINCT learner_id) FROM statements
              WHERE activity_iri = ?1 OR substr(activity_iri, 1, ?3) = ?4) AS participants,
           (SELECT COUNT(DISTINCT learner_id) FROM statements WHERE activity_iri = ?1 AND completion = 1) AS completions,
           (SELECT AVG(score_scaled) FROM (
              SELECT score_scaled, ROW_NUMBER() OVER (
                PARTITION BY learner_id ORDER BY julianday(timestamp) DESC, stored DESC, id DESC
              ) AS position
              FROM statements
              WHERE activity_iri = ?1 AND score_scaled IS NOT NULL
            ) WHERE position = 1) AS avg_scaled`,
      )
      .bind(iri, V, childPrefix(iri).length, childPrefix(iri))
      .first<{ starts: number; participants: number; completions: number; avg_scaled: number | null }>();
    const { results } = await this.db
      .prepare(
        `SELECT duration_sec FROM (
           SELECT duration_sec, ROW_NUMBER() OVER (
             PARTITION BY learner_id ORDER BY julianday(timestamp) DESC, stored DESC, id DESC
           ) AS position
           FROM statements
           WHERE activity_iri = ?1 AND duration_sec IS NOT NULL
             AND (completion = 1 OR verb IN (
               'http://adlnet.gov/expapi/verbs/completed',
               'http://adlnet.gov/expapi/verbs/passed',
               'http://adlnet.gov/expapi/verbs/failed'
             ))
         ) WHERE position = 1 ORDER BY duration_sec`,
      )
      .bind(iri)
      .all<{ duration_sec: number }>();
    return {
      starts: head?.starts ?? 0,
      participants: head?.participants ?? 0,
      completions: head?.completions ?? 0,
      avgScoreScaled: head?.avg_scaled ?? null,
      durationsSec: results.map((r) => r.duration_sec),
    };
  }

  async listRoster(iri: string, limit = 100, offset = 0): Promise<RosterRow[]> {
    const prefix = childPrefix(iri);
    const { results } = await this.db
      .prepare(
        `SELECT l.id, COALESCE(l.display_name, l.identity) AS label,
           MAX(CASE WHEN s.completion = 1 AND s.activity_iri = ?1 THEN 1 ELSE 0 END) AS completed,
           (SELECT s2.score_raw FROM statements s2
              WHERE s2.learner_id = l.id AND s2.activity_iri = ?1 AND s2.score_raw IS NOT NULL
              ORDER BY julianday(s2.timestamp) DESC, s2.stored DESC, s2.id DESC LIMIT 1) AS score_raw,
           (SELECT s2.score_max FROM statements s2
              WHERE s2.learner_id = l.id AND s2.activity_iri = ?1 AND s2.score_raw IS NOT NULL
              ORDER BY julianday(s2.timestamp) DESC, s2.stored DESC, s2.id DESC LIMIT 1) AS score_max,
           (SELECT s3.timestamp FROM statements s3
              WHERE s3.learner_id = l.id
                AND (s3.activity_iri = ?1 OR substr(s3.activity_iri, 1, ?2) = ?3)
              ORDER BY julianday(s3.timestamp) DESC, s3.stored DESC, s3.id DESC LIMIT 1) AS last_seen
         FROM statements s JOIN learners l ON l.id = s.learner_id
         WHERE s.activity_iri = ?1 OR substr(s.activity_iri, 1, ?2) = ?3
         GROUP BY l.id, label
         ORDER BY julianday(last_seen) DESC, l.id ASC LIMIT ?4 OFFSET ?5`,
      )
      .bind(
        iri,
        prefix.length,
        prefix,
        Math.max(1, Math.min(500, Math.floor(limit))),
        Math.max(0, Math.floor(offset)),
      )
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

  async participantDropOff(iri: string): Promise<number> {
    const prefix = childPrefix(iri);
    const row = await this.db
      .prepare(
        `WITH participants AS (
           SELECT DISTINCT learner_id FROM statements
           WHERE learner_id IS NOT NULL
             AND (activity_iri = ?1 OR substr(activity_iri, 1, ?2) = ?3)
         ), progressed AS (
           SELECT DISTINCT learner_id FROM statements
           WHERE learner_id IS NOT NULL
             AND (activity_iri = ?1 OR substr(activity_iri, 1, ?2) = ?3)
             AND (step IS NOT NULL OR (activity_iri = ?1 AND completion = 1))
         )
         SELECT COUNT(*) AS drop_off
         FROM participants p LEFT JOIN progressed x ON x.learner_id = p.learner_id
         WHERE x.learner_id IS NULL`,
      )
      .bind(iri, prefix.length, prefix)
      .first<{ drop_off: number }>();
    return row?.drop_off ?? 0;
  }

  async startsPerDay(iri: string, days: number): Promise<DayCount[]> {
    const V = "http://adlnet.gov/expapi/verbs/initialized";
    const { results } = await this.db
      .prepare(
        `SELECT date(timestamp) AS day, COUNT(*) AS count
         FROM statements
         WHERE activity_iri = ?1 AND verb = ?2 AND julianday(timestamp) >= julianday('now', ?3)
         GROUP BY day ORDER BY day`,
      )
      .bind(iri, V, `-${Math.max(1, Math.floor(days))} days`)
      .all<{ day: string; count: number }>();
    return results.map((r) => ({ day: r.day, count: r.count }));
  }

  async stepFunnel(iri: string): Promise<FunnelStep[]> {
    const prefix = childPrefix(iri);
    const { results } = await this.db
      .prepare(
        `WITH step_visits AS (
           SELECT learner_id, step, MIN(julianday(timestamp)) AS reached_at
           FROM statements
           WHERE (activity_iri = ?1 OR substr(activity_iri, 1, ?2) = ?3)
             AND step IS NOT NULL AND learner_id IS NOT NULL
           GROUP BY learner_id, step
         ), step_first AS (
           SELECT step, MIN(reached_at) AS first_at
           FROM step_visits GROUP BY step
         ), step_order AS (
           SELECT step, first_at,
                  ROW_NUMBER() OVER (ORDER BY first_at ASC, step ASC) AS position
           FROM step_first
         ), completions AS (
           SELECT learner_id, MIN(julianday(timestamp)) AS completed_at
           FROM statements
           WHERE activity_iri = ?1 AND completion = 1 AND learner_id IS NOT NULL
           GROUP BY learner_id
         )
         SELECT current_order.step,
                COUNT(*) AS learners,
                strftime('%Y-%m-%dT%H:%M:%fZ', current_order.first_at) AS first_seen,
                SUM(CASE WHEN
                  NOT EXISTS (
                    SELECT 1 FROM step_visits later
                    JOIN step_order later_order ON later_order.step = later.step
                    WHERE later.learner_id = current_visit.learner_id
                      AND later_order.position > current_order.position
                      AND later.reached_at >= current_visit.reached_at
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM completions completed
                    WHERE completed.learner_id = current_visit.learner_id
                      AND completed.completed_at >= current_visit.reached_at
                  )
                THEN 1 ELSE 0 END) AS drop_off
         FROM step_order current_order
         JOIN step_visits current_visit ON current_visit.step = current_order.step
         GROUP BY current_order.step, current_order.first_at, current_order.position
         ORDER BY current_order.position ASC`,
      )
      .bind(iri, prefix.length, prefix)
      .all<{ step: string; learners: number; first_seen: string; drop_off: number }>();
    return results.map((row) => ({
      step: row.step,
      learners: row.learners,
      firstSeen: row.first_seen,
      dropOff: row.drop_off,
    }));
  }

  async stepLabels(iri: string): Promise<Record<string, string>> {
    const prefix = `${iri}/steps/`;
    const { results } = await this.db
      .prepare("SELECT iri, name FROM activities WHERE name IS NOT NULL AND substr(iri, 1, ?1) = ?2")
      .bind(prefix.length, prefix)
      .all<{ iri: string; name: string }>();
    const labels: Record<string, string> = {};
    for (const r of results) {
      const raw = r.iri.slice(prefix.length);
      let key = raw;
      try {
        key = decodeURIComponent(raw);
      } catch {
        key = raw;
      }
      labels[key] = r.name;
    }
    return labels;
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

  async answers(iri: string, learnerIds?: string[]): Promise<AnswerRow[]> {
    if (learnerIds && learnerIds.length === 0) return [];
    const prefix = `${iri}/q/`;
    const selectedIds = learnerIds?.slice(0, 500) ?? [];
    const placeholders = selectedIds.map(() => "?").join(", ");
    const learnerFilter = selectedIds.length > 0 ? `AND s.learner_id IN (${placeholders})` : "";
    const { results } = await this.db
      .prepare(
        `SELECT s.learner_id, s.activity_iri, s.response, s.success, s.timestamp, a.name AS question_label
         FROM statements s LEFT JOIN activities a ON a.iri = s.activity_iri
         WHERE s.verb = 'http://adlnet.gov/expapi/verbs/answered'
           AND substr(s.activity_iri, 1, ?1) = ?2
           ${learnerFilter}
         ORDER BY julianday(s.timestamp) ASC, s.stored ASC, s.id ASC LIMIT 10001`,
      )
      .bind(prefix.length, prefix, ...selectedIds)
      .all<{
        learner_id: string;
        activity_iri: string;
        response: string | null;
        success: number | null;
        timestamp: string;
        question_label: string | null;
      }>();
    return results.map((r) => {
      const suffix = r.activity_iri.slice(prefix.length);
      let questionId = suffix;
      try {
        questionId = decodeURIComponent(suffix);
      } catch {
        questionId = suffix;
      }
      return {
        learnerId: r.learner_id,
        questionId,
        questionLabel: r.question_label,
        response: r.response,
        success: r.success,
        timestamp: r.timestamp,
      };
    });
  }

  async questionStats(iri: string): Promise<QuestionStat[]> {
    const prefix = `${iri}/q/`;
    const { results } = await this.db
      .prepare(
        `SELECT s.activity_iri, a.name AS question_label,
                COUNT(*) AS answered,
                SUM(CASE WHEN s.success = 1 THEN 1 ELSE 0 END) AS correct,
                SUM(CASE WHEN s.success IS NOT NULL THEN 1 ELSE 0 END) AS known_correctness,
                MIN(julianday(s.timestamp)) AS first_answered
         FROM statements s LEFT JOIN activities a ON a.iri = s.activity_iri
         WHERE s.verb = 'http://adlnet.gov/expapi/verbs/answered'
           AND substr(s.activity_iri, 1, ?1) = ?2
         GROUP BY s.activity_iri, a.name
         ORDER BY first_answered ASC, s.activity_iri ASC`,
      )
      .bind(prefix.length, prefix)
      .all<{
        activity_iri: string;
        question_label: string | null;
        answered: number;
        correct: number;
        known_correctness: number;
      }>();
    return results.map((row) => {
      const suffix = row.activity_iri.slice(prefix.length);
      let questionId = suffix;
      try { questionId = decodeURIComponent(suffix); } catch { questionId = suffix; }
      return {
        questionId,
        questionLabel: row.question_label,
        answered: row.answered,
        correct: row.correct,
        knownCorrectness: row.known_correctness,
      };
    });
  }

  async getLearner(learnerId: string) {
    const r = await this.db
      .prepare("SELECT id, identity, COALESCE(display_name, identity) AS label FROM learners WHERE id = ?")
      .bind(learnerId)
      .first<{ id: string; identity: string; label: string }>();
    return r ?? null;
  }

  async rawStatements(iri: string, limit = 10000, offset = 0): Promise<string[]> {
    const prefix = childPrefix(iri);
    const { results } = await this.db
      .prepare(
        `SELECT raw FROM statements WHERE activity_iri = ?1 OR substr(activity_iri, 1, ?2) = ?3
         ORDER BY julianday(timestamp) ASC, stored ASC, id ASC LIMIT ?4 OFFSET ?5`,
      )
      .bind(
        iri,
        prefix.length,
        prefix,
        Math.max(1, Math.min(10000, Math.floor(limit))),
        Math.max(0, Math.floor(offset)),
      )
      .all<{ raw: string }>();
    return results.map((r) => r.raw);
  }

  async rawStatementsForLearner(learnerId: string, limit = 10000, offset = 0): Promise<string[]> {
    const { results } = await this.db
      .prepare("SELECT raw FROM statements WHERE learner_id = ? ORDER BY julianday(timestamp) ASC, stored ASC, id ASC LIMIT ? OFFSET ?")
      .bind(
        learnerId,
        Math.max(1, Math.min(10000, Math.floor(limit))),
        Math.max(0, Math.floor(offset)),
      )
      .all<{ raw: string }>();
    return results.map((row) => row.raw);
  }

  async learnerTimeline(iri: string, learnerId: string, limit = 1000): Promise<TimelineRow[]> {
    const prefix = childPrefix(iri);
    const { results } = await this.db
      .prepare(
        `SELECT timestamp, verb, activity_iri, step, response, success, completion,
                score_raw, score_max, duration_sec
         FROM statements
         WHERE learner_id = ?1 AND (activity_iri = ?2 OR substr(activity_iri, 1, ?3) = ?4)
         ORDER BY julianday(timestamp) ASC, stored ASC, id ASC LIMIT ?5`,
      )
      .bind(learnerId, iri, prefix.length, prefix, Math.max(1, Math.min(1000, Math.floor(limit))))
      .all<Record<string, unknown>>();
    return results.map((r) => ({
      timestamp: r.timestamp as string,
      verb: r.verb as string,
      activityIri: r.activity_iri as string | null,
      step: r.step as string | null,
      response: r.response as string | null,
      success: r.success as number | null,
      completion: r.completion as number | null,
      scoreRaw: r.score_raw as number | null,
      scoreMax: r.score_max as number | null,
      durationSec: r.duration_sec as number | null,
    }));
  }

  async getSettings(): Promise<InstanceSettings> {
    const row = await this.db
      .prepare(
        `SELECT operator_name, privacy_url, privacy_contact, retention_days,
                region_label, tracking_mode, updated_at
         FROM instance_settings WHERE id = 1`,
      )
      .first<{
        operator_name: string;
        privacy_url: string;
        privacy_contact: string;
        retention_days: number;
        region_label: string;
        tracking_mode: "notice" | "consent";
        updated_at: string;
      }>();
    if (!row) throw new Error("Proof instance settings are missing.");
    return {
      operatorName: row.operator_name,
      privacyUrl: row.privacy_url,
      privacyContact: row.privacy_contact,
      retentionDays: row.retention_days,
      regionLabel: row.region_label,
      trackingMode: row.tracking_mode,
      updatedAt: row.updated_at,
    };
  }

  async updateSettings(settings: Omit<InstanceSettings, "updatedAt">): Promise<InstanceSettings> {
    await this.db
      .prepare(
        `UPDATE instance_settings SET
           operator_name = ?, privacy_url = ?, privacy_contact = ?, retention_days = ?,
           region_label = ?, tracking_mode = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = 1`,
      )
      .bind(
        settings.operatorName,
        settings.privacyUrl,
        settings.privacyContact,
        settings.retentionDays,
        settings.regionLabel,
        settings.trackingMode,
      )
      .run();
    return this.getSettings();
  }

  async deleteLearner(learnerId: string): Promise<boolean> {
    const results = await this.db.batch([
      this.db.prepare("DELETE FROM statements WHERE learner_id = ?").bind(learnerId),
      this.db.prepare("DELETE FROM learners WHERE id = ?").bind(learnerId),
    ]);
    return results[1].meta.changes > 0;
  }

  async deleteExpiredStatements(cutoff: string, limit: number): Promise<number> {
    const result = await this.db
      .prepare(
        `DELETE FROM statements WHERE id IN (
           SELECT id FROM statements WHERE stored < ? ORDER BY stored ASC, id ASC LIMIT ?
         )`,
      )
      .bind(cutoff, Math.max(1, Math.min(1000, Math.floor(limit))))
      .run();
    return result.meta.changes;
  }

  async cleanupRetention(cutoff: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM learners WHERE NOT EXISTS (SELECT 1 FROM statements WHERE learner_id = learners.id)")
      .run();
    await this.db
      .prepare(
        `DELETE FROM activities WHERE NOT EXISTS (
           SELECT 1 FROM statements
           WHERE activity_iri = activities.iri
              OR substr(activity_iri, 1, length(activities.iri) + 1) = activities.iri || '/'
         )`,
      )
      .run();
    await this.db.prepare("DELETE FROM ingest_usage WHERE day < substr(?, 1, 10)").bind(cutoff).run();
  }
}
