# Embedding Proof in a page

Proof tracks learning results with one script tag and four calls. This works
in hand-written pages, AI-generated pages (Claude, GPT, Gemini Stitch), and
anything that can run a script tag.

## Quick start

1. Mint a key on your instance: `POST /admin/keys` (see README).
2. Add the script tag and the calls — or paste your instance's `/llms.txt`
   into your AI builder's prompt and let it wire things up.

```html
<script src="https://YOUR-INSTANCE/p.js"
        data-activity="fractions-quiz"
        data-name="Fractions Quiz"
        data-key="KEY_ID:KEY_SECRET"
        data-identity="ask"></script>
<script>
  proof.start();
  proof.step("section-2", "Section 2 — Practice");
  proof.answer("q1", { response: "B", correct: true });
  proof.finish({ score: 8, max: 10 });
</script>
```

`data-name` is an optional human title shown on the dashboard. `proof.step(id, label?)`
accepts an optional label for the dashboard funnel. The snippet also reports the
page URL as origin + path only, never query strings or hashes, so the dashboard
can link to the live page.

## Identity modes (`data-identity`)

| Mode | Learner experience | Dashboard shows |
|------|--------------------|-----------------|
| `anonymous` (default) | nothing | stable anonymous device rows |
| `ask` | one name prompt, remembered on the device | the entered name |
| `token` | nothing — identity rides `?plearner=TOKEN` links you hand out | one row per token |

## Track H5P content

If the page already hosts H5P content, add `data-h5p` to the same Proof script
tag. No `proof.start()` or other calls are needed for the H5P activity.

```html
<script src="https://YOUR-INSTANCE/p.js"
        data-activity="fractions-h5p"
        data-name="Fractions H5P"
        data-key="KEY_ID:KEY_SECRET"
        data-h5p></script>
```

Proof tracks H5P starts, completions, pass/fail, scores, and per-question
answers with H5P's own question titles. Per-interaction noise is deliberately
not forwarded.

Limitation: H5P only exposes events to the page hosting it. Per H5P's docs,
"You can't embed H5P from an external site and use JavaScript on your own site
to track what the learner does." `data-h5p` works where the H5P content and the
page are on the same site, such as WordPress/Drupal plugins, h5p-standalone, or
Lumi HTML exports. It does not work for h5p.org cross-site iframe embeds.

## About the embedded key

The `data-key` value is visible to anyone who views your page source. That
is by design, and it is *more* protection than the web-analytics norm:
Plausible and Umami snippets carry no credential at all — just a public
site identifier — and their ingest endpoints accept events from anyone who
knows it. Proof requires the key, its API is write-only (no endpoint reads
statements back with an ingest key), and every key is rate-limited. The
worst an exposed key allows is junk data, never reading results. Rotate a
key by minting a new one and updating the page. A per-key origin allowlist
(server-side, stricter than any snippet-level check) is on the roadmap.

## Failure behavior

The snippet never breaks the host page. If configuration is missing or the
network fails, calls become no-ops that log a `[proof]` warning to the
console.
