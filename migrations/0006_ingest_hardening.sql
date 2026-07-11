-- SPDX-License-Identifier: MIT
ALTER TABLE keys ADD COLUMN revoked_at TEXT;
ALTER TABLE keys ADD COLUMN activity_scope TEXT;
ALTER TABLE keys ADD COLUMN allowed_origin TEXT;
ALTER TABLE keys ADD COLUMN last_used_at TEXT;
ALTER TABLE keys ADD COLUMN daily_limit INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE keys ADD COLUMN identity_mode TEXT NOT NULL DEFAULT 'anonymous';

ALTER TABLE statements ADD COLUMN key_id TEXT;
CREATE INDEX idx_statements_key ON statements(key_id, stored);

CREATE TABLE ingest_usage (
  key_id TEXT NOT NULL,
  day TEXT NOT NULL,
  statement_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day)
);
