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
  step: string | null;
  response: string | null;
}

export interface ActivitySummary {
  iri: string;
  name: string | null;
  firstSeen: string;
  attempts: number;
  completions: number;
  lastActivity: string | null;
}

export interface ActivityStats {
  attempts: number;
  completions: number;
  avgScoreScaled: number | null;
  durationsSec: number[];
}

export interface RosterRow {
  learnerId: string;
  label: string;
  completed: boolean;
  scoreRaw: number | null;
  scoreMax: number | null;
  lastSeen: string;
}

export interface DayCount {
  day: string;
  count: number;
}

export interface FunnelStep {
  step: string;
  learners: number;
  firstSeen: string;
}

export interface TimelineRow {
  timestamp: string;
  verb: string;
  activityIri: string | null;
  step: string | null;
  response: string | null;
  success: number | null;
  completion: number | null;
  scoreRaw: number | null;
  scoreMax: number | null;
  durationSec: number | null;
}

export interface Storage {
  createKey(id: string, secretHash: string, label: string): Promise<void>;
  findKey(id: string): Promise<KeyRecord | null>;
  listKeys(): Promise<{ id: string; label: string; createdAt: string }[]>;
  upsertActivity(iri: string, name: string | null): Promise<void>;
  upsertLearner(identity: string, displayName: string | null): Promise<string>;
  insertStatements(rows: StatementRow[]): Promise<string[]>;
  getStatement(id: string): Promise<StatementRow | null>;
  listActivities(): Promise<ActivitySummary[]>;
  getActivity(iri: string): Promise<{ iri: string; name: string | null; firstSeen: string } | null>;
  getActivityStats(iri: string): Promise<ActivityStats>;
  listRoster(iri: string): Promise<RosterRow[]>;
  attemptsPerDay(iri: string, days: number): Promise<DayCount[]>;
  stepFunnel(iri: string): Promise<FunnelStep[]>;
  startedLearners(iri: string): Promise<number>;
  getLearner(learnerId: string): Promise<{ id: string; label: string } | null>;
  learnerTimeline(iri: string, learnerId: string): Promise<TimelineRow[]>;
  rawStatements(iri: string): Promise<string[]>;
}
