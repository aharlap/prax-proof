-- SPDX-License-Identifier: MIT
CREATE TABLE keys (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE activities (
  iri TEXT PRIMARY KEY,
  name TEXT,
  first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE learners (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL UNIQUE,
  display_name TEXT
);

CREATE TABLE statements (
  id TEXT PRIMARY KEY,
  raw TEXT NOT NULL,
  verb TEXT NOT NULL,
  activity_iri TEXT,
  learner_id TEXT,
  score_raw REAL, score_min REAL, score_max REAL, score_scaled REAL,
  success INTEGER,
  completion INTEGER,
  duration_sec REAL,
  timestamp TEXT NOT NULL,
  stored TEXT NOT NULL,
  registration TEXT
);

CREATE INDEX idx_statements_activity ON statements(activity_iri, timestamp);
CREATE INDEX idx_statements_learner ON statements(learner_id, timestamp);
