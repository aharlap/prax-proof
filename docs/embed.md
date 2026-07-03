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
        data-key="KEY_ID:KEY_SECRET"
        data-identity="ask"></script>
<script>
  proof.start();
  proof.step("section-2");
  proof.answer("q1", { response: "B", correct: true });
  proof.finish({ score: 8, max: 10 });
</script>
```

## Identity modes (`data-identity`)

| Mode | Learner experience | Dashboard shows |
|------|--------------------|-----------------|
| `anonymous` (default) | nothing | stable anonymous device rows |
| `ask` | one name prompt, remembered on the device | the entered name |
| `token` | nothing — identity rides `?plearner=TOKEN` links you hand out | one row per token |

## About the embedded key

The `data-key` value is visible to anyone who views your page source. That
is by design and matches how web analytics snippets work. Proof's API is
write-only — there are no endpoints that read statements back with an ingest
key — so an exposed key lets someone submit junk data (rate-limited), never
read results. Rotate a key by minting a new one and updating the page.

## Failure behavior

The snippet never breaks the host page. If configuration is missing or the
network fails, calls become no-ops that log a `[proof]` warning to the
console.
