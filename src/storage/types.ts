// SPDX-License-Identifier: MIT
export interface KeyRecord {
  id: string;
  secretHash: string;
  label: string;
  kind: string;
  revokedAt: string | null;
  activityScope: string | null;
  allowedOrigin: string | null;
  lastUsedAt: string | null;
  dailyLimit: number;
  identityMode: string;
  trackingMode: "notice" | "consent";
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
  keyId?: string | null;
  canonicalHash?: string | null;
}

export interface ExistingStatement {
  raw: string;
  keyId: string | null;
  canonicalHash: string | null;
}

export interface IngestRecord {
  statement: Omit<StatementRow, "learnerId" | "keyId">;
  identity: string;
  displayName: string | null;
  learnerId: string;
  activityName: string | null;
  pageUrl: string | null;
  identityMode: string;
  policyIri: string | null;
}

export interface InstanceSettings {
  operatorName: string;
  privacyUrl: string;
  privacyContact: string;
  retentionDays: number;
  regionLabel: string;
  trackingMode: "notice" | "consent";
  updatedAt: string;
}

export interface ActivitySummary {
  iri: string;
  name: string | null;
  pageUrl: string | null;
  firstSeen: string;
  starts: number;
  participants: number;
  completions: number;
  lastActivity: string | null;
}

export interface AnswerRow {
  learnerId: string;
  questionId: string;
  questionLabel: string | null;
  response: string | null;
  success: number | null;
  timestamp: string;
}

export interface QuestionStat {
  questionId: string;
  questionLabel: string | null;
  answered: number;
  correct: number;
  knownCorrectness: number;
}

export interface ActivityStats {
  starts: number;
  participants: number;
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
  dropOff: number;
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
  createKey(
    id: string,
    secretHash: string,
    label: string,
    kind?: string,
    options?: {
      activityScope?: string | null;
      allowedOrigin?: string | null;
      dailyLimit?: number;
      identityMode?: string;
    },
  ): Promise<void>;
  findKey(id: string): Promise<KeyRecord | null>;
  listKeys(): Promise<{
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
  }[]>;
  legacyStatementCount(): Promise<number>;
  revokeKey(id: string): Promise<boolean>;
  touchKey(id: string, usedAt: string): Promise<void>;
  upsertActivity(iri: string, name: string | null, pageUrl?: string | null): Promise<void>;
  upsertLearner(identity: string, displayName: string | null): Promise<string>;
  insertStatements(rows: StatementRow[]): Promise<string[]>;
  existingStatements(ids: string[]): Promise<Map<string, ExistingStatement>>;
  activityIdentityModes(iris: string[]): Promise<Map<string, string>>;
  insertIngestRecords(records: IngestRecord[], keyId: string | null): Promise<number>;
  getStatement(id: string): Promise<StatementRow | null>;
  listActivities(limit?: number, offset?: number, scope?: string | null): Promise<ActivitySummary[]>;
  getActivity(iri: string): Promise<{ iri: string; name: string | null; pageUrl: string | null; firstSeen: string } | null>;
  getActivityStats(iri: string): Promise<ActivityStats>;
  listRoster(iri: string, limit?: number, offset?: number): Promise<RosterRow[]>;
  participantDropOff(iri: string): Promise<number>;
  startsPerDay(iri: string, days: number): Promise<DayCount[]>;
  stepFunnel(iri: string): Promise<FunnelStep[]>;
  stepLabels(iri: string): Promise<Record<string, string>>;
  startedLearners(iri: string): Promise<number>;
  answers(iri: string, learnerIds?: string[]): Promise<AnswerRow[]>;
  questionStats(iri: string): Promise<QuestionStat[]>;
  getLearner(learnerId: string): Promise<{ id: string; label: string; identity: string } | null>;
  learnerTimeline(iri: string, learnerId: string, limit?: number): Promise<TimelineRow[]>;
  rawStatements(iri: string, limit?: number, offset?: number): Promise<string[]>;
  rawStatementsForLearner(learnerId: string, limit?: number, offset?: number): Promise<string[]>;
  getSettings(): Promise<InstanceSettings>;
  updateSettings(settings: Omit<InstanceSettings, "updatedAt">): Promise<InstanceSettings>;
  deleteLearner(learnerId: string): Promise<boolean>;
  deleteExpiredStatements(cutoff: string, limit: number): Promise<number>;
  cleanupRetention(cutoff: string): Promise<void>;
}
