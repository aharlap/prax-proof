# Deploy

## One-Click

The Deploy to Cloudflare button parses this repo's Wrangler config, auto-provisions the D1 database, creates the deployer's own repo copy, and deploys. You do not need to fork first — the button does the copying. (If you do maintain a fork, update the button URL in your fork's README so it deploys your fork.)

After deploy, set the admin password:

    wrangler secret put ADMIN_PASSWORD

You can also set `ADMIN_PASSWORD` in the Cloudflare dashboard Variables UI.

## CLI

    git clone https://github.com/Praxity/prax-proof.git
    cd prax-proof
    wrangler login
    pnpm install
    pnpm run deploy
    wrangler secret put ADMIN_PASSWORD

`pnpm run deploy` builds the snippet, deploys the Worker, lets Wrangler
auto-provision the D1 database, then applies remote migrations.

## First steps after deploying

Open `https://YOUR-WORKER.workers.dev/dashboard` in a browser and sign in with
username `admin` and the `ADMIN_PASSWORD` you set. Create your first key on
the Keys page — the page hands you the embed snippet for your pages and a
copy-paste prompt for AI builders. No command line is needed after deploy.

## EU Data Residency

Create the DB manually before the first deploy:

    wrangler d1 create proof --jurisdiction eu

Paste the returned `database_id` into `wrangler.toml`'s `d1_databases` block. Jurisdiction is set at creation and cannot change later. Then run:

    pnpm run deploy

## Local Development

See the README Quickstart.
