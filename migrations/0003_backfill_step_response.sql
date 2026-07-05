-- SPDX-License-Identifier: MIT
-- Backfill step/response for statements ingested before migration 0002.
-- Note: child-IRI steps are backfilled without URI-decoding (SQLite cannot
-- percent-decode); statements ingested after 0002 decode correctly at ingest.
UPDATE statements SET response = json_extract(raw, '$.result.response')
  WHERE response IS NULL AND json_extract(raw, '$.result.response') IS NOT NULL;
UPDATE statements SET step = json_extract(raw, '$.result.extensions."https://praxity.io/xapi/ext/step"')
  WHERE step IS NULL AND json_extract(raw, '$.result.extensions."https://praxity.io/xapi/ext/step"') IS NOT NULL;
UPDATE statements SET step = substr(activity_iri, instr(activity_iri, '/steps/') + 7)
  WHERE step IS NULL AND activity_iri LIKE '%/steps/%';
