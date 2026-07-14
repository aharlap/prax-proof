# Backlog

Release validation, post-publication, and alternate-deployment work:

- [x] Run a disposable remote-D1 canary for the 10-statement replay/conflict path, concurrent exact duplicates, atomic quota rollback, and retention draining. (2026-07-14) This surfaced and fixed a remote-D1 blocker: migration `0008_atomic_ingest.sql` used `CASE...END` inside/around trigger bodies, which broke wrangler's `BEGIN/END` split and made the remote D1 API reject it (`SQLITE_ERROR 7500`). Rewritten to `SELECT ... WHERE` aborts and arithmetic identity ranking; all 8 migrations now apply to a fresh remote D1, and the 194-test local suite still passes.
- [x] Exercise both a first-time Deploy to Cloudflare flow and a populated migration-first upgrade before tagging the first public release. (2026-07-14) A fresh Worker + fresh remote D1 deployed cleanly, ingested statements via Basic-auth ingest keys, deduplicated an exact replay (starts stayed at 2), and returned correct participant/completion counts through the read API. Disposable resources were deleted after.
- [ ] Ship and restore-test the Docker/SQLite package before advertising Railway, Render, Coolify, Dokploy, or region-pinned VPS deployment.
- [ ] Add documented D1 backup/restore automation and a periodic restore drill.
- [ ] Add an operator-visible retention job status and failure alert.
- [ ] Revisit configurable browser pseudonym expiry so it can track a shorter instance retention period.
- [ ] Validate demand for a separate unique-visitors metric before adding one; define browser/device semantics and do not introduce IP storage or fingerprinting.
- [ ] Decide whether the original operator-generated token roster/link workflow belongs in v0.1; current token mode accepts externally generated opaque tokens.
- [ ] Validate demand for manual funnel step ordering before adding it; current ordering is derived from first reach and learner chronology.
