-- SPDX-License-Identifier: MIT
ALTER TABLE keys ADD COLUMN kind TEXT NOT NULL DEFAULT 'ingest';
