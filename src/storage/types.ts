// SPDX-License-Identifier: MIT
export interface KeyRecord {
  id: string;
  secretHash: string;
  label: string;
}

export interface StatementRow {
  id: string;
  raw: string;
  verb: string;
  activityIri: string | null;
  learnerId: string | null;
  scoreRaw: number | null;
  scoreMin: number | null;
  scoreMax: number | null;
  scoreScaled: number | null;
  success: number | null;     // SQLite boolean: 0/1/null
  completion: number | null;  // SQLite boolean: 0/1/null
  durationSec: number | null;
  timestamp: string;          // ISO 8601
  stored: string;             // ISO 8601
  registration: string | null;
}

export interface Storage {
  createKey(id: string, secretHash: string, label: string): Promise<void>;
  findKey(id: string): Promise<KeyRecord | null>;
  upsertActivity(iri: string, name: string | null): Promise<void>;
  upsertLearner(identity: string, displayName: string | null): Promise<string>;
  insertStatements(rows: StatementRow[]): Promise<string[]>;
  getStatement(id: string): Promise<StatementRow | null>;
}
