-- SPDX-License-Identifier: MIT
ALTER TABLE statements ADD COLUMN step TEXT;
ALTER TABLE statements ADD COLUMN response TEXT;
CREATE INDEX idx_statements_step ON statements(activity_iri, step);
