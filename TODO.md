# Milestone 1 polish backlog

Non-blocking findings from the M1 final review, to harden before/during M2:

- [ ] `activityName` prefers exact `"en"` only — switch to language-tag prefix match (`en`, `en-US`, `en-GB`) with tests for non-en fallback and bare-`"P"` duration null (src/xapi/extract.ts)
- [ ] Add learner COALESCE null-display_name preservation test (mirror of the activities test) (test/storage.test.ts)
- [ ] Add test asserting the "Statement N" index prefix in batch validation errors (test/validate.test.ts)
- [ ] `.trim()` key labels and reject whitespace-only; add empty-string label test (src/index.ts /admin/keys)
- [ ] README: add `wrangler secret put ADMIN_PASSWORD` note for production deploys (currently only documents dev `--var`)
