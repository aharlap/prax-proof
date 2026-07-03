# Proof

Plausible, for learning. Proof is a free, open-source (MIT) results tracker
for learning activities: see who did your activity, whether they finished,
how they scored, and where they dropped off — without an LMS, without a
subscription.

**Proof is not a conformant LRS** and does not claim the term. It implements
an honest subset of xAPI 1.0.3: the Statements resource only (no document
APIs, no voiding, no attachments). Statements are portable JSON — when you
outgrow Proof, export or forward them to a full LRS such as
[SQL LRS](https://www.sqllrs.com/).

## Status

Milestone 1: xAPI statement ingest on Cloudflare Workers + D1.
Snippet, dashboard, and one-click deploy are on the roadmap
(see `docs/` in the workspace).

## Quickstart (local)

    pnpm install
    pnpm dev                # wrangler dev with a local D1

Mint an ingest key (admin password is the ADMIN_PASSWORD secret; use any
value with `wrangler dev --var ADMIN_PASSWORD:dev-password`):

    curl -X POST http://localhost:8787/admin/keys \
      -u admin:dev-password \
      -H "Content-Type: application/json" \
      -d '{"label":"my classroom"}'

Send a statement with the returned id/secret:

    curl -X POST http://localhost:8787/xapi/statements \
      -u <key-id>:<key-secret> \
      -H "X-Experience-API-Version: 1.0.3" \
      -H "Content-Type: application/json" \
      -d '{"actor":{"mbox":"mailto:me@example.org"},"verb":{"id":"http://adlnet.gov/expapi/verbs/completed"},"object":{"id":"https://example.org/my-activity"}}'

## Embed in any page

One script tag + four calls (`proof.start/step/answer/finish`) — see
[docs/embed.md](docs/embed.md). AI builders: point them at your instance's
`/llms.txt`, which contains paste-ready instructions.

## Errors

All 4xx responses return `{ "error": "<plain-language reason>", "docs": "..." }`.
The version header `X-Experience-API-Version: 1.0.x` is required on
`/xapi/statements`.

## Development

    pnpm test        # vitest via @cloudflare/vitest-pool-workers (local D1)
    pnpm typecheck

## License

MIT. Every source file carries an SPDX header.
