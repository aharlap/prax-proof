// SPDX-License-Identifier: MIT
import type { KeyRecord, StatementRow, Storage } from "./types";

export class D1Storage implements Storage {
  constructor(private db: D1Database) {}

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
          success, completion, duration_sec, timestamp, stored, registration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    const results = await this.db.batch(
      rows.map((s) =>
        stmt.bind(
          s.id, s.raw, s.verb, s.activityIri, s.learnerId,
          s.scoreRaw, s.scoreMin, s.scoreMax, s.scoreScaled,
          s.success, s.completion, s.durationSec, s.timestamp, s.stored, s.registration,
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
                success, completion, duration_sec, timestamp, stored, registration
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
    };
  }
}
