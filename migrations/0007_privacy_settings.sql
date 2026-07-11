-- SPDX-License-Identifier: MIT
ALTER TABLE activities ADD COLUMN identity_mode TEXT NOT NULL DEFAULT 'anonymous';

CREATE TABLE instance_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  operator_name TEXT NOT NULL DEFAULT '',
  privacy_url TEXT NOT NULL DEFAULT '',
  privacy_contact TEXT NOT NULL DEFAULT '',
  retention_days INTEGER NOT NULL DEFAULT 365,
  region_label TEXT NOT NULL DEFAULT '',
  tracking_mode TEXT NOT NULL DEFAULT 'notice',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO instance_settings (id) VALUES (1);
