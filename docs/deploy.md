# Deploy

## One-Click

The Deploy to Cloudflare button parses this repo's Wrangler config, auto-provisions the D1 database, prompts for the required `ADMIN_PASSWORD`, creates the deployer's own repo copy, and deploys. You do not need to fork first. If you maintain a fork, update the button URL in its README so it deploys your fork.

If the deploy UI did not prompt for the secret, set it before opening the dashboard:

    wrangler secret put ADMIN_PASSWORD

You can also set `ADMIN_PASSWORD` in the Cloudflare dashboard Variables UI.

## CLI

    git clone https://github.com/Praxity/prax-proof.git
    cd prax-proof
    wrangler login
    pnpm install
    pnpm run deploy
    wrangler secret put ADMIN_PASSWORD

`pnpm run deploy` builds the snippet, applies remote migrations, and only then
deploys the Worker. Cloudflare auto-provisions the D1 binding for first-time
deploys. Migration-first ordering keeps upgraded code from running against an
older schema. If a migration fails, the Worker deployment does not proceed.

## First steps after deploying

Open `https://YOUR-WORKER.workers.dev/dashboard` in a browser and sign in with
username `admin` and the `ADMIN_PASSWORD` you set. Create your first key on
the Keys page. New dashboard keys are scoped to one activity by default and can
be restricted to the website origin that hosts it. Then complete the Privacy
and retention settings page before sharing the activity with learners.

## Region and jurisdiction

Create the DB manually before the first deploy:

    wrangler d1 create proof --jurisdiction eu

Paste the returned `database_id` into `wrangler.toml`'s `d1_databases` block. Jurisdiction is set at creation and cannot change later. Then run:

    pnpm run deploy

Cloudflare D1 does not currently offer a Canadian jurisdiction guarantee. A
region label in Proof is descriptive only and does not change where D1 stores
data. If a contract or legal assessment requires a specific unsupported region,
do not imply that the label solves it. The separate Docker/SQLite deployment is
tracked as a follow-up and is not part of the current release.

## Deployment hierarchy

Current supported path:

1. **Recommended:** Deploy to Cloudflare.

Planned container packaging, tracked separately:

1. **Need your own server or region?** Run the Docker container.
2. **Prefer a managed container host?** Deploy on Railway or Render.
3. **Comfortable with VPSs?** Use Docker Compose with Coolify or Dokploy on Hetzner, OVH, DigitalOcean, or similar.

Do not advertise those container paths as available until the image, persistent
SQLite volume, backups, migration flow, and restore test ship.

## Operational checklist

- Use a unique, high-entropy `ADMIN_PASSWORD`; HTTP Basic credentials must only travel over HTTPS.
- Configure the public privacy notice, contact, tracking mode, region description, and retention period.
- Use one activity-scoped key per activity and set an allowed origin for browser embeds.
- Revoke keys when an activity is retired or a key appears in an unintended place.
- Test learner export/deletion and periodically verify that scheduled retention cleanup is running.
- D1 is managed storage, but you still need an incident and recovery plan appropriate to your use.

## Local Development

See the README Quickstart.
