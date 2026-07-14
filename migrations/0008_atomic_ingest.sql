-- SPDX-License-Identifier: MIT
-- Trigger bodies avoid CASE...END and use SELECT ... WHERE for aborts.
-- Cloudflare D1's remote migration runner tracks BEGIN/END to keep trigger
-- bodies intact; a CASE...END inside or around the body closes that count
-- early, so the remote D1 API receives a truncated statement and rejects it
-- (SQLITE_ERROR 7500 "incomplete input"). Local miniflare tolerates it; remote
-- does not. Identity-mode ranking is expressed arithmetically for the same
-- reason (anonymous < token < named).
ALTER TABLE statements ADD COLUMN canonical_hash TEXT;
ALTER TABLE statements ADD COLUMN policy_iri TEXT;
ALTER TABLE statements ADD COLUMN identity_mode TEXT;
CREATE INDEX idx_statements_canonical_hash ON statements(id, canonical_hash);

CREATE TABLE activity_policies (
  activity_iri TEXT PRIMARY KEY,
  identity_mode TEXT NOT NULL CHECK (identity_mode IN ('anonymous', 'token', 'named'))
);

INSERT INTO activity_policies (activity_iri, identity_mode)
SELECT iri, identity_mode FROM activities;

CREATE TRIGGER reject_conflicting_statement_id
BEFORE INSERT ON statements
WHEN EXISTS (
  SELECT 1 FROM statements
  WHERE id = NEW.id
    AND canonical_hash IS NOT NULL
    AND canonical_hash <> NEW.canonical_hash
)
BEGIN
  SELECT RAISE(ABORT, 'proof_statement_conflict');
END;

CREATE TRIGGER reject_stale_identity_policy
BEFORE INSERT ON statements
WHEN NEW.policy_iri IS NOT NULL
  AND NEW.identity_mode IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM activity_policies policy
    WHERE policy.activity_iri = NEW.policy_iri
      AND (
        (policy.identity_mode = 'token') + (policy.identity_mode = 'named') * 2
      ) < (
        (NEW.identity_mode = 'token') + (NEW.identity_mode = 'named') * 2
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'proof_identity_policy_changed');
END;

CREATE TRIGGER count_statement_against_quota
AFTER INSERT ON statements
WHEN NEW.key_id IS NOT NULL
BEGIN
  INSERT INTO ingest_usage (key_id, day, statement_count)
  VALUES (NEW.key_id, substr(NEW.stored, 1, 10), 1)
  ON CONFLICT(key_id, day) DO UPDATE SET
    statement_count = statement_count + 1;

  SELECT RAISE(ABORT, 'proof_quota_exceeded')
  WHERE (
    SELECT statement_count FROM ingest_usage
    WHERE key_id = NEW.key_id AND day = substr(NEW.stored, 1, 10)
  ) > COALESCE((SELECT daily_limit FROM keys WHERE id = NEW.key_id), 0);
END;
