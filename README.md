# Proof

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Praxity/prax-proof)
[![CI](https://github.com/Praxity/prax-proof/actions/workflows/ci.yml/badge.svg)](https://github.com/Praxity/prax-proof/actions/workflows/ci.yml)

See participation, completion, scores, and where learners stopped, on your own Cloudflare account. Proof is an open-source (MIT), privacy-aware results tracker for learning activities: no LMS and no subscription.

![Proof dashboard — activity detail with completion rate, drop-off funnel, and learner roster](docs/assets/dashboard.png)

## How it works

1. Deploy your instance (one click below, or CLI).
2. Add one script tag to any page — or paste one prompt into your AI builder, or add data-h5p to a page that already hosts H5P content.
3. Watch results land: participant-based completion, learner-set drop-off, per-learner timelines, and paged exports.

In Proof, a participant is a distinct learner record, usually a pseudonymous
browser identity. It is not a verified unique person or an IP/fingerprint-based
visitor metric; shared devices, resets, and multiple browsers affect the count.

## Compared honestly

| | Proof | SCORM Cloud (free tier) | lrsql | Spreadsheet |
|---|---|---|---|---|
| Cost | Free, your Cloudflare account | Free to 10 registrations, then $40+/mo | Free, self-hosted | Free |
| Teacher-readable results | Yes — built for it | Reporting is the paid tier | Statement browser, not a dashboard | Manual entry |
| Standards | Honest xAPI subset (statements only) | Full LRS + SCORM | Full conformant LRS | None |
| Works with AI-built pages | One prompt (llms.txt) | Manual integration | Manual integration | Manual |

Need a full conformant LRS? Use [lrsql](https://github.com/yetanalytics/lrsql) — Proof's statements export/forward cleanly. More in the [embed guide](docs/embed.md) and the honest fine print on every instance's /about page. Plain-language capabilities and limits: [what Proof can and can't tell you](docs/embed.md#what-proof-can--and-cant--tell-you).

## Status

Available. Ingest, privacy controls, reporting, retention, and Cloudflare
deployment are functional and hardened. Local Worker/D1 tests, migration
upgrade rehearsal, real-browser field tests, typecheck, and desktop/mobile axe
gates are in place. The remote-D1 and first-time "Deploy to Cloudflare"
canaries passed on 2026-07-14: a fresh Worker and remote D1 applied every
migration, ingested statements (including an idempotent replay), and reported
correct participant and completion counts. The Docker/SQLite package remains a
documented fast-follow.

## Quickstart (local)

    pnpm install
    cp .dev.vars.example .dev.vars
    # Set a strong ADMIN_PASSWORD in .dev.vars
    wrangler d1 migrations apply proof --local
    pnpm dev

Mint an ingest key (admin password is the ADMIN_PASSWORD secret; use any
value with `wrangler dev --var ADMIN_PASSWORD:dev-password`):

    curl -X POST http://localhost:8787/admin/keys \
      -u admin:dev-password \
      -H "Content-Type: application/json" \
      -d '{"label":"Fractions quiz","activityScope":"http://localhost:8787/a/fractions-quiz","identityMode":"anonymous"}'

Send a statement with the returned id/secret:

    curl -X POST http://localhost:8787/xapi/statements \
      -u <key-id>:<key-secret> \
      -H "X-Experience-API-Version: 1.0.3" \
      -H "Content-Type: application/json" \
      -d '{"actor":{"account":{"homePage":"https://example.org","name":"browser-id"}},"verb":{"id":"http://adlnet.gov/expapi/verbs/completed"},"object":{"id":"http://localhost:8787/a/fractions-quiz"},"result":{"completion":true}}'

## Embed in any page

One script tag + four calls (`proof.start/step/answer/finish`) — see
[docs/embed.md](docs/embed.md). AI builders: point them at your instance's
`/llms.txt`, which contains paste-ready instructions including a learner notice.

Anonymous pseudonymous identity is the default. Operators can configure notice or opt-in tracking, retention, hosting-region copy, and a privacy contact. Proof can export or delete a learner record, but the operator remains responsible for legal basis, notice/consent, data minimization, safeguards, and rights requests under applicable law. See [Privacy and operator responsibilities](docs/embed.md#privacy-and-operator-responsibilities).

## Read your results (humans, scripts, AIs)

Read keys are separate from ingest keys, so pages can write results without being able to read them back. The read API provides JSON summaries and paste-ready markdown reports; `llms.txt` documents those endpoints for AI builders, and [docs/api.md](docs/api.md) is the reference.

## Deploy

**Recommended:** use the Deploy to Cloudflare button. See [docs/deploy.md](docs/deploy.md) for one-click, CLI, EU jurisdiction, and the current limits of regional placement. Production instances must set the `ADMIN_PASSWORD` secret:

    wrangler secret put ADMIN_PASSWORD

## Errors

Auth 401 responses return `{ "error": "Unauthorized" }`; other 4xx responses return `{ "error": "<plain-language reason>", "docs": "..." }`.
The version header `X-Experience-API-Version: 1.0.x` is required on
`/xapi/statements`.

## Development

    pnpm test        # Vitest via @cloudflare/vitest-pool-workers (local D1)
    pnpm typecheck
    pnpm test:a11y   # Playwright + axe, desktop and mobile
    pnpm verify      # all of the above
    pnpm field       # real Wrangler H5P + consent flows
    pnpm screenshot  # refresh docs/assets/dashboard.png

## License

MIT. Every source file carries an SPDX header.
